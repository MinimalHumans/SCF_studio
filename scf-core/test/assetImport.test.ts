// SPDX-License-Identifier: Apache-2.0
/**
 * assetImport.test.ts — bulk import (P4 follow-on).
 *
 * The property that matters is idempotence: importing a folder, adding
 * three files, and importing again should create three rows and leave
 * everything else alone. Anything less and nobody will run it twice.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  applyAssetImport, candidatePaths, nameFromIdentifier, planAssetImport,
} from "../src/assetImport.ts";
import { listAssets } from "../src/assetIndex.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { registry } from "./setup.ts";

describe("nameFromIdentifier", () => {
  test("takes the last segment", () => {
    expect(nameFromIdentifier("@project/a/b/plate_v3.exr"))
      .toBe("plate_v3.exr");
  });

  test("copes with a bare root", () => {
    expect(nameFromIdentifier("@project/x.png")).toBe("x.png");
  });
});

describe("planAssetImport", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "import-test" });
    await db.exec(
      "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
      ["existing.png", newUuid(), "@project/a/existing.png"]);
  });

  afterAll(() => db.close());

  test("separates new rows from ones already in the file", async () => {
    const plan = await planAssetImport(db.exec, [
      { identifier: "@project/a/existing.png" },
      { identifier: "@project/a/fresh.png" },
    ]);
    expect(plan.create.map((c) => c.identifier))
      .toEqual(["@project/a/fresh.png"]);
    expect(plan.existing[0]?.identifier).toBe("@project/a/existing.png");
  });

  test("the same file offered twice is one row", async () => {
    const plan = await planAssetImport(db.exec, [
      { identifier: "@project/a/dup.png" },
      { identifier: "@project/a/dup.png" },
    ]);
    expect(plan.create).toHaveLength(1);
  });

  test("same filename in different folders is two assets", async () => {
    const plan = await planAssetImport(db.exec, [
      { identifier: "@project/a/plate.exr" },
      { identifier: "@project/b/plate.exr" },
    ]);
    expect(plan.create).toHaveLength(2);
  });

  test("an unusable identifier is rejected, not silently dropped",
    async () => {
      const plan = await planAssetImport(db.exec, [{ identifier: "  " }]);
      expect(plan.create).toHaveLength(0);
      expect(plan.rejected).toHaveLength(1);
    });

  test("planning writes nothing", async () => {
    const before = (await listAssets(db.exec)).length;
    await planAssetImport(db.exec, [{ identifier: "@project/z/new.png" }]);
    expect((await listAssets(db.exec)).length).toBe(before);
  });
});

describe("applyAssetImport", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "import-test" });
  });

  afterAll(() => db.close());

  test("creates rows with derived names and stored hints", async () => {
    const created = await applyAssetImport(db.exec, [
      { identifier: "@project/assets/plates/sh010_v3.exr",
        sizeBytes: 1024, mtime: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(created).toBe(1);
    const [row] = await db.exec(
      "SELECT name, identifier, size_bytes, source_mtime, content_hash " +
      "FROM asset");
    expect(row?.["name"]).toBe("sh010_v3.exr");
    expect(row?.["size_bytes"]).toBe(1024);
    // Hashing a folder's worth of files on import is never done.
    expect(row?.["content_hash"]).toBeNull();
  });

  test("every created row gets identity", async () => {
    const assets = await listAssets(db.exec);
    expect(assets.length).toBeGreaterThan(0);
    const [row] = await db.exec("SELECT uuid FROM asset LIMIT 1");
    expect(String(row?.["uuid"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("re-importing the same folder plus additions is additive",
    async () => {
      const folder = [
        { identifier: "@project/assets/plates/sh010_v3.exr" },
        { identifier: "@project/assets/plates/sh020_v1.exr" },
        { identifier: "@project/assets/plates/sh030_v1.exr" },
      ];
      const plan = await planAssetImport(db.exec, folder);
      expect(plan.create).toHaveLength(2);   // sh010 already imported
      await applyAssetImport(db.exec, plan.create);

      const again = await planAssetImport(db.exec, folder);
      expect(again.create).toHaveLength(0);
      expect(again.existing).toHaveLength(3);
      expect(await listAssets(db.exec)).toHaveLength(3);
    });
});

describe("import at scale", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "scale-test" });
  });

  afterAll(() => db.close());

  test("2,000 files import and plan clean on the second pass",
    async () => {
      const files = Array.from({ length: 2000 }, (_, i) => ({
        identifier: `@project/assets/seq${
          String(i % 40).padStart(3, "0")}/plate_${i}.exr`,
        sizeBytes: i * 10,
      }));

      await db.exec("BEGIN");
      const plan = await planAssetImport(db.exec, files);
      expect(plan.create).toHaveLength(2000);
      await applyAssetImport(db.exec, plan.create);
      await db.exec("COMMIT");

      const second = await planAssetImport(db.exec, files);
      expect(second.create).toHaveLength(0);
      expect(second.existing).toHaveLength(2000);
    });
});

describe("candidatePaths", () => {
  test("strips the root's own name when that is what was picked", () => {
    // Picking AlexisNexus reports AlexisNexus/assets/x.png; the root is
    // already AlexisNexus, so the identifier must not repeat it.
    expect(candidatePaths("AlexisNexus/assets/x.png", "AlexisNexus")[0])
      .toBe("assets/x.png");
  });

  test("keeps the leading segment when a subfolder was picked", () => {
    // Picking `assets` reports assets/test.png, which IS the path
    // relative to the root.
    expect(candidatePaths("assets/test.png", "AlexisNexus"))
      .toContain("assets/test.png");
  });

  test("offers both readings so traversal can settle it", () => {
    const paths = candidatePaths("AlexisNexus/assets/x.png", "AlexisNexus");
    expect(paths).toEqual(["assets/x.png", "AlexisNexus/assets/x.png"]);
  });

  test("a folder picked from elsewhere still offers its tail", () => {
    const paths = candidatePaths("plates/sh010/bg.exr", null);
    expect(paths).toEqual(["plates/sh010/bg.exr", "sh010/bg.exr"]);
  });

  test("a bare filename has one reading", () => {
    expect(candidatePaths("x.png", "AlexisNexus")).toEqual(["x.png"]);
  });

  test("empty input yields nothing to try", () => {
    expect(candidatePaths("", "root")).toEqual([]);
  });
});
