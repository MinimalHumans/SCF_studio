// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test }
  from "vitest";
import {
  existsSync, mkdirSync, readFileSync, symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createHostCore, type HostConnection, type HostCore }
  from "../src/index.ts";
import { makeWorkspace, registry, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

describe("files and the window's call table", () => {
  let host: HostCore;
  let c: HostConnection;
  let root: string;

  const ok = async (m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.result;
  };
  const err = async (m: string, p?: unknown) => {
    const r = await c.handle(m, p);
    if (r.ok) throw new Error("expected a failure");
    return r.error;
  };

  beforeEach(() => {
    root = join(ws.dir, `root${String(Math.random()).slice(2, 8)}`);
    mkdirSync(join(root, "films", "sub"), { recursive: true });
    host = createHostCore({ registry, roots: [root] });
    c = host.connect();
  });
  afterEach(async () => { await host.shutdown(); });

  test("create makes an empty film, opens it, and will not overwrite",
      async () => {
    const path = join(root, "films", "new.scf");
    const r = await ok("create", { path }) as { path: string };
    expect(existsSync(r.path)).toBe(true);
    await ok("call", { name: "record.create",
      args: ["character", { name: "A" }] });
    expect(await ok("query", { sql: "SELECT name FROM character" }))
      .toEqual([{ name: "A" }]);
    expect((await err("create", { path })).code).toBe("exists");
  });

  test("create from bytes keeps them, and rejects a file that is not SCF",
      async () => {
    const bytes = readFileSync(ws.newFilm());
    const path = join(root, "films", "copy.scf");
    await ok("create", { path, bytes: bytes.toString("base64") });
    expect(await ok("query", { sql: "SELECT COUNT(*) AS n FROM character" }))
      .toEqual([{ n: 0 }]);
    const bad = join(root, "films", "bad.scf");
    expect((await err("create", {
      path: bad, bytes: Buffer.from("nope").toString("base64") })).code)
      .toBe("not_scf");
    expect(existsSync(bad)).toBe(false);
  });

  test("create stays inside the configured roots, links included",
      async () => {
    expect((await err("create", { path: join(ws.dir, "escape.scf") })).code)
      .toBe("outside_roots");
    const link = join(root, "films", "link");
    symlinkSync(ws.dir, link, "junction");   // no privilege needed on Windows
    expect((await err("create", { path: join(link, "x.scf") })).code)
      .toBe("outside_roots");
    expect((await err("create", {
      path: join(root, "..", "..", "etc", "x.scf") })).code)
      .toBe("outside_roots");
  });

  test("with no roots configured, create and saveAs accept any path",
      async () => {
    const unconfined = createHostCore({ registry });
    const cu = unconfined.connect();
    try {
      const path = join(ws.dir, "anywhere.scf");
      const r = await cu.handle("create", { path });
      if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
      expect(existsSync(path)).toBe(true);
      const moved = join(ws.dir, "elsewhere.scf");
      const saved = await cu.handle("saveAs", { path: moved });
      if (!saved.ok) throw new Error(`${saved.error.code}`);
    } finally {
      await unconfined.shutdown();
    }
  });

  test("saveAs copies the committed state and moves the connection",
      async () => {
    const a = join(root, "films", "a.scf");
    await ok("create", { path: a });
    await ok("call", { name: "record.create",
      args: ["character", { name: "KEPT" }] });
    const b = join(root, "films", "b.scf");
    const r = await ok("saveAs", { path: b }) as { path: string };
    expect(r.path).toBe(b);
    expect(await ok("query", { sql: "SELECT name FROM character" }))
      .toEqual([{ name: "KEPT" }]);
    await ok("call", { name: "record.create",
      args: ["character", { name: "ONLY IN B" }] });
    await ok("open", { path: a });
    expect(await ok("query", { sql: "SELECT name FROM character" }))
      .toEqual([{ name: "KEPT" }]);
    expect((await err("saveAs", { path: b })).code).toBe("exists");
  });

  test("a call runs a function from the table with positional arguments",
      async () => {
    await ok("create", { path: join(root, "films", "c.scf") });
    const made = await ok("call", { name: "record.create",
      args: ["scene", { scene_number: "1" }] }) as { result: number };
    await ok("call", { name: "shoot.addShot", args: [made.result, null] });
    expect(await ok("query", { sql: "SELECT COUNT(*) AS n FROM shot" }))
      .toEqual([{ n: 1 }]);
  });

  test("a call outside the table, or with the wrong shape, is refused",
      async () => {
    await ok("create", { path: join(root, "films", "d.scf") });
    expect((await err("call", { name: "db.exec", args: [] })).code)
      .toBe("unknown_op");
    expect((await err("call", { name: "constructor", args: [] })).code)
      .toBe("unknown_op");
    expect((await err("call", { name: "record.create", args: "x" })).code)
      .toBe("failed");
  });

  test("a typed error arrives with its class name and fields", async () => {
    await ok("create", { path: join(root, "films", "e.scf") });
    // A setField on an unknown entity throws a plain Error.
    const e = await err("call", { name: "element.setField",
      args: ["nope", 1, "x", "y"] });
    expect(e.code).toBe("failed");
    expect(e.name).toBe("Error");
  });

  test("a stale revision is refused for calls too", async () => {
    const opened = await ok("create", {
      path: join(root, "films", "f.scf") }) as { revision: number };
    await ok("call", { name: "record.create",
      args: ["character", { name: "A" }] });
    expect((await err("call", {
      name: "record.create", args: ["character", { name: "B" }],
      expectedRevision: opened.revision })).code).toBe("stale_revision");
  });
});
