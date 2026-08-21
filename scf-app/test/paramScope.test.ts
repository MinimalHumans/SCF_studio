// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

// The statements the shot picker uses, verbatim from QueryRunner.tsx.
const ALL_SHOTS = "SELECT * FROM shot ORDER BY scene_id, shot_order, id " +
                  "LIMIT 500";
const IN_SCENE = "SELECT * FROM shot WHERE scene_id = ? " +
                 "ORDER BY shot_order, id";

describe("choosing a scene narrows the shot picker", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  beforeAll(() => { db = openNodeDatabase(FIXTURE, { readOnly: true }); });

  test("unfiltered, every shot in the film is offered", async () => {
    const all = await db.exec(ALL_SHOTS);
    expect(all.length).toBeGreaterThan(20);
  });

  test("with a scene chosen, only that scene's coverage", async () => {
    // The pairing this prevents: a shot from sc 3 asked about in sc 12,
    // which the query has no way to answer.
    const scene = Number((await db.exec(
      "SELECT id FROM scene WHERE scene_number = 12"))[0]!["id"]);
    const inScene = await db.exec(IN_SCENE, [scene]);
    expect(inScene.length).toBeGreaterThan(0);
    expect(inScene.every((r) => Number(r["scene_id"]) === scene))
      .toBe(true);
    const all = await db.exec(ALL_SHOTS);
    expect(inScene.length).toBeLessThan(all.length);
  });

  test("shots come back in coverage order", async () => {
    const scene = Number((await db.exec(
      "SELECT id FROM scene WHERE scene_number = 19"))[0]!["id"]);
    const orders = (await db.exec(IN_SCENE, [scene]))
      .map((r) => Number(r["shot_order"]));
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test("a scene with no coverage offers nothing", async () => {
    const bare = await db.exec(
      "SELECT s.id FROM scene s LEFT JOIN shot sh ON sh.scene_id = s.id " +
      "WHERE sh.id IS NULL LIMIT 1");
    if (bare.length === 0) return;
    expect(await db.exec(IN_SCENE, [Number(bare[0]!["id"])])).toEqual([]);
  });
});
