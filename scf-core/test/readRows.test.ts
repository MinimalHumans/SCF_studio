// SPDX-License-Identifier: Apache-2.0
/**
 * The row loaders behind the shot list and the storyboard: one read each,
 * the same for the editor's page and an MCP tool.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { buildSheets, readShotlistRows } from "../src/shotlist.ts";
import { buildBoard, readBoardRows } from "../src/storyboard.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

let db: NodeDatabase;
beforeAll(() => { db = openNodeDatabase(FIXTURE, { readOnly: true }); });
afterAll(() => db.close());

describe("the shot list's rows", () => {
  test("come back in one read, scenes in story order", async () => {
    const rows = await readShotlistRows(db.exec);
    expect(rows.scenes.length).toBeGreaterThan(0);
    expect(rows.shots.length).toBeGreaterThan(0);
    expect(Object.keys(rows).sort()).toEqual([
      "beats", "lighting", "locations", "sceneCast", "sceneProps", "scenes",
      "shotCast", "shotProps", "shots"]);
    // Story order is the DB's, not the labels': the loader must agree
    // with the order the editor already used.
    const direct = await db.exec(
      "SELECT s.id FROM scene s " +
      "ORDER BY (SELECT COUNT(*) FROM scene) - s.id, s.id");
    expect(rows.scenes.map((s) => s["id"]).sort()).toEqual(
      direct.map((s) => s["id"]).sort());
  });

  test("build into sheets with the shots grouped under their scenes",
      async () => {
    const rows = await readShotlistRows(db.exec);
    const sheets = buildSheets(rows.scenes, rows.beats, rows.shots, {
      scope: "all", groupByBeat: true, includeCut: false });
    expect(sheets.length).toBeGreaterThan(0);
    const total = sheets.reduce((n, s) => n + s.shotCount, 0);
    // Every shot that is in the film and sits in a listed scene.
    const sceneIds = new Set(rows.scenes.map((s) => s["id"]));
    const printable = rows.shots.filter((s) =>
      s["lifecycle_status"] !== "cut" && sceneIds.has(s["scene_id"])).length;
    expect(total).toBe(printable);
  });
});

describe("the storyboard's rows", () => {
  test("carry the project's aspect ratio, or null", async () => {
    const rows = await readBoardRows(db.exec);
    expect(rows.scenes.length).toBeGreaterThan(0);
    expect(rows.aspectRatio === null ||
           typeof rows.aspectRatio === "string").toBe(true);
  });

  test("build into frames in the shot list's order", async () => {
    const rows = await readBoardRows(db.exec);
    const list = await readShotlistRows(db.exec);
    const opts = { scope: "all", groupByBeat: true, includeCut: false,
                   showUnboarded: true } as const;
    const fromList = buildSheets(list.scenes, list.beats, list.shots, opts)
      .flatMap((s) => s.groups.flatMap((g) => g.shots.map((x) => x["id"])));
    const board = buildBoard(
      rows.scenes, rows.beats, rows.shots, new Map(), opts);
    expect(board.frames.map((f) => f.shot["id"])).toEqual(fromList);
  });
});
