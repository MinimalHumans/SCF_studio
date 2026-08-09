import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { initScreenplayTables } from "@scf-core/screenplay/rowModel.ts";
import {
  describeChildren, duplicateSceneRow, planSceneRemoval,
  removeSceneCascade, sceneCascade,
} from "../src/editor/sceneOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("sceneCascade", () => {
  let registry: Registry;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
  });

  test("a row with scene_id belongs to the scene and goes", () => {
    const owned = sceneCascade(registry).owned.map((o) => o.table);
    expect(owned).toContain("shot");
    expect(owned).toContain("performance_beat");
    expect(owned).toContain("story_beat");
    expect(owned).toContain("scene_character");
    expect(owned).toContain("scene_prop");
  });

  test("any other reference only loses the pointer", () => {
    const cascade = sceneCascade(registry);
    const pointing = cascade.pointing.map((p) => `${p.table}.${p.field}`);
    // A motif outlives the scene it first appeared in.
    expect(pointing).toContain("motif.first_appearance_scene_id");
    // An asset binding spans a range; losing an endpoint must not
    // destroy the binding.
    expect(pointing).toContain(
      "prop_asset_binding.scene_range_start_id");
    expect(cascade.owned.map((o) => o.table)).not.toContain("motif");
  });

  test("act and sequence boundaries are excluded from both", () => {
    // They are re-anchored before the delete instead — an act whose
    // anchor scene is deleted vanishes from the derived structure and
    // takes every scene it held with it.
    const cascade = sceneCascade(registry);
    const all = [...cascade.owned, ...cascade.pointing]
      .map((x) => `${x.table}.${x.field}`);
    expect(all).not.toContain("act.start_scene_id");
    expect(all).not.toContain("sequence.start_scene_id");
  });

  test("the rule is derived, so a new entity needs no edit here", () => {
    // Every scene reference in the registry is classified one way or the
    // other; nothing falls through.
    const cascade = sceneCascade(registry);
    let referencing = 0;
    for (const entity of registry.entities.values()) {
      for (const field of entity.fields) {
        if (field.referenceEntity === "scene") referencing += 1;
      }
    }
    expect(cascade.owned.length + cascade.pointing.length)
      .toBe(referencing - 2); // minus the two boundaries
  });
});

describe("removing a scene", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);
    await db.exec(
      "INSERT INTO scene (name, scene_number) VALUES ('KITCHEN', 1)");
    await db.exec("INSERT INTO scene (name) VALUES ('RIDGE')");
    await db.exec("INSERT INTO character (name) VALUES ('Alexis')");
    await db.exec("INSERT INTO prop (name) VALUES ('Kettle')");
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('wide', 1, '1A')");
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('close', 1, '1B')");
    await db.exec(
      "INSERT INTO performance_beat (name, scene_id, character_id, " +
      "modality) VALUES ('Beat', 1, 1, 'vocal')");
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 1, 1)");
    await db.exec(
      "INSERT INTO motif (name, first_appearance_scene_id) " +
      "VALUES ('Water', 1)");
    await db.exec(
      "INSERT INTO screenplay_prop_tags (tagged_text, prop_id, " +
      "line_uuid, start_offset, end_offset) VALUES ('kettle', 1, 'L1', 0, 6)");
  });

  test("the plan counts what will actually die", async () => {
    const impact = await planSceneRemoval(
      db.exec, registry, 1, ["L0", "L1"]);
    expect(impact.sceneName).toBe("KITCHEN");
    expect(impact.lines).toBe(2);
    const byTable = new Map(
      impact.children.map((c) => [c.table, c.count]));
    expect(byTable.get("shot")).toBe(2);
    expect(byTable.get("performance_beat")).toBe(1);
    expect(byTable.get("scene_character")).toBe(1);
    // The motif points at the scene; it is not a child.
    expect(byTable.has("motif")).toBe(false);
    expect(impact.references).toBe(1);
    expect(impact.propTags).toBe(1);
  });

  test("the plan changes nothing", async () => {
    await planSceneRemoval(db.exec, registry, 1, ["L1"]);
    expect(await db.exec("SELECT id FROM scene")).toHaveLength(2);
    expect(await db.exec("SELECT id FROM shot")).toHaveLength(2);
  });

  test("children die, pointers are cleared, the scene goes", async () => {
    await removeSceneCascade(db.exec, registry, 1, ["L0", "L1"]);

    expect(await db.exec("SELECT id FROM shot")).toHaveLength(0);
    expect(await db.exec("SELECT id FROM performance_beat"))
      .toHaveLength(0);
    expect(await db.exec("SELECT id FROM scene_character"))
      .toHaveLength(0);
    expect(await db.exec("SELECT id FROM screenplay_prop_tags"))
      .toHaveLength(0);

    // The motif survives with a cleared pointer, and the prop is
    // untouched — neither belonged to the scene.
    const motifs = await db.exec(
      "SELECT first_appearance_scene_id FROM motif");
    expect(motifs).toHaveLength(1);
    expect(motifs[0]!["first_appearance_scene_id"]).toBeNull();
    expect(await db.exec("SELECT id FROM prop")).toHaveLength(1);

    const scenes = await db.exec("SELECT id FROM scene");
    expect(scenes.map((r) => r["id"])).toEqual([2]);
  });

  test("another scene's children are left alone", async () => {
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('wide', 2, '2A')");
    await removeSceneCascade(db.exec, registry, 1, []);
    const shots = await db.exec("SELECT scene_id FROM shot");
    expect(shots).toHaveLength(1);
    expect(shots[0]!["scene_id"]).toBe(2);
  });
});

describe("duplicating a scene", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);
    await db.exec("INSERT INTO location (name) VALUES ('Kitchen')");
    await db.exec(
      "INSERT INTO scene (name, scene_number, int_ext, time_of_day, " +
      "location_id, status, external_id, external_id_namespace) " +
      "VALUES ('INT. KITCHEN - DAY', 4, 'interior', 'day', 1, " +
      "'revised', 'fdx-12', 'scf:import')");
  });

  test("the record's own fields come across", async () => {
    const id = await duplicateSceneRow(db.exec, 1);
    const rows = await db.exec("SELECT * FROM scene WHERE id = ?", [id]);
    const copy = rows[0]!;
    expect(copy["name"]).toBe("INT. KITCHEN - DAY");
    expect(copy["int_ext"]).toBe("interior");
    expect(copy["location_id"]).toBe(1);
    expect(copy["status"]).toBe("revised");
  });

  test("position and foreign identity do NOT come across", async () => {
    const id = await duplicateSceneRow(db.exec, 1);
    const copy = (await db.exec(
      "SELECT * FROM scene WHERE id = ?", [id]))[0]!;
    // A number is a position, derived at the next commit.
    expect(copy["scene_number"]).toBeNull();
    // The duplicate is not the row that fdx-12 names.
    expect(copy["external_id"]).toBeNull();
    expect(copy["external_id_namespace"]).toBeNull();
    expect(copy["uuid"]).not.toBe(
      (await db.exec("SELECT uuid FROM scene WHERE id = 1"))[0]!["uuid"]);
  });

  test("coverage is not copied", async () => {
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('wide', 1, '4A')");
    const id = await duplicateSceneRow(db.exec, 1);
    const shots = await db.exec(
      "SELECT id FROM shot WHERE scene_id = ?", [id]);
    // Duplicating a shot list is how two scenes end up claiming 4A.
    expect(shots).toHaveLength(0);
  });
});

describe("describeChildren", () => {
  test("reads as a sentence, and pluralizes", () => {
    expect(describeChildren([
      { table: "shot", count: 8 },
      { table: "performance_beat", count: 1 },
    ])).toBe("8 shots, 1 performance beat");
  });

  test("is empty when there is nothing to warn about", () => {
    expect(describeChildren([])).toBe("");
  });
});
