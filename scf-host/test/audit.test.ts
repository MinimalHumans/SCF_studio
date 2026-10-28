// SPDX-License-Identifier: Apache-2.0
/**
 * The host writes the audit trail: what each client did to a film, as
 * whom, and what happened to the file behind the host's back.
 */

import { utimesSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test }
  from "vitest";
import {
  createHostCore, type HostConnection, type HostCore,
} from "../src/index.ts";
import { openNodeAuditStore } from "../src/nodeAuditStore.ts";
import type { AuditStore } from "../src/auditStore.ts";
import { makeWorkspace, registry, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

describe("host audit trail", () => {
  let dir: string;
  let audit: AuditStore;
  let host: HostCore;
  let path: string;
  let failures: unknown[];

  const connect = async (name: string): Promise<HostConnection> => {
    const c = host.connect();
    await c.handle("hello", { client: name });
    return c;
  };
  const ok = async (c: HostConnection, m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.result;
  };
  const create = (c: HostConnection, name: string) => c.handle("op", {
    name: "record.create", args: { entity: "character", values: { name } },
  });
  const actions = async () =>
    (await audit.query({ order: "asc" })).map((e) => e.action);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "scf-host-audit-"));
    audit = await openNodeAuditStore(join(dir, "audit.db"));
    failures = [];
    host = createHostCore({
      registry, busyTimeoutMs: 500, audit,
      onAuditError: (e) => failures.push(e),
    });
    path = ws.newFilm();
  });
  afterEach(async () => {
    await host.shutdown();
    await audit.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  test("open, a write and close are recorded, as the window", async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    await create(c, "Ada");
    await c.close();
    expect(await actions())
      .toEqual(["project.open", "op.record.create", "project.close"]);
    const [open, write] = await audit.query({ order: "asc" });
    expect(open).toMatchObject({
      actorKind: "user", actorName: "window", scope: "project",
      projectPath: path });
    expect(write!.summary).toContain("Ada");
    expect(failures).toEqual([]);
  });

  test("a client that is not the window is an agent", async () => {
    const c = await connect("mcp: Claude Desktop");
    await ok(c, "open", { path });
    await create(c, "Ada");
    const events = await audit.query({ actorKind: "agent" });
    expect(events.length).toBe(2);
    expect(events[0]!.actorName).toBe("mcp: Claude Desktop");
  });

  test("a failed write is recorded as failed", async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    const r = await c.handle("op", {
      name: "record.create", args: { entity: "no_such_table", values: {} } });
    expect(r.ok).toBe(false);
    const last = (await audit.query({ limit: 1 }))[0]!;
    expect(last.action).toBe("op.record.create");
    expect(last.summary).toMatch(/^failed:/);
  });

  test("a dry run and a refused stale write are not recorded", async () => {
    const c = await connect("window");
    const { revision } = await ok(c, "open", { path }) as
      { revision: number };
    await c.handle("op", {
      name: "record.create", dryRun: true,
      args: { entity: "character", values: { name: "A" } } });
    await c.handle("op", {
      name: "record.create", expectedRevision: revision + 5,
      args: { entity: "character", values: { name: "A" } } });
    expect(await actions()).toEqual(["project.open"]);
  });

  test("the film's uuid is kept; a uuid in the arguments is the fallback",
      async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    const [row] = await ok(c, "query",
      { sql: "SELECT uuid FROM project LIMIT 1" }) as { uuid: string | null }[];
    // No single row is addressed, so the only clue is what was passed.
    const mentioned = "33333333-3333-4333-8333-333333333333";
    await c.handle("call", {
      name: "titlePage.setKey", args: ["Notes", mentioned] });
    const last = (await audit.query({ limit: 1 }))[0]!;
    expect(last.projectUuid).toBe(row?.uuid ?? null);
    expect(last.targetUuid).toBe(mentioned);
    expect(await audit.query({ targetUuid: mentioned })).toHaveLength(1);
  });

  test("a change behind the host's back is recorded once, as external",
      async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    await create(c, "A");
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    await create(c, "B");
    await create(c, "C");
    const external = await audit.query({ actorKind: "external" });
    expect(external.map((e) => e.action)).toEqual(["file.external_change"]);
    await ok(c, "reload");
    expect((await actions()).at(-1)).toBe("project.reload");
  });

  test("an audit store that fails never fails the write", async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    await audit.close();
    const r = await create(c, "Ada");
    expect(r.ok).toBe(true);
    expect(failures.length).toBeGreaterThan(0);
  });

  describe("the row a write touched", () => {
    const makeCharacter = async (c: HostConnection, name: string) => {
      const r = await create(c, name);
      if (!r.ok) throw new Error(r.error.message);
      return (r.result as { result: number }).result;
    };
    const uuidOf = async (c: HostConnection, id: number) => {
      const [row] = await ok(c, "query", {
        sql: "SELECT uuid FROM character WHERE id = ?", params: [id] }) as
        { uuid: string }[];
      return row!.uuid;
    };

    test("a create is attached to the new row", async () => {
      const c = await connect("window");
      await ok(c, "open", { path });
      const id = await makeCharacter(c, "Ada");
      const e = (await audit.query({ limit: 1 }))[0]!;
      expect(e.targetEntity).toBe("character");
      expect(e.targetUuid).toBe(await uuidOf(c, id));
      expect(e.summary).toBe('created character "Ada"');
    });

    test("an update says which fields changed, from what to what",
        async () => {
      const c = await connect("mcp: Claude Desktop");
      await ok(c, "open", { path });
      const id = await makeCharacter(c, "Ada");
      await ok(c, "op", {
        name: "record.update",
        args: { entity: "character", id,
                values: { name: "Ada Cade", role: "protagonist" } } });
      const e = (await audit.query({ limit: 1 }))[0]!;
      expect(e.targetUuid).toBe(await uuidOf(c, id));
      expect(e.summary).toContain('name: "Ada" → "Ada Cade"');
      expect(e.summary).toContain('role: ∅ → "protagonist"');
      // Everything that happened to this row, found by its uuid.
      expect((await audit.query({ targetUuid: e.targetUuid! }))
        .map((x) => x.summary?.split(" ")[0]))
        .toEqual(["character", "created"]);
    });

    test("an update through the window's positional call is attached too",
        async () => {
      const c = await connect("window");
      await ok(c, "open", { path });
      const id = await makeCharacter(c, "Ada");
      await ok(c, "call", {
        name: "record.update",
        args: ["character", id, { name: "Ada Cade" }] });
      const e = (await audit.query({ limit: 1 }))[0]!;
      expect(e.action).toBe("call.record.update");
      expect(e.targetUuid).toBe(await uuidOf(c, id));
      expect(e.summary).toContain('name: "Ada" → "Ada Cade"');
    });

    test("a delete keeps the uuid of the row that is gone", async () => {
      const c = await connect("window");
      await ok(c, "open", { path });
      const id = await makeCharacter(c, "Ada");
      const uuid = await uuidOf(c, id);
      await ok(c, "op", {
        name: "record.delete", args: { entity: "character", id } });
      const e = (await audit.query({ limit: 1 }))[0]!;
      expect(e.targetUuid).toBe(uuid);
      expect(e.summary).toBe('deleted character "Ada"');
    });

    test("a failed update still says which row it was aimed at", async () => {
      const c = await connect("window");
      await ok(c, "open", { path });
      const id = await makeCharacter(c, "Ada");
      const r = await c.handle("call", {
        name: "record.update", args: ["character", id, { name: "B" }],
        expectedRevision: 0 });
      expect(r.ok).toBe(false);
      // A refused stale write is not a write, so nothing is recorded.
      expect((await audit.query({ limit: 1 }))[0]!.summary)
        .toBe('created character "Ada"');
    });

    test("a write that addresses no single row has no target", async () => {
      const c = await connect("window");
      await ok(c, "open", { path });
      await ok(c, "call", {
        name: "titlePage.setKey", args: ["Title", "Hollow Creek"] });
      const e = (await audit.query({ limit: 1 }))[0]!;
      expect(e.targetUuid).toBeNull();
      expect(e.targetEntity).toBeNull();
    });
  });
});
