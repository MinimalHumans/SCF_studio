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

  test("the film's uuid and a uuid in the arguments are kept", async () => {
    const c = await connect("window");
    await ok(c, "open", { path });
    const [row] = await ok(c, "query",
      { sql: "SELECT uuid FROM project LIMIT 1" }) as { uuid: string | null }[];
    const target = "33333333-3333-4333-8333-333333333333";
    await c.handle("op", {
      name: "record.create",
      args: { entity: "character", values: { name: "Ada", notes: target } } });
    const last = (await audit.query({ limit: 1 }))[0]!;
    expect(last.projectUuid).toBe(row?.uuid ?? null);
    expect(last.targetUuid).toBe(target);
    expect(await audit.query({ targetUuid: target })).toHaveLength(1);
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
});
