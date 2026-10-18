// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "../src/node.ts";
import { initDatabase } from "../src/db.ts";
import { loadRegistry, type RegistryJson } from "../src/registry.ts";
import { createSession, StaleRevisionError, type Session }
  from "../src/session.ts";
import {
  OpArgumentError, UnknownOpError, argsJsonSchema, callOp, listOps,
} from "../src/ops/opTable.ts";

const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

describe("op table", () => {
  let session: Session;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    const db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    session = createSession(registry, {
      exec: db.exec, persist: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    });
  });

  const count = async (table: string): Promise<number> =>
    Number((await session.exec(
      `SELECT COUNT(*) AS n FROM ${table}`))[0]!["n"]);

  test("a call runs the op and reports the new revision", async () => {
    const r = await callOp(session, "record.create", {
      entity: "character", values: { name: "ELEANOR" },
    });
    expect(typeof r.result).toBe("number");
    expect(r.revision).toBe(1);
    expect(await count("character")).toBe(1);
  });

  test("an unknown op is refused", async () => {
    await expect(callOp(session, "record.explode", {}))
      .rejects.toBeInstanceOf(UnknownOpError);
  });

  test("bad arguments are refused before anything is written", async () => {
    for (const args of [
      { entity: "character" },                        // missing values
      { entity: 7, values: {} },                      // wrong type
      { entity: "character", values: {}, extra: 1 }, // unknown name
      { entity: "character", values: { a: { b: 1 } } }, // not a value
      "character",                                    // not an object
    ]) {
      await expect(callOp(session, "record.create", args))
        .rejects.toBeInstanceOf(OpArgumentError);
    }
    expect(session.revision).toBe(0);
  });

  test("a stale expected revision is refused and is not a write",
      async () => {
    await callOp(session, "record.create",
                 { entity: "character", values: { name: "A" } });
    await expect(callOp(session, "record.create",
      { entity: "character", values: { name: "B" } },
      { expectedRevision: 0 })).rejects.toBeInstanceOf(StaleRevisionError);
    expect(await count("character")).toBe(1);
    expect(session.revision).toBe(1);
  });

  test("a matching expected revision is accepted", async () => {
    await callOp(session, "record.create",
                 { entity: "character", values: { name: "A" } });
    await callOp(session, "record.create",
      { entity: "character", values: { name: "B" } },
      { expectedRevision: 1 });
    expect(await count("character")).toBe(2);
  });

  test("two calls with the same expected revision cannot both win",
      async () => {
    const make = (name: string) => callOp(session, "record.create",
      { entity: "character", values: { name } }, { expectedRevision: 0 });
    const settled = await Promise.allSettled([make("A"), make("B")]);
    expect(settled.map((s) => s.status).sort())
      .toEqual(["fulfilled", "rejected"]);
    expect(await count("character")).toBe(1);
  });

  test("a read-only session refuses every op", async () => {
    const registry = session.registry;
    const db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    const ro = createSession(registry, {
      exec: db.exec, persist: () => Promise.resolve(true),
      close: () => Promise.resolve(),
    }, { readOnly: true });
    await expect(callOp(ro, "record.create",
      { entity: "character", values: { name: "A" } })).rejects.toThrow(
      /read-only/);
  });

  test("shots: add, move, cut, remove through the table", async () => {
    const scene = (await callOp(session, "record.create",
      { entity: "scene", values: { scene_number: "1" } })).result as number;
    await callOp(session, "shot.add", { sceneId: scene });
    await callOp(session, "shot.add", { sceneId: scene });
    const ids = (await session.exec(
      "SELECT id FROM shot ORDER BY shot_order")).map((r) => Number(r["id"]));
    expect(ids).toHaveLength(2);

    await callOp(session, "shot.move", { id: ids[1], delta: -1 });
    const order = (await session.exec(
      "SELECT id FROM shot ORDER BY shot_order")).map((r) => Number(r["id"]));
    expect(order).toEqual([ids[1], ids[0]]);

    await callOp(session, "shot.setCut", { id: ids[0], cut: true });
    expect((await session.exec("SELECT lifecycle_status AS s FROM shot " +
      "WHERE id = ?", [ids[0]!]))[0]!["s"]).toBe("cut");

    await callOp(session, "shot.remove", { id: ids[0] });
    expect(await count("shot")).toBe(1);
  });

  test("shot.move rejects a step that is not one place", async () => {
    await expect(callOp(session, "shot.move", { id: 1, delta: 5 }))
      .rejects.toBeInstanceOf(OpArgumentError);
  });

  test("delete returns an undo entry that is plain data", async () => {
    const id = (await callOp(session, "record.create",
      { entity: "character", values: { name: "A" } })).result as number;
    const r = await callOp(session, "record.delete",
                           { entity: "character", id });
    expect(JSON.parse(JSON.stringify(r.result))).toEqual(r.result);
    expect(await count("character")).toBe(0);
  });

  test("title-page keys can be set and cleared", async () => {
    await callOp(session, "titlePage.setKey",
                 { key: "Author", value: "Ada" });
    expect(await count("screenplay_title_page")).toBe(1);
    await callOp(session, "titlePage.setKey", { key: "Author", value: "" });
    expect(await count("screenplay_title_page")).toBe(0);
  });

  test("every op describes itself as a JSON Schema", () => {
    for (const op of listOps()) {
      const schema = argsJsonSchema(op);
      expect(schema["type"]).toBe("object");
      expect(Object.keys(schema["properties"] as object).sort())
        .toEqual(Object.keys(op.args).sort());
    }
    const names = listOps().map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
