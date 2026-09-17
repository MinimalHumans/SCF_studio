// SPDX-License-Identifier: Apache-2.0
/**
 * mediaChecks.test.ts — the editor's media findings.
 *
 * Every case below is a shape the first MCP session met in the fixture
 * before it was re-authored: the checks are pinned against those shapes
 * in a scratch database, and against the fixture itself, which should
 * now report exactly one thing — a costume bundle that has no binding
 * entity to be bound through.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import {
  adoptSpelling, commaListToJson, intentConflict, lookalikeGroups,
  mediaFindingCount, mediaKindOf, scanMedia,
} from "../src/editor/mediaChecks.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));
const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

async function loadReg(): Promise<Registry> {
  return loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
}

describe("pure helpers", () => {
  test("media kind comes from the extension", () => {
    expect(mediaKindOf("@project/sound/chime.WAV")).toBe("audio");
    expect(mediaKindOf("@project/plates/kitchen.exr")).toBe("image");
    expect(mediaKindOf("@project/scans/locket.glb")).toBe("model");
    expect(mediaKindOf("@project/ref/face.mp4")).toBe("video");
    expect(mediaKindOf("@project/ref/textures.zip")).toBe("other");
    expect(mediaKindOf("@project/ref/README")).toBeNull();
  });

  test("only contradictions a person would call mistakes", () => {
    expect(intentConflict("visual_identity", "audio")).toMatch(/sound query/);
    expect(intentConflict("acoustic", "image")).toMatch(/picture query/);
    expect(intentConflict("voice_identity", "video")).toBeNull();
    expect(intentConflict("visual_identity", "video")).toBeNull();
    expect(intentConflict("other", "audio")).toBeNull();
    expect(intentConflict("behavior", "image")).toBeNull();
  });

  test("case, spacing and one-letter slips group; short words do not", () => {
    const groups = lookalikeGroups([
      "reference", "Reference", "reference", "Blckbox via Nano Banana Pro",
      "Blckbox via Nano Banana Prop", "face", "lace", null, "",
    ]);
    expect(groups).toEqual([
      [{ value: "reference", count: 2 }, { value: "Reference", count: 1 }],
      [{ value: "Blckbox via Nano Banana Pro", count: 1 },
       { value: "Blckbox via Nano Banana Prop", count: 1 }],
    ]);
  });

  test("a typed value adopts an existing spelling only on an exact fold", () => {
    expect(adoptSpelling("  Reference ", ["reference", "face"]))
      .toBe("reference");
    expect(adoptSpelling("referenc", ["reference"])).toBe("referenc");
    expect(adoptSpelling("framing", [])).toBe("framing");
  });

  test("a comma list becomes the array it meant to be", () => {
    expect(commaListToJson("location, kitchen,night"))
      .toBe('["location","kitchen","night"]');
    expect(commaListToJson('["already"]')).toBeNull();
    expect(commaListToJson('{"half": ')).toBeNull();
    expect(commaListToJson("  ")).toBeNull();
  });
});

describe("scanMedia on the shapes the session found", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;

  beforeEach(async () => {
    registry = await loadReg();
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    const run = (sql: string): Promise<unknown> => db.exec(sql);
    await run("INSERT INTO location (id, name) VALUES (1, 'Kitchen')");
    await run("INSERT INTO prop (id, name) VALUES (1, 'Chime')");
    await run("INSERT INTO scene (id, name, scene_number) VALUES (1, 'A', '3')");
    await run("INSERT INTO bundle (id, name, intent) VALUES " +
              "(1, 'Kitchen baseline', 'visual_identity'), " +
              "(2, 'Scene 03 kitchen', 'visual_identity'), " +
              "(3, 'Chime', 'visual_identity')");
    await run("INSERT INTO asset (id, name, identifier, source, tags) VALUES " +
              "(1, 'day.png', '@project/k/day.png', 'Midjourney', NULL), " +
              "(2, 'plate.png', '@project/k/plate.png', 'MidJourney', " +
              "   'location,kitchen'), " +
              "(3, 'takes.wav', '@project/s/takes.wav', NULL, NULL)");
    await run("INSERT INTO bundle_asset (bundle_id, asset_id, role_in_bundle) " +
              "VALUES (1, 1, 'reference'), (2, 2, 'Reference'), (3, 3, 'takes')");
    // Both kitchen bindings on the scene bundle — the baseline bundle
    // reaches nobody — and the scene one applies everywhere.
    await run("INSERT INTO location_asset_binding " +
              "(location_id, bundle_id, is_baseline, name) VALUES " +
              "(1, 2, 0, 'Kitchen Day'), (1, 2, 0, 'Kitchen Day again')");
    await run("INSERT INTO prop_asset_binding (prop_id, bundle_id, is_baseline) " +
              "VALUES (1, 3, 1)");
  });

  test("every class is reported once", async () => {
    const r = await scanMedia(db.exec, registry);
    expect(r.unboundBundles.map((b) => b.name)).toEqual(["Kitchen baseline"]);
    expect(r.duplicateBindings).toHaveLength(1);
    expect(r.duplicateBindings[0]?.map((b) => b.name))
      .toEqual(["Kitchen Day", "Kitchen Day again"]);
    expect(r.everywhereBindings.map((b) => b.name))
      .toEqual(["Kitchen Day", "Kitchen Day again"]);
    expect(r.intentConflicts.map((c) => c.assetName)).toEqual(["takes.wav"]);
    expect(r.lookalikes.map((l) => `${l.entity}.${l.field}`))
      .toEqual(["bundle_asset.role_in_bundle", "asset.source"]);
    expect(r.invalidJson).toEqual([{
      entity: "asset", field: "tags", id: 2, value: "location,kitchen",
      suggestion: '["location","kitchen"]',
    }]);
  });

  test("a ranged binding is not an everywhere binding; a cut one is gone",
       async () => {
    await db.exec("UPDATE location_asset_binding SET scene_range_start_id = 1, " +
                  "scene_range_end_id = 1 WHERE name = 'Kitchen Day'");
    await db.exec("UPDATE location_asset_binding SET lifecycle_status = 'cut' " +
                  "WHERE name = 'Kitchen Day again'");
    const r = await scanMedia(db.exec, registry);
    expect(r.everywhereBindings).toEqual([]);
    expect(r.duplicateBindings).toEqual([]);
  });
});

describe("scanMedia on the fixture", () => {
  test("one finding: the costume bundle with nowhere to be bound", async () => {
    const registry = await loadReg();
    const db = openNodeDatabase(FIXTURE, { readOnly: true });
    try {
      const r = await scanMedia(db.exec, registry);
      expect(r.unboundBundles.map((b) => b.name)).toEqual(["Ada's Shawl"]);
      expect(mediaFindingCount(r)).toBe(1);
    } finally {
      db.close();
    }
  });
});
