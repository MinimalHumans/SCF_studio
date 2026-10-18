// SPDX-License-Identifier: Apache-2.0
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, test,
} from "vitest";
import { copyFileSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../src/db.ts";
import { openNodeDatabase, openNodeSession } from "../src/node.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "../src/registry.ts";
import { createRecord } from "../src/ops/recordOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

describe("a session on a file", () => {
  let dir: string;
  let path: string;
  let registry: Registry;
  let template: string;
  let templateDir: string;

  // Building the schema on disk is slow; do it once and copy.
  beforeAll(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    templateDir = mkdtempSync(join(tmpdir(), "scf-session-template-"));
    template = join(templateDir, "template.scf");
    const seed = openNodeDatabase(template);
    await initDatabase(seed.exec, registry);
    seed.close();
  }, 60_000);
  afterAll(() => { rmSync(templateDir, { recursive: true, force: true }); });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scf-session-"));
    path = join(dir, "film.scf");
    copyFileSync(template, path);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("a committed write is on disk once the session closes", async () => {
    const session = openNodeSession(path, registry);
    const id = await session.write((ctx) =>
      createRecord(ctx.exec, ctx.registry, "character", { name: "ELEANOR" }));
    expect(await session.persist()).toBe(true);
    expect(session.dirty).toBe(false);
    await session.close();

    const check = openNodeDatabase(path, { readOnly: true });
    const rows = await check.exec(
      "SELECT name FROM character WHERE id = ?", [id]);
    check.close();
    expect(rows[0]!["name"]).toBe("ELEANOR");
  });

  test("a read-only session cannot write, and reads still work", async () => {
    const session = openNodeSession(path, registry, { readOnly: true });
    await expect(session.write((ctx) =>
      createRecord(ctx.exec, ctx.registry, "character", { name: "X" })))
      .rejects.toThrow(/read-only/);
    expect(await session.exec("SELECT COUNT(*) AS n FROM character"))
      .toEqual([{ n: 0 }]);
    await session.close();
  });

  test("our own writes are not reported as external", async () => {
    const session = openNodeSession(path, registry);
    await session.write((ctx) =>
      createRecord(ctx.exec, ctx.registry, "character", { name: "A" }));
    expect(await session.hasExternalChange()).toBe(false);
    await session.close();
  });

  test("someone else touching the file is reported", async () => {
    const session = openNodeSession(path, registry);
    expect(await session.hasExternalChange()).toBe(false);
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    expect(await session.hasExternalChange()).toBe(true);
    await session.close();
  });

  test("a file that disappears counts as changed", async () => {
    const session = openNodeSession(path, registry);
    await session.hasExternalChange();
    rmSync(path);
    expect(await session.hasExternalChange()).toBe(true);
    await session.close();
  });
});
