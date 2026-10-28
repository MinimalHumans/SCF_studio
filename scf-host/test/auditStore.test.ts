// SPDX-License-Identifier: Apache-2.0
/**
 * auditStore.ts against the real Node driver: appending, querying,
 * the hash chain, and what verify() notices.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import { openNodeAuditStore } from "../src/nodeAuditStore.ts";
import {
  actorKindOf, firstUuidIn, type AuditEventInput, type AuditStore,
} from "../src/auditStore.ts";

const execFileAsync = promisify(execFile);

let dir: string;
let path: string;
let store: AuditStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "scf-audit-"));
  path = join(dir, "audit.db");
  store = await openNodeAuditStore(path);
});
afterEach(async () => {
  await store.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const event = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  actorKind: "user", actorName: "window", scope: "project",
  projectUuid: "p1", projectPath: "/films/a.scf", action: "op.test", ...over,
});

/** Change a row behind the store's back, as an outside editor would. */
function tamper(sql: string, params: (string | number)[] = []): void {
  const db = openNodeDatabase(path);
  void db.exec(sql, params);
  db.close();
}

describe("append and query", () => {
  test("ids rise and each event chains from the one before", async () => {
    const a = await store.append(event({ action: "a" }));
    const b = await store.append(event({ action: "b" }));
    expect([a.id, b.id]).toEqual([1, 2]);
    expect(a.prevHash).toBe("");
    expect(b.prevHash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("query is newest first, and pages back with beforeId", async () => {
    for (let i = 1; i <= 5; i++) await store.append(event({ action: `e${String(i)}` }));
    const page = await store.query({ limit: 2 });
    expect(page.map((e) => e.action)).toEqual(["e5", "e4"]);
    const next = await store.query({ limit: 2, beforeId: page[1]!.id });
    expect(next.map((e) => e.action)).toEqual(["e3", "e2"]);
    expect((await store.query({ order: "asc", limit: 1 }))[0]!.action).toBe("e1");
  });

  test("filters by target, project, actor, scope and text", async () => {
    await store.append(event({ targetUuid: U1, action: "op.rename" }));
    await store.append(event({ targetUuid: U2, projectUuid: "p2" }));
    await store.append(event({ actorKind: "agent", actorName: "mcp: x",
                               summary: "100% of it" }));
    await store.append(event({ scope: "app", projectUuid: null,
                               projectPath: null, action: "settings.change" }));
    expect(await store.query({ targetUuid: U1.toUpperCase() }))
      .toHaveLength(1);
    expect(await store.query({ projectUuid: "p2" })).toHaveLength(1);
    expect(await store.query({ actorKind: "agent" })).toHaveLength(1);
    expect(await store.query({ scope: "app" })).toHaveLength(1);
    expect(await store.query({ search: "100%" })).toHaveLength(1);
    // % is literal, not a wildcard.
    expect(await store.query({ search: "1%0" })).toHaveLength(0);
    expect(await store.count({ scope: "project" })).toBe(3);
  });

  test("filters by time", async () => {
    await store.append(event({ at: "2026-01-01T00:00:00.000Z" }));
    await store.append(event({ at: "2026-06-01T00:00:00.000Z" }));
    expect(await store.query({ since: "2026-03-01T00:00:00.000Z" }))
      .toHaveLength(1);
    expect(await store.query({ until: "2026-03-01T00:00:00.000Z" }))
      .toHaveLength(1);
  });

  test("a long summary is cut", async () => {
    const e = await store.append(event({ summary: "x".repeat(2000) }));
    expect(e.summary).toHaveLength(500);
  });

  test("events survive reopening, and the chain carries on", async () => {
    const a = await store.append(event());
    await store.close();
    store = await openNodeAuditStore(path);
    const b = await store.append(event());
    expect(b.id).toBe(2);
    expect(b.prevHash).toBe(a.hash);
    expect(await store.verify()).toEqual({ ok: true, count: 2 });
  });

  test("concurrent appends all land, in one unbroken chain", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      store.append(event({ action: `c${String(i)}` }))));
    expect(await store.verify()).toEqual({ ok: true, count: 25 });
    const ids = (await store.query({ order: "asc", limit: 1000 }))
      .map((e) => e.id);
    expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  // The window and the standalone MCP are separate processes. Two
  // connections in one thread cannot show this: a synchronous driver
  // blocked on the other's lock never lets it finish.
  test("another process appending to the same file shares the chain",
      async () => {
    const script = join(dir, "append.ts");
    writeFileSync(script, `
      import { openNodeAuditStore } from ${JSON.stringify(
        pathToFileURL(join(import.meta.dirname, "../src/nodeAuditStore.ts"))
          .href)};
      const s = await openNodeAuditStore(process.argv[2]);
      for (let i = 0; i < 10; i++) {
        await s.append({ actorKind: "agent", scope: "app", action: "child" });
      }
      await s.close();
    `);
    const child = execFileAsync(process.execPath, [
      "--experimental-strip-types", "--no-warnings",
      "--conditions=scf-source", script, path]);
    for (let i = 0; i < 10; i++) await store.append(event());
    await child;
    expect(await store.verify()).toEqual({ ok: true, count: 20 });
    expect(await store.count({ actorKind: "agent" })).toBe(10);
  }, 60_000);
});

describe("verify", () => {
  test("an empty log is intact", async () => {
    expect(await store.verify()).toEqual({ ok: true, count: 0 });
  });

  test("a changed event is found", async () => {
    for (let i = 0; i < 3; i++) await store.append(event());
    tamper("UPDATE audit_event SET summary = 'rewritten' WHERE id = 2");
    const v = await store.verify();
    expect(v.ok).toBe(false);
    expect(!v.ok && v.brokenAt).toBe(2);
  });

  test("a removed event in the middle is found", async () => {
    for (let i = 0; i < 3; i++) await store.append(event());
    tamper("DELETE FROM audit_event WHERE id = 2");
    const v = await store.verify();
    expect(!v.ok && v.brokenAt).toBe(3);
  });

  test("a cut tail is found", async () => {
    for (let i = 0; i < 3; i++) await store.append(event());
    tamper("DELETE FROM audit_event WHERE id = 3");
    const v = await store.verify();
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/end of the chain/);
  });
});

describe("prune and export", () => {
  test("pruning the front leaves a chain that still verifies", async () => {
    await store.append(event({ at: "2026-01-01T00:00:00.000Z" }));
    await store.append(event({ at: "2026-02-01T00:00:00.000Z" }));
    await store.append(event({ at: "2026-06-01T00:00:00.000Z" }));
    expect(await store.prune("2026-03-01T00:00:00.000Z")).toBe(2);
    expect(await store.verify()).toEqual({ ok: true, count: 1 });
    const next = await store.append(event());
    expect(next.id).toBe(4);
    expect(await store.verify()).toEqual({ ok: true, count: 2 });
  });

  test("pruning everything still lets the chain carry on", async () => {
    const last = await store.append(event({ at: "2026-01-01T00:00:00.000Z" }));
    await store.prune("2027-01-01T00:00:00.000Z");
    expect(await store.verify()).toEqual({ ok: true, count: 0 });
    const next = await store.append(event());
    expect(next.id).toBe(2);
    expect(next.prevHash).toBe(last.hash);
  });

  test("export is every event, oldest first, one per line", async () => {
    for (let i = 1; i <= 1200; i++) {
      await store.append(event({ action: `e${String(i)}` }));
    }
    const lines = (await store.exportJsonl()).trimEnd().split("\n");
    expect(lines).toHaveLength(1200);
    const first = JSON.parse(lines[0]!) as { action: string; hash: string };
    expect(first.action).toBe("e1");
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

describe("helpers", () => {
  test("the window is the user and any other client an agent", () => {
    expect(actorKindOf("window")).toBe("user");
    expect(actorKindOf("mcp: Claude Desktop")).toBe("agent");
  });

  test("a uuid is found in arguments and lowercased", () => {
    expect(firstUuidIn(`{"id":"${U1.toUpperCase()}"}`)).toBe(U1);
    expect(firstUuidIn('{"id":7}')).toBeNull();
  });
});
