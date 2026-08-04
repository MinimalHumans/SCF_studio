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

/**
 * What a collapsed scene says about itself. Beats count as work: a
 * scene broken into beats with no shots yet is further along than an
 * untouched one, and the row should not read the same for both.
 */
export function summarize(beats: number, shots: number): string {
  const parts: string[] = [];
  if (beats > 0) parts.push(`${String(beats)} beat${beats === 1 ? "" : "s"}`);
  if (shots > 0) parts.push(`${String(shots)} shot${shots === 1 ? "" : "s"}`);
  if (parts.length === 0) return "nothing yet";
  if (shots === 0) return `${parts.join(" · ")}, no coverage`;
  return parts.join(" · ");
}

/**
 * The lines of one scene, located by its HEADING rather than by every
 * line's own scene_id.
 *
 * Body lines do carry a scene_id — it is threaded onto them at commit —
 * but that threading is derived state and can be absent or stale: a
 * line typed after the last commit has none, and a project written
 * before the threading existed has none at all. The heading's link is
 * the reliable one, because commit enforces one scene per heading. So:
 * find the heading, then take everything up to the next heading, which
 * is what "the scene" means in a screenplay anyway.
 *
 * Bind the scene id three times.
 */
export const SCENE_SCRIPT_SQL =
  "SELECT line_type, content FROM screenplay_lines " +
  "WHERE line_order >= COALESCE(" +
  "    (SELECT MIN(line_order) FROM screenplay_lines " +
  "     WHERE scene_id = ? AND line_type = 'heading'), " +
  "    (SELECT MIN(line_order) FROM screenplay_lines WHERE scene_id = ?), " +
  "    9e18) " +
  "  AND line_order < COALESCE((SELECT MIN(line_order) " +
  "     FROM screenplay_lines WHERE line_type = 'heading' " +
  "       AND line_order > COALESCE(" +
  "         (SELECT MIN(line_order) FROM screenplay_lines " +
  "          WHERE scene_id = ? AND line_type = 'heading'), -1)), 9e18) " +
  "ORDER BY line_order";

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

/**
 * A shot that moves to another scene is renumbered.
 *
 * This is not a contradiction of "a shot number is never rewritten".
 * That rule protects the number against the SCENE renumbering — 42A
 * stays 42A when scene 42 becomes scene 43, because a crew holds paper
 * saying 42A. But a shot dragged from scene 5 into scene 66 is not
 * scene 5's coverage any more: "5A" sitting in scene 66 is not a stable
 * identifier, it is a wrong one. Production practice agrees — a shot
 * that changes scenes gets a new number.
 *
 * Returns the new number, or null when nothing changed.
 */
export async function renumberForScene(
    exec: SqlExec, shotId: number,
    newSceneId: number): Promise<string | null> {
  const current = await exec(
    "SELECT scene_id, shot_number FROM shot WHERE id = ?", [shotId]);
  const row = current[0];
  if (row === undefined) return null;
  if (Number(row["scene_id"]) === newSceneId) return null;

  const scene = await exec(
    "SELECT scene_number FROM scene WHERE id = ?", [newSceneId]);
  const siblings = await exec(
    "SELECT shot_number FROM shot WHERE scene_id = ? AND id != ?",
    [newSceneId, shotId]);
  const number = nextShotNumber(
    (scene[0]?.["scene_number"] ?? null) as number | null,
    siblings.map((r) => (r["shot_number"] ?? null) as string | null));
  await exec(
    "UPDATE shot SET shot_number = ?, updated_at = datetime('now') " +
    "WHERE id = ?", [number, shotId]);
  return number;
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
