// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import {
  attachMedia, detachMedia, loadMedia, mediaCounts, mediaLabel, moveMedia,
  setMediaType, loadPosters, setPoster, type MediaOwner,
} from "../src/editor/relatedMediaOps.ts";
import { applyUndoChange } from "../src/state/undoChange.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("shot and scene media (proposal 0037)", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let shot: MediaOwner;
  let assets: number[];

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO scene (name, scene_number) VALUES ('INT. KITCHEN', 12)");
    await db.exec("INSERT INTO shot (scene_id, shot_number) VALUES (1, '12-04')");
    shot = { kind: "shot", id: 1 };
    assets = [];
    for (const name of ["a.png", "b.png", "c.png"]) {
      const made = await db.exec(
        "INSERT INTO asset (uuid, name, identifier) VALUES (?, ?, ?) RETURNING id",
        [crypto.randomUUID(), name, `@project/boards/${name}`]);
      assets.push(Number(made[0]!["id"]));
    }
  });

  const names = async (): Promise<string[]> =>
    (await loadMedia(db.exec, shot)).map((t) => String(t.asset["name"]));

  test("attached files are ordered after what is there, with a uuid", async () => {
    await attachMedia(db.exec, shot, [assets[0]!, assets[1]!], "storyboard");
    await attachMedia(db.exec, shot, [assets[2]!], "start_frame");
    const tiles = await loadMedia(db.exec, shot);
    expect(tiles.map((t) => t.order)).toEqual([1, 2, 3]);
    expect(tiles.map((t) => t.type))
      .toEqual(["storyboard", "storyboard", "start_frame"]);
    const missing = await db.exec(
      "SELECT COUNT(*) AS n FROM asset_relationship WHERE uuid IS NULL");
    expect(missing[0]!["n"]).toBe(0);
  });

  test("a repeated drop adds nothing; the same file for another purpose does", async () => {
    await attachMedia(db.exec, shot, [assets[0]!], "storyboard");
    const again = await attachMedia(db.exec, shot, [assets[0]!], "storyboard");
    expect(again.created).toEqual([]);
    await attachMedia(db.exec, shot, [assets[0]!], "start_frame");
    expect(await names()).toEqual(["a.png", "a.png"]);
  });

  test("order, not row id, is the sequence (§8.6)", async () => {
    await attachMedia(db.exec, shot, assets, "storyboard");
    await db.exec(`UPDATE asset_relationship SET "order" = 4 - "order"`);
    expect(await names()).toEqual(["c.png", "b.png", "a.png"]);
    // Rows with no order come after rows with one, then by row id.
    await db.exec(`UPDATE asset_relationship SET "order" = NULL WHERE asset_id = ?`,
                  [assets[2]!]);
    expect(await names()).toEqual(["b.png", "a.png", "c.png"]);
  });

  test("moving renumbers the strip and undoes as one step", async () => {
    await attachMedia(db.exec, shot, assets, "storyboard");
    const tiles = await loadMedia(db.exec, shot);
    const change = await moveMedia(db.exec, tiles, tiles[2]!.linkId, -1);
    expect(await names()).toEqual(["a.png", "c.png", "b.png"]);
    expect((await loadMedia(db.exec, shot)).map((t) => t.order))
      .toEqual([1, 2, 3]);
    await applyUndoChange(db.exec, change!);
    expect(await names()).toEqual(["a.png", "b.png", "c.png"]);
    // Off either end is no change at all.
    expect(await moveMedia(db.exec, tiles, tiles[0]!.linkId, -1)).toBeNull();
  });

  test("retyping keeps the position; removing keeps the asset", async () => {
    await attachMedia(db.exec, shot, assets, "reference");
    const tiles = await loadMedia(db.exec, shot);
    await setMediaType(db.exec, tiles[1]!, "end_frame");
    const after = await loadMedia(db.exec, shot);
    expect(after[1]!.type).toBe("end_frame");
    expect(after[1]!.order).toBe(2);
    await detachMedia(db.exec, after[0]!);
    expect(await names()).toEqual(["b.png", "c.png"]);
    const kept = await db.exec("SELECT COUNT(*) AS n FROM asset");
    expect(kept[0]!["n"]).toBe(3);
  });

  test("a scene's media is its own, and counted apart from its shots'", async () => {
    const scene: MediaOwner = { kind: "scene", id: 1 };
    await attachMedia(db.exec, scene, [assets[0]!], "reference");
    await attachMedia(db.exec, shot, [assets[1]!, assets[2]!], "storyboard");
    expect((await loadMedia(db.exec, scene)).length).toBe(1);
    expect((await mediaCounts(db.exec, "shot")).get(1)).toBe(2);
    expect((await mediaCounts(db.exec, "scene")).get(1)).toBe(1);
  });

  test("an unknown stored type is shown as stored", () => {
    expect(mediaLabel("start_frame")).toBe("Start frame");
    expect(mediaLabel("lighting_plate")).toBe("lighting_plate");
    expect(mediaLabel(null)).toBe("Untyped");
  });
});

describe("the project poster (proposal 0038)", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let assets: number[];

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO project (uuid, name) VALUES (?, 'Film')",
                  [crypto.randomUUID()]);
    assets = [];
    for (const name of ["one.png", "two.png"]) {
      const made = await db.exec(
        "INSERT INTO asset (uuid, name, identifier) VALUES (?, ?, ?) RETURNING id",
        [crypto.randomUUID(), name, `@project/promotional/${name}`]);
      assets.push(Number(made[0]!["id"]));
    }
  });

  const posters = async (): Promise<string[]> =>
    (await loadPosters(db.exec, 1)).map((t) => String(t.asset["name"]));

  test("a replaced poster stays behind the new one as an alternative", async () => {
    await setPoster(db.exec, 1, assets[0]!);
    await setPoster(db.exec, 1, assets[1]!);
    expect(await posters()).toEqual(["two.png", "one.png"]);
    const rows = await db.exec(
      "SELECT entity_type, relationship_type, uuid FROM asset_relationship");
    expect(rows.every((r) => r["entity_type"] === "project" &&
      r["relationship_type"] === "poster" && r["uuid"] !== null)).toBe(true);
  });

  test("choosing an alternative again moves it, it does not relate it twice", async () => {
    await setPoster(db.exec, 1, assets[0]!);
    await setPoster(db.exec, 1, assets[1]!);
    const change = await setPoster(db.exec, 1, assets[0]!);
    expect(change.created).toEqual([]);
    expect(await posters()).toEqual(["one.png", "two.png"]);
  });

  test("undo puts the previous poster back", async () => {
    await setPoster(db.exec, 1, assets[0]!);
    const change = await setPoster(db.exec, 1, assets[1]!);
    await applyUndoChange(db.exec, change);
    expect(await posters()).toEqual(["one.png"]);
  });
});
