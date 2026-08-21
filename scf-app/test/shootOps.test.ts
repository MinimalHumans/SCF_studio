// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import {
  addBeat, addShot, moveShot, removeBeat, removeShot, renumberForScene,
  summarize,
} from "../src/editor/shootOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("what a collapsed scene row says", () => {
  test("beats count as work, so a broken-down scene is not 'nothing'",
       () => {
    // The row used to read "no coverage" whether or not the scene had
    // been broken into beats, and the visibility toggle hid both alike.
    expect(summarize(2, 0)).toBe("2 beats, no coverage");
    expect(summarize(0, 0)).toBe("nothing yet");
  });

  test("both are named when both exist", () => {
    expect(summarize(2, 5)).toBe("2 beats · 5 shots");
    expect(summarize(0, 1)).toBe("1 shot");
    expect(summarize(1, 3)).toBe("1 beat · 3 shots");
  });
});

describe("shoot operations", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let sceneId: number;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec(
      "INSERT INTO scene (name, scene_number) VALUES ('EXT. RANCH', 42)");
    sceneId = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
  });

  const shots = async (): Promise<Array<Record<string, unknown>>> =>
    db.exec("SELECT id, shot_number, shot_order, story_beat_id FROM shot " +
            "ORDER BY shot_order, id");

  test("new shots take the next code in the scene", async () => {
    await addShot(db.exec, sceneId, null);
    await addShot(db.exec, sceneId, null);
    await addShot(db.exec, sceneId, null);
    expect((await shots()).map((s) => s["shot_number"]))
      .toEqual(["42A", "42B", "42C"]);
  });

  test("a cut shot's code is not handed to a new one", async () => {
    // A crew that holds 42B should never see a different 42B later.
    await addShot(db.exec, sceneId, null);
    await addShot(db.exec, sceneId, null);
    await addShot(db.exec, sceneId, null);
    const second = (await shots())[1]!;
    await removeShot(db.exec, Number(second["id"]));
    await addShot(db.exec, sceneId, null);
    // Numbering continues past the highest rather than filling 42B's
    // hole. (Deleting the LAST shot does free its code — nothing
    // records codes that once existed.)
    expect((await shots()).map((s) => s["shot_number"]))
      .toEqual(["42A", "42C", "42D"]);
  });

  test("deleting a beat keeps its shots on the scene", async () => {
    await addBeat(db.exec, sceneId);
    const beatId = Number((await db.exec(
      "SELECT id FROM story_beat"))[0]!["id"]);
    await addShot(db.exec, sceneId, beatId);
    await addShot(db.exec, sceneId, beatId);
    await removeBeat(db.exec, beatId);

    const remaining = await shots();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((s) => s["story_beat_id"] === null)).toBe(true);
    expect((await db.exec("SELECT COUNT(*) AS n FROM story_beat"))[0]!["n"])
      .toBe(0);
  });

  test("beats are lettered in order within their scene", async () => {
    await addBeat(db.exec, sceneId);
    await addBeat(db.exec, sceneId);
    const beats = await db.exec(
      "SELECT name, beat_order FROM story_beat ORDER BY beat_order");
    expect(beats.map((b) => b["name"])).toEqual(["Beat A", "Beat B"]);
  });

  test("moving a shot swaps it with its neighbour", async () => {
    await addShot(db.exec, sceneId, null);
    await addShot(db.exec, sceneId, null);
    const before = await shots();
    await moveShot(db.exec, Number(before[1]!["id"]), before, -1);
    expect((await shots()).map((s) => s["shot_number"]))
      .toEqual(["42B", "42A"]);
  });

  test("moving past either end does nothing", async () => {
    await addShot(db.exec, sceneId, null);
    const only = await shots();
    await moveShot(db.exec, Number(only[0]!["id"]), only, -1);
    await moveShot(db.exec, Number(only[0]!["id"]), only, 1);
    expect((await shots()).map((s) => s["shot_order"])).toEqual([1]);
  });

  test("an unnumbered scene still gets usable codes", async () => {
    await db.exec("INSERT INTO scene (name) VALUES ('INT. VOID')");
    const other = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
    await addShot(db.exec, other, null);
    const row = (await db.exec(
      "SELECT shot_number FROM shot WHERE scene_id = ?", [other]))[0]!;
    expect(row["shot_number"]).toBe("A");
  });
});

describe("a shot that moves to another scene is renumbered", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let five: number;
  let sixtySix: number;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec(
      "INSERT INTO scene (name, scene_number) VALUES ('A', 5)");
    five = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
    await db.exec(
      "INSERT INTO scene (name, scene_number) VALUES ('B', 66)");
    sixtySix = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
  });

  const numberOf = async (id: number): Promise<unknown> =>
    (await db.exec("SELECT shot_number FROM shot WHERE id = ?",
                   [id]))[0]!["shot_number"];

  test("5A becomes 66A", async () => {
    await addShot(db.exec, five, null);
    const id = Number((await db.exec("SELECT id FROM shot"))[0]!["id"]);
    expect(await numberOf(id)).toBe("5A");
    expect(await renumberForScene(db.exec, id, sixtySix)).toBe("66A");
    expect(await numberOf(id)).toBe("66A");
  });

  test("it takes the next free code in the destination", async () => {
    await addShot(db.exec, sixtySix, null);   // 66A
    await addShot(db.exec, five, null);       // 5A
    const moving = Number((await db.exec(
      "SELECT id FROM shot WHERE scene_id = ?", [five]))[0]!["id"]);
    expect(await renumberForScene(db.exec, moving, sixtySix)).toBe("66B");
  });

  test("staying in the same scene changes nothing", async () => {
    // The rule protects the number against the SCENE renumbering; only
    // a move to a different scene renumbers.
    await addShot(db.exec, five, null);
    const id = Number((await db.exec("SELECT id FROM shot"))[0]!["id"]);
    expect(await renumberForScene(db.exec, id, five)).toBe(null);
    expect(await numberOf(id)).toBe("5A");
  });

  test("a hand-authored number is replaced too, since it names the "
       + "wrong scene", async () => {
    await addShot(db.exec, five, null);
    const id = Number((await db.exec("SELECT id FROM shot"))[0]!["id"]);
    await db.exec("UPDATE shot SET shot_number = '5A-INSERT' WHERE id = ?",
                  [id]);
    expect(await renumberForScene(db.exec, id, sixtySix)).toBe("66A");
  });
});
