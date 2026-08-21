// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

// The rail's filter statements, copied verbatim from SceneRail.tsx.
// Importing the view would pull in the store, which spawns a Worker.
const FILTER = {
  character: "SELECT scene_id FROM scene_character WHERE character_id = ?",
  prop: "SELECT scene_id FROM scene_prop WHERE prop_id = ?",
  location: "SELECT id AS scene_id FROM scene WHERE location_id = ?",
};

describe("filtering the scene rail by contents", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  beforeAll(() => { db = openNodeDatabase(FIXTURE, { readOnly: true }); });

  test("by character: a lead is in many scenes, not all", async () => {
    const id = Number((await db.exec(
      "SELECT id FROM character WHERE name LIKE '%Eleanor%'"))[0]!["id"]);
    const scenes = await db.exec(FILTER.character, [id]);
    const total = Number((await db.exec(
      "SELECT COUNT(*) AS n FROM scene"))[0]!["n"]);
    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.length).toBeLessThan(total);
  });

  test("by prop: narrows to the scenes that hold it", async () => {
    const id = Number((await db.exec(
      "SELECT id FROM prop WHERE name LIKE '%locket%'"))[0]!["id"]);
    expect((await db.exec(FILTER.prop, [id])).length).toBeGreaterThan(0);
  });

  test("by location: a location reached through scene.location_id",
       async () => {
    const id = Number((await db.exec(
      "SELECT id FROM location WHERE name LIKE '%KITCHEN%'"))[0]!["id"]);
    expect((await db.exec(FILTER.location, [id])).length)
      .toBeGreaterThan(0);
  });

  test("every filter returns scene ids that exist", async () => {
    const ids = new Set((await db.exec("SELECT id FROM scene"))
      .map((r) => Number(r["id"])));
    for (const sql of Object.values(FILTER)) {
      const rows = await db.exec(sql, [1]);
      expect(rows.every((r) => ids.has(Number(r["scene_id"])))).toBe(true);
    }
  });
});
