// SPDX-License-Identifier: Apache-2.0
/**
 * Spec §6.6 — a cut row is not in the film.
 *
 * The rule is easy to state and easy to implement in one place and miss
 * in six. These tests are built around the property that makes it
 * checkable: **adding a cut row must change no answer.** A resolver that
 * forgot the filter would not fail by throwing; it would fail by
 * quietly returning something that is not in the film, which is the kind
 * of defect that ships.
 */
import { afterEach, beforeAll, afterAll, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import {
  rows, rowsIncludingCut, sceneOrder, statesInForce,
} from "../src/resolution.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
beforeAll(() => { fx = openFixture(); });
afterAll(() => { fx.close(); });

let db: NodeDatabase | null = null;
afterEach(() => { db?.close(); db = null; });

const fresh = async (): Promise<NodeDatabase> => {
  const d = openNodeDatabase(":memory:");
  await initDatabase(d.exec, registry);
  return d;
};

describe("the fetch layer", () => {
  test("rows() excludes cut; rowsIncludingCut() does not", async () => {
    db = await fresh();
    await db.exec(
      "INSERT INTO character (name, uuid, lifecycle_status) " +
      "VALUES ('KEPT', 'c1', 'active')");
    await db.exec(
      "INSERT INTO character (name, uuid, lifecycle_status) " +
      "VALUES ('GONE', 'c2', 'cut')");

    expect((await rows(db.exec, "character")).map((r) => r["name"]))
      .toEqual(["KEPT"]);
    expect((await rowsIncludingCut(db.exec, "character"))
      .map((r) => r["name"])).toEqual(["KEPT", "GONE"]);
  });

  test("an entity with no lifecycle_status column keeps its rows",
       async () => {
    // Eleven of 99 entities have no notion of being cut. A filter that
    // assumed the column would empty those tables.
    db = await fresh();
    const withoutColumn = registry.order.find((name) => {
      const def = registry.entities.get(name);
      return def !== undefined &&
        !def.fields.some((f) => f.name === "lifecycle_status");
    });
    expect(withoutColumn).toBeDefined();
    if (withoutColumn === undefined) return;
    await db.exec(
      `INSERT INTO ${withoutColumn} (uuid) VALUES ('x1')`);
    expect(await rows(db.exec, withoutColumn)).toHaveLength(1);
  });
});

describe("adding a cut row changes no answer", () => {
  test("a cut scene has no story position", async () => {
    const order = await sceneOrder(fx.ctx);
    const cut = await fx.ctx.exec(
      "SELECT id FROM scene WHERE lifecycle_status = 'cut'");
    expect(cut.length).toBeGreaterThan(0);
    for (const r of cut) expect(order.has(Number(r["id"]))).toBe(false);
  });

  test("a cut scene does not shift the scenes around it", async () => {
    // The property in its most useful form: positions are what they
    // would be if the cut scene were not there at all.
    const order = await sceneOrder(fx.ctx);
    const sc12 = await fx.sceneByNumber("12");
    const sc12a = await fx.sceneByNumber("12A");
    expect((order.get(sc12a) ?? -1) - (order.get(sc12) ?? -1)).toBe(1);
  });

  test("a cut state is in force nowhere", async () => {
    db = await fresh();
    await db.exec(
      "INSERT INTO character (name, uuid) VALUES ('E', 'c1')");
    await db.exec(
      "INSERT INTO scene (name, scene_number, uuid) VALUES ('S', '1', 's1')");
    await db.exec(
      "INSERT INTO performance_state (name, character_id, scene_id, " +
      "modality, persistence, uuid, lifecycle_status) " +
      "VALUES ('hoarse', 1, 1, 'vocal', 'until_resolved', 'p1', 'cut')");

    expect(await statesInForce({ exec: db.exec, registry }, 1, 1,
                               "vocal")).toEqual([]);
  });

  test("a cut row keeps its uuid, so restoring it restores the row",
       async () => {
    // §6.6.2. Cut is not deletion; identity survives it.
    const beat = await fx.ctx.exec(
      "SELECT uuid FROM performance_beat WHERE lifecycle_status = 'cut'");
    expect(beat[0]?.["uuid"]).toBeTypeOf("string");
    expect(String(beat[0]?.["uuid"])).toHaveLength(36);
  });
});

describe("the fixture's cut rows are real", () => {
  test("a cut scene carries a heading, and is still excluded", async () => {
    // The trap the rule exists for: deriving story order from headings
    // alone would resurrect a scene that is not in the film.
    const cut = await fx.ctx.exec(
      "SELECT id FROM scene WHERE lifecycle_status = 'cut'");
    const id = Number(cut[0]?.["id"]);
    const heading = await fx.ctx.exec(
      "SELECT id FROM screenplay_lines WHERE line_type = 'heading' " +
      "AND scene_id = ?", [id]);
    expect(heading).toHaveLength(1);
    expect((await sceneOrder(fx.ctx)).has(id)).toBe(false);
  });

  test("the cut beat sits in the most heavily asserted scene", async () => {
    const sc12 = await fx.sceneByNumber("12");
    const all = await rowsIncludingCut(
      fx.ctx.exec, "performance_beat", "scene_id = ?", [sc12]);
    const active = await rows(
      fx.ctx.exec, "performance_beat", "scene_id = ?", [sc12]);
    expect(all.length).toBe(active.length + 1);
  });
});
