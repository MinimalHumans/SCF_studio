/**
 * initDatabase.test.ts — schema parity between TS initDatabase and the
 * Python-created fixture.
 *
 * "The `.scf` format is sacred and survives unchanged — same files, same
 * SQL, same tables." A fresh database created by scf-core must have, for
 * every registry entity, exactly the column set the fixture has, plus the
 * uuid unique index and the 2.3 schema_version stamp.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid, readMeta, tableColumns } from "../src/db.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { FIXTURE_PATH, registry } from "./setup.ts";

let fresh: NodeDatabase;
let fixture: NodeDatabase;

beforeAll(async () => {
  fresh = openNodeDatabase(":memory:");
  await initDatabase(fresh.exec, registry, { editorVersion: "scf-core-test" });
  fixture = openNodeDatabase(FIXTURE_PATH, { readOnly: true });
});

afterAll(() => {
  fresh.close();
  fixture.close();
});

describe("initDatabase parity with the fixture", () => {
  test("all 99 registry tables exist", async () => {
    const tables = await fresh.exec(
      "SELECT name FROM sqlite_master WHERE type='table'");
    const names = new Set(tables.map((r) => String(r["name"])));
    for (const entity of registry.order) {
      expect(names.has(entity), `missing table ${entity}`).toBe(true);
    }
    expect(registry.order).toHaveLength(99);
  });

  test("column sets match the fixture per registry table", async () => {
    for (const entity of registry.order) {
      const ours = await tableColumns(fresh.exec, entity);
      const theirs = await tableColumns(fixture.exec, entity);
      expect([...ours].sort(), `columns of ${entity}`)
        .toEqual([...theirs].sort());
    }
  });

  test("schema_version stamped identically", async () => {
    const ourMeta = await readMeta(fresh.exec);
    const theirMeta = await readMeta(fixture.exec);
    expect(ourMeta["schema_version"]).toBe("2.3");
    expect(ourMeta["schema_version"]).toBe(theirMeta["schema_version"]);
  });

  test("uuid unique index exists on every registry table", async () => {
    const idx = await fresh.exec(
      "SELECT name FROM sqlite_master WHERE type='index'");
    const names = new Set(idx.map((r) => String(r["name"])));
    for (const entity of registry.order) {
      expect(names.has(`idx_${entity}_uuid`),
             `missing uuid index on ${entity}`).toBe(true);
    }
  });

  test("uuid uniqueness enforced; insert round-trip works", async () => {
    const u = newUuid();
    await fresh.exec(
      "INSERT INTO character (uuid, name) VALUES (?, ?)", [u, "Test"]);
    await expect(
      fresh.exec("INSERT INTO character (uuid, name) VALUES (?, ?)",
                 [u, "Dupe"]),
    ).rejects.toThrow();
    const rows = await fresh.exec(
      "SELECT name, created_at FROM character WHERE uuid=?", [u]);
    expect(rows[0]?.["name"]).toBe("Test");
    expect(rows[0]?.["created_at"]).toBeTruthy();
  });

  test("idempotent: re-running initDatabase is a no-op", async () => {
    await initDatabase(fresh.exec, registry);
    const rows = await fresh.exec("SELECT COUNT(*) AS n FROM character");
    expect(rows[0]?.["n"]).toBe(1);
  });
});
