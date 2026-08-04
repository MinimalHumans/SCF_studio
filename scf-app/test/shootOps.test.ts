import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import {
  addBeat, addShot, moveShot, removeBeat, removeShot,
} from "../src/editor/shootOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

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
