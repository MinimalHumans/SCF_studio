// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test }
  from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync }
  from "node:fs";
import { join } from "node:path";
import { createHostCore, type HostConnection, type HostCore }
  from "../src/index.ts";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import { makeWorkspace, registry, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

describe("what the host does for a tool's writes", () => {
  let host: HostCore;
  let agent: HostConnection;
  let window: HostConnection;
  let state: string;
  let film: string;

  const ok = async (c: HostConnection, m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.result as Record<string, unknown>;
  };
  const err = async (c: HostConnection, m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (r.ok) throw new Error("expected a failure");
    return r.error;
  };
  const addCharacter = (name: string, extra: object = {}) => ({
    name: "record.create",
    args: { entity: "character", values: { name } }, ...extra,
  });

  beforeEach(async () => {
    state = join(ws.dir, `state${String(Math.random()).slice(2, 8)}`);
    film = ws.newFilm();
    host = createHostCore({
      registry, snapshotDir: join(state, "snapshots"),
      journalDir: join(state, "journal"), snapshotsKept: 2,
    });
    agent = host.connect();
    window = host.connect();
    await ok(agent, "hello", { client: "mcp: Test Agent" });
    await ok(window, "hello", { client: "window" });
    await ok(agent, "open", { path: film });
    await ok(window, "open", { path: film });
  });
  afterEach(async () => { await host.shutdown(); });

  const snapshots = (): string[] => {
    const dir = join(state, "snapshots");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((d) =>
      readdirSync(join(dir, d)).map((f) => join(dir, d, f)));
  };

  test("the first agent write takes a snapshot of what was there",
      async () => {
    await ok(window, "call", { name: "record.create",
      args: ["character", { name: "BEFORE" }] });
    const first = await ok(agent, "op", addCharacter("AGENT"));
    expect(typeof first["snapshot"]).toBe("string");
    const second = await ok(agent, "op", addCharacter("AGENT 2"));
    expect(second["snapshot"]).toBeUndefined();
    expect(snapshots()).toEqual([first["snapshot"]]);

    const db = openNodeDatabase(first["snapshot"] as string,
                                { readOnly: true });
    const names = (await db.exec("SELECT name FROM character"))
      .map((r) => r["name"]);
    db.close();
    expect(names).toEqual(["BEFORE"]);          // not the agent's own write
  });

  test("the window's own writes take none", async () => {
    await ok(window, "call", { name: "record.create",
      args: ["character", { name: "ME" }] });
    expect(snapshots()).toEqual([]);
  });

  test("a stale agent is refused before any snapshot is taken", async () => {
    const e = await err(agent, "op", addCharacter("X",
      { expectedRevision: 999 }));
    expect(e.code).toBe("stale_revision");
    expect(snapshots()).toEqual([]);
  });

  test("if the snapshot cannot be taken, nothing is written", async () => {
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "blocker"), "x");   // a file where a dir goes
    await host.shutdown();
    host = createHostCore({
      registry, snapshotDir: join(state, "blocker", "snapshots") });
    agent = host.connect();
    await ok(agent, "hello", { client: "mcp" });
    await ok(agent, "open", { path: film });
    const e = await err(agent, "op", addCharacter("X"));
    expect(e.message).toContain("snapshot");
    expect(await ok(agent, "query",
      { sql: "SELECT COUNT(*) AS n FROM character" }) as unknown)
      .toEqual([{ n: 0 }]);
  });

  test("old snapshots are pruned to the number kept", async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = host.connect();
      await ok(c, "hello", { client: `agent ${String(i)}` });
      await ok(c, "open", { path: film });
      await ok(c, "op", addCharacter(`N${String(i)}`));
      await c.close();
      // A new open of the film gets a new snapshot; make it a new open.
      await ok(agent, "close");
      await new Promise((r) => setTimeout(r, 5));
      await ok(agent, "open", { path: film });
      await ok(window, "close");
      await ok(window, "open", { path: film });
    }
    expect(snapshots().length).toBeLessThanOrEqual(2);
  }, 60_000);

  test("an agent's write that adds a finding is refused by default",
      async () => {
    const scene = (await ok(window, "call", { name: "record.create",
      args: ["scene", { scene_number: "1" }] }))["result"] as number;
    const person = (await ok(window, "call", { name: "record.create",
      args: ["character", { name: "ELEANOR" }] }))["result"] as number;
    // Lines through the host's own writer, as the editor would store them.
    await ok(window, "call", { name: "script.commit", args: [{
      rows: [
        { uuid: "11111111-1111-4111-8111-111111111111", lineOrder: 0,
          lineType: "heading", content: "INT. HALL - DAY", raw: "",
          sceneId: scene, characterId: null, locationId: null,
          metadata: null },
        { uuid: "22222222-2222-4222-8222-222222222222", lineOrder: 1,
          lineType: "action", content: "Rain.", raw: "",
          sceneId: null, characterId: null, locationId: null,
          metadata: null },
      ],
      titlePage: [], link: { createNew: false },
    }] });
    const link = { name: "record.create", args: {
      entity: "scene_character",
      values: { scene_id: scene, character_id: person } } };
    const e = await err(agent, "op", link);
    expect(e.code).toBe("integrity_gate");
    expect((e.data?.["added"] as { kind: string }[])[0]!.kind)
      .toBe("unjustified_link");
    expect(await ok(agent, "query",
      { sql: "SELECT COUNT(*) AS n FROM scene_character" }) as unknown)
      .toEqual([{ n: 0 }]);
    // With a person watching, the caller can ask for it anyway.
    await ok(agent, "op", { ...link, integrityGate: false });
  }, 60_000);

  test("every write is journalled with who made it and how", async () => {
    await ok(window, "call", { name: "record.create",
      args: ["character", { name: "W" }] });
    await ok(agent, "op", addCharacter("A"));
    await err(agent, "op", { name: "nope.nope" });
    const { entries } = await ok(agent, "journal", {}) as unknown as
      { entries: { by: string; via: string; name: string; ok: boolean }[] };
    expect(entries.map((e) => [e.by, e.via, e.name, e.ok])).toEqual([
      ["window", "call", "record.create", true],
      ["mcp: Test Agent", "op", "record.create", true],
      // An attempt that failed is part of the record too.
      ["mcp: Test Agent", "op", "nope.nope", false],
    ]);
  });

  test("the journal survives the host", async () => {
    await ok(agent, "op", addCharacter("A"));
    await host.shutdown();
    host = createHostCore({ registry, journalDir: join(state, "journal") });
    const c = host.connect();
    await ok(c, "hello", { client: "later" });
    await ok(c, "open", { path: film });
    const { entries } = await ok(c, "journal", {}) as unknown as
      { entries: { by: string }[] };
    expect(entries.map((e) => e.by)).toEqual(["mcp: Test Agent"]);
    expect(readFileSync(join(state, "journal", readdirSync(
      join(state, "journal"))[0]!), "utf8")).toContain("mcp: Test Agent");
  });

  test("a failed write is journalled with its reason", async () => {
    await err(agent, "op", { name: "record.create",
      args: { entity: "no_such_entity", values: {} } });
    const { entries } = await ok(agent, "journal", {}) as unknown as
      { entries: { ok: boolean; error?: string }[] };
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ok).toBe(false);
    expect(entries[0]!.error).toContain("unknown entity");
  });
});
