// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test }
  from "vitest";
import { writeFileSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import {
  createHostCore, type HostConnection, type HostCore, type HostEvent,
} from "../src/index.ts";
import { makeWorkspace, registry, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

describe("host core", () => {
  let host: HostCore;
  let path: string;
  const conns: HostConnection[] = [];
  const connect = async (name = "test"): Promise<HostConnection> => {
    const c = host.connect();
    conns.push(c);
    await c.handle("hello", { client: name });
    return c;
  };
  const ok = async (c: HostConnection, m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.result;
  };
  const err = async (c: HostConnection, m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (r.ok) throw new Error("expected a failure");
    return r.error;
  };

  beforeEach(() => {
    host = createHostCore({ registry, busyTimeoutMs: 500 });
    path = ws.newFilm();
  });
  afterEach(async () => { await host.shutdown(); conns.length = 0; });

  const create = (c: HostConnection, name: string, expectedRevision?: number) =>
    c.handle("op", {
      name: "record.create",
      args: { entity: "character", values: { name } },
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });

  test("a call before open says no file is open", async () => {
    const c = await connect();
    expect((await err(c, "query", { sql: "SELECT 1" })).code).toBe("no_film");
  });

  test("an unknown method and a bad request are told apart", async () => {
    const c = await connect();
    expect((await err(c, "nope")).code).toBe("unknown_method");
    expect((await err(c, "open", { path: 5 })).code).toBe("bad_request");
  });

  test("a missing file and a non-SCF file are refused, not created",
      async () => {
    const c = await connect();
    expect((await err(c, "open", { path: join(ws.dir, "nope.scf") })).code)
      .toBe("not_found");
    const other = join(ws.dir, "other.scf");
    writeFileSync(other, "this is not sqlite");
    expect((await err(c, "open", { path: other })).code).toBe("not_scf");
  });

  test("a write is visible to a read, and the revision rises", async () => {
    const c = await connect();
    const opened = await ok(c, "open", { path }) as { revision: number };
    const r = await c.handle("op", {
      name: "record.create",
      args: { entity: "character", values: { name: "ELEANOR" } },
    });
    expect(r.ok && (r.result as { revision: number }).revision)
      .toBe(opened.revision + 1);
    const rows = await ok(c, "query",
      { sql: "SELECT name FROM character" }) as { name: string }[];
    expect(rows.map((x) => x.name)).toEqual(["ELEANOR"]);
  });

  test("every write is durable in the file without a save", async () => {
    const c = await connect();
    await ok(c, "open", { path });
    await create(c, "A");
    await c.close();                // closes the film, releases the file
    expect(host.openCount).toBe(0);
    const again = await connect();
    await ok(again, "open", { path });
    const rows = await ok(again, "query",
      { sql: "SELECT name FROM character" }) as unknown[];
    expect(rows).toHaveLength(1);
  });

  test("two clients share one film, and each hears the other's write",
      async () => {
    const a = await connect("window");
    const b = await connect("agent");
    const heard: HostEvent[] = [];
    a.onEvent((e) => heard.push(e));
    await ok(a, "open", { path });
    await ok(b, "open", { path });
    expect(host.openCount).toBe(1);
    await create(b, "FROM AGENT");
    expect(heard).toEqual([expect.objectContaining(
      { event: "revision", by: "agent" })]);
    const rows = await ok(a, "query",
      { sql: "SELECT name FROM character" }) as unknown[];
    expect(rows).toHaveLength(1);
  });

  test("the file stays open until the last client leaves", async () => {
    const a = await connect();
    const b = await connect();
    await ok(a, "open", { path });
    await ok(b, "open", { path });
    await a.close();
    expect(host.openCount).toBe(1);
    await b.close();
    expect(host.openCount).toBe(0);
  });

  test("a client cannot write SQL through query", async () => {
    const c = await connect();
    await ok(c, "open", { path });
    for (const sql of [
      "DELETE FROM character",
      "INSERT INTO character (name) VALUES ('x')",
      "SELECT 1; DELETE FROM character",
      "ATTACH DATABASE 'x' AS y",
      "PRAGMA journal_mode = DELETE",
      "WITH x AS (SELECT 1) DELETE FROM character",
    ]) {
      expect((await err(c, "query", { sql })).code).toMatch(/bad_query|failed/);
    }
    expect(await ok(c, "query",
      { sql: "SELECT COUNT(*) AS n FROM character" }))
      .toEqual([{ n: 0 }]);
  });

  test("a read-only connection can read and cannot write", async () => {
    const c = await connect();
    await ok(c, "open", { path, readOnly: true });
    expect((await create(c, "A")).ok).toBe(false);
    expect((await err(c, "op", {
      name: "record.create",
      args: { entity: "character", values: { name: "A" } },
    })).code).toBe("read_only");
    await ok(c, "query", { sql: "SELECT 1 AS one" });
  });

  test("a stale expected revision is refused and nothing is written",
      async () => {
    const a = await connect();
    const b = await connect();
    const { revision } = await ok(a, "open", { path }) as { revision: number };
    await ok(b, "open", { path });
    await create(b, "B");
    const r = await create(a, "A", revision);
    expect(!r.ok && r.error.code).toBe("stale_revision");
    const rows = await ok(a, "query",
      { sql: "SELECT name FROM character" }) as unknown[];
    expect(rows).toHaveLength(1);
  });

  test("bad op names and arguments come back as typed errors", async () => {
    const c = await connect();
    await ok(c, "open", { path });
    expect((await err(c, "op", { name: "x.y" })).code).toBe("unknown_op");
    expect((await err(c, "op", { name: "record.create", args: {} })).code)
      .toBe("bad_request");
  });

  test("ops lists the table with JSON Schemas", async () => {
    const c = await connect();
    const ops = await ok(c, "ops") as { name: string; args: unknown }[];
    expect(ops.map((o) => o.name)).toContain("record.create");
  });

  test("a write behind the host's back is refused until reload",
      async () => {
    const c = await connect();
    await ok(c, "open", { path });
    await create(c, "A");
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    expect((await create(c, "B")).ok).toBe(false);
    const before = await ok(c, "status") as
      { films: { revision: number }[] };
    const reloaded = await ok(c, "reload") as { revision: number };
    expect(reloaded.revision).toBeGreaterThan(before.films[0]!.revision);
    const r = await create(c, "B");
    expect(r.ok && (r.result as { revision: number }).revision)
      .toBeGreaterThan(reloaded.revision);
  });

  test("two spellings of one path are one film", async () => {
    const a = await connect();
    const b = await connect();
    await ok(a, "open", { path });
    await ok(b, "open", { path: join(ws.dir, ".", "..",
      basename(ws.dir), basename(path)) });
    expect(host.openCount).toBe(1);
  });

  test("opening the same path twice at once opens it once", async () => {
    const a = await connect();
    const b = await connect();
    await Promise.all([
      ok(a, "open", { path }), ok(b, "open", { path })]);
    expect(host.openCount).toBe(1);
  });
});
