// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test }
  from "vitest";
import {
  existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync,
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

  test("create and list stay inside the roots, links included", async () => {
    expect((await err("create", { path: join(ws.dir, "escape.scf") })).code)
      .toBe("outside_roots");
    expect((await err("list", { path: ws.dir })).code)
      .toBe("outside_roots");
    const link = join(root, "films", "link");
    symlinkSync(ws.dir, link, "junction");   // no privilege needed on Windows
    expect((await err("create", { path: join(link, "x.scf") })).code)
      .toBe("outside_roots");
    expect((await err("list", { path: link })).code).toBe("outside_roots");
    expect((await err("create", {
      path: join(root, "..", "..", "etc", "x.scf") })).code)
      .toBe("outside_roots");
  });

  test("list shows folders first, then .scf files, and hides the rest",
      async () => {
    writeFileSync(join(root, "films", "a.scf"), "");
    writeFileSync(join(root, "films", "notes.txt"), "");
    writeFileSync(join(root, "films", ".hidden.scf"), "");
    const r = await ok("list", { path: join(root, "films") }) as {
      parent: string | null;
      entries: { name: string; kind: string }[] };
    expect(r.entries.map((e) => `${e.kind}:${e.name}`))
      .toEqual(["dir:sub", "scf:a.scf"]);
    expect(r.parent).toBe(root);
    const top = await ok("list", {}) as {
      path: string | null; entries: { path: string }[] };
    expect(top.path).toBeNull();
    expect(top.entries.map((e) => e.path)).toEqual([root]);
    const atRoot = await ok("list", { path: root }) as
      { parent: string | null };
    expect(atRoot.parent).toBeNull();
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
