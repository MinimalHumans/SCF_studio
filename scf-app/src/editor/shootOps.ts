/**
 * shootOps.ts — the writes the shoot outline makes.
 *
 * Kept out of the view so the rules that matter can be tested: a new
 * shot takes the next unused code in its scene, and deleting a beat
 * does not take its shots with it.
 *
 * Nothing here touches scenes, acts, or sequences. The shoot surface
 * plans coverage against the script's spine; it never edits it.
 */

import type { Row, SqlExec } from "@scf-core/db.ts";
import { nextShotNumber } from "@scf-core/shots.ts";

const beatLetter = (i: number): string =>
  String.fromCharCode(65 + (i % 26));

export async function addBeat(exec: SqlExec,
                              sceneId: number): Promise<void> {
  const existing = await exec(
    "SELECT id FROM story_beat WHERE scene_id = ?", [sceneId]);
  await exec(
    "INSERT INTO story_beat (name, scene_id, beat_order) VALUES (?, ?, ?)",
    [`Beat ${beatLetter(existing.length)}`, sceneId, existing.length + 1]);
}

export async function addShot(exec: SqlExec, sceneId: number,
                              beatId: number | null): Promise<void> {
  const scene = await exec(
    "SELECT scene_number FROM scene WHERE id = ?", [sceneId]);
  const inScene = await exec(
    "SELECT shot_number FROM shot WHERE scene_id = ?", [sceneId]);
  const number = nextShotNumber(
    (scene[0]?.["scene_number"] ?? null) as number | null,
    inScene.map((r) => (r["shot_number"] ?? null) as string | null));
  await exec(
    "INSERT INTO shot (name, scene_id, story_beat_id, shot_number, " +
    "shot_order) VALUES (?, ?, ?, ?, ?)",
    ["", sceneId, beatId, number, inScene.length + 1]);
}

export async function updateField(
    exec: SqlExec, table: "shot" | "story_beat", id: number,
    field: string, value: string): Promise<void> {
  await exec(
    `UPDATE ${table} SET ${field} = ?, updated_at = datetime('now') ` +
    "WHERE id = ?", [value === "" ? null : value, id]);
}

/**
 * Deleting a beat leaves its shots on the scene. A beat is an
 * interpretation of the scene; the coverage was still planned, and
 * losing a shot list because someone reorganized their beats would be
 * the kind of data loss no undo covers.
 */
export async function removeBeat(exec: SqlExec, id: number): Promise<void> {
  await exec("UPDATE shot SET story_beat_id = NULL WHERE story_beat_id = ?",
             [id]);
  await exec("DELETE FROM story_beat WHERE id = ?", [id]);
}

export async function removeShot(exec: SqlExec, id: number): Promise<void> {
  await exec("DELETE FROM shot WHERE id = ?", [id]);
}

/** Swap a shot with its neighbour in the scene's order. */
export async function moveShot(exec: SqlExec, id: number,
                               shotsInScene: Row[],
                               delta: number): Promise<void> {
  const i = shotsInScene.findIndex((r) => Number(r["id"]) === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= shotsInScene.length) return;
  const a = shotsInScene[i] as Row;
  const b = shotsInScene[j] as Row;
  await exec("UPDATE shot SET shot_order = ? WHERE id = ?",
             [j + 1, Number(a["id"])]);
  await exec("UPDATE shot SET shot_order = ? WHERE id = ?",
             [i + 1, Number(b["id"])]);
}
