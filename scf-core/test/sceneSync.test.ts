// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "../src/node.ts";
import { initDatabase } from "../src/db.ts";
import { loadRegistry, type RegistryJson } from "../src/registry.ts";
import { initScreenplayTables } from "../src/screenplay/rowModel.ts";
import {
  syncSceneFromHeading, unlinkLineScene,
} from "../src/ops/sceneOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

describe("scene repairs from the editor", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);
    await db.exec("INSERT INTO location (name) VALUES ('KITCHEN')");
    await db.exec("INSERT INTO location (name) VALUES ('GARAGE')");
    await db.exec(
      "INSERT INTO scene (name, int_ext, time_of_day, location_id) " +
      "VALUES ('INT. KITCHEN - NIGHT', 'interior', 'night', 1)");
  });

  test("unlinking clears the line's scene and nothing else", async () => {
    await db.exec(
      "INSERT INTO screenplay_lines (uuid, line_order, line_type, content, " +
      "scene_id) VALUES ('a', 1, 'heading', 'H', 1), " +
      "('b', 2, 'action', 'x', 1)");
    await unlinkLineScene(db.exec, "a");
    const rows = await db.exec(
      "SELECT uuid, scene_id FROM screenplay_lines ORDER BY line_order");
    expect(rows.map((r) => r["scene_id"] ?? null)).toEqual([null, 1]);
  });

  test("sync renames the scene and moves it to the typed location",
      async () => {
    const found = await syncSceneFromHeading(db.exec, 1, {
      name: "EXT. GARAGE - DAY", int_ext: "EXT", time_of_day: "DAY",
      location: "Garage",
    });
    expect(found).toBe(2);
    const row = (await db.exec("SELECT * FROM scene WHERE id = 1"))[0]!;
    expect(row["name"]).toBe("EXT. GARAGE - DAY");
    expect(row["int_ext"]).toBe("exterior");
    expect(row["time_of_day"]).toBe("day");
    expect(row["location_id"]).toBe(2);
  });

  test("a location that does not exist yet is left alone, not created",
      async () => {
    const found = await syncSceneFromHeading(db.exec, 1, {
      name: "INT. CELLAR - NIGHT", int_ext: "INT", time_of_day: null,
      location: "Cellar",
    });
    expect(found).toBeNull();
    const row = (await db.exec("SELECT * FROM scene WHERE id = 1"))[0]!;
    expect(row["name"]).toBe("INT. CELLAR - NIGHT");
    expect(row["location_id"]).toBe(1); // unchanged
    expect(row["time_of_day"]).toBe("night"); // null leaves it as it was
    expect(await db.exec("SELECT id FROM location")).toHaveLength(2);
  });

  test("INT/EXT maps to int/ext", async () => {
    await syncSceneFromHeading(db.exec, 1, {
      name: "INT/EXT. CAR", int_ext: "INT/EXT", time_of_day: null,
      location: null,
    });
    const row = (await db.exec("SELECT int_ext FROM scene WHERE id = 1"))[0]!;
    expect(row["int_ext"]).toBe("int/ext");
  });
});
