// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "../src/node.ts";
import { initDatabase } from "../src/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "../src/registry.ts";
import {
  duplicateJunctions, junctionEntities, junctionKeyFields,
} from "../src/junctions.ts";

const REGISTRY_PATH = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

describe("a junction's natural key is the rows it joins", () => {
  let registry: Registry;
  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY_PATH, "utf8")) as RegistryJson);
  });

  const keyOf = (name: string): string[] =>
    junctionKeyFields(registry.entities.get(name)!);

  test("a plain pair", () => {
    expect(keyOf("scene_character")).toEqual(["scene_id", "character_id"]);
  });

  test("a polymorphic target counts", () => {
    // thematic_connection points at a theme and then at anything.
    expect(keyOf("thematic_connection"))
      .toEqual(["theme_id", "entity_type", "entity_id"]);
  });

  test("domain counts, because one motif can appear twice in a scene", () => {
    // Once visually and once sonically is two appearances, not a
    // duplicate.
    expect(keyOf("motif_appearance")).toContain("domain");
  });

  test("every link entity has one", () => {
    expect(junctionEntities(registry)).toHaveLength(13);
  });
});

describe("the fixture", () => {
  test("ships with no duplicate links", async () => {
    // It did not, when this check was written: two thematic connections
    // had been added over pairs the fixture already carried.
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY_PATH, "utf8")) as RegistryJson);
    const db = openNodeDatabase(fileURLToPath(new URL(
      "../../fixtures/hollow_creek.scf", import.meta.url)),
      { readOnly: true });
    try {
      expect(await duplicateJunctions(db.exec, registry)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("duplicate detection", () => {
  let registry: Registry;
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY_PATH, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO scene (name, scene_number) VALUES ('A', 1)");
    await db.exec("INSERT INTO character (name) VALUES ('Eleanor')");
  });

  const link = async (role: string | null): Promise<void> => {
    await db.exec(
      "INSERT INTO scene_character (scene_id, character_id, role_in_scene) " +
      "VALUES (1, 1, ?)", [role]);
  };

  test("a clean file reports nothing", async () => {
    await link("featured");
    expect(await duplicateJunctions(db.exec, registry)).toEqual([]);
  });

  test("two rows for one link are found whatever their content", async () => {
    await link("featured");
    await link("featured");
    const found = await duplicateJunctions(db.exec, registry);
    expect(found).toHaveLength(1);
    expect(found[0]!.entity).toBe("scene_character");
    expect(found[0]!.rowIds).toEqual([1, 2]);
    expect(found[0]!.contentDiffers).toBe(false);
  });

  test("disagreeing duplicates are called out separately", async () => {
    // The case that actually costs something: the link's authored
    // content is split, and a reader taking the first finds half.
    await link("featured");
    await link("background");
    const found = await duplicateJunctions(db.exec, registry);
    expect(found[0]!.contentDiffers).toBe(true);
    expect(found[0]!.message).toContain("merge them");
  });

  test("the same motif twice in a scene is fine in different domains",
       async () => {
    await db.exec("INSERT INTO motif (name) VALUES ('Open doors')");
    for (const domain of ["visual", "sonic"]) {
      await db.exec(
        "INSERT INTO motif_appearance (motif_id, scene_id, domain) " +
        "VALUES (1, 1, ?)", [domain]);
    }
    expect(await duplicateJunctions(db.exec, registry)).toEqual([]);
    await db.exec(
      "INSERT INTO motif_appearance (motif_id, scene_id, domain) " +
      "VALUES (1, 1, 'visual')");
    expect(await duplicateJunctions(db.exec, registry)).toHaveLength(1);
  });
});
