// SPDX-License-Identifier: Apache-2.0
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

import { newUuid, type Row, type SqlExec, type SqlValue } from "../db.ts";
import { nextShotNumber } from "../shots.ts";

const beatLetter = (i: number): string =>
  String.fromCharCode(65 + (i % 26));

/**
 * What a collapsed scene says about itself. Beats count as work: a
 * scene broken into beats with no shots yet is further along than an
 * untouched one, and the row should not read the same for both.
 */
export function summarize(beats: number, shots: number,
                          cut = 0): string {
  const parts: string[] = [];
  if (beats > 0) parts.push(`${String(beats)} beat${beats === 1 ? "" : "s"}`);
  if (shots > 0) parts.push(`${String(shots)} shot${shots === 1 ? "" : "s"}`);
  // Cut shots are not coverage, but they are not nothing either: they
  // still hold their numbers, and the row should say they are there.
  const tail = cut > 0 ? ` (${String(cut)} cut)` : "";
  if (parts.length === 0) return cut > 0 ? `no coverage${tail}` : "nothing yet";
  if (shots === 0) return `${parts.join(" · ")}, no coverage${tail}`;
  return parts.join(" · ") + tail;
}

/** §6.6.1: a cut shot is not in the film, and `cut` is the only value
 *  that says so. */
export const isCut = (shot: Row): boolean =>
  shot["lifecycle_status"] === "cut";

/**
 * The lines of one scene, located by its HEADING rather than by every
 * line's own scene_id — §3.4, and now §12.17.1's `screenplay` member.
 *
 * The derivation moved into scf-core at spec 0.49, when Q04 needed the
 * same rule. It is re-exported here so the Shoot tab's call sites do
 * not change and so there is exactly one description of a MUST NOT.
 */
export { SCENE_SCRIPT_SQL } from "../screenplay/sceneScript.ts";

export async function addBeat(exec: SqlExec,
                              sceneId: number): Promise<void> {
  const existing = await exec(
    "SELECT id FROM story_beat WHERE scene_id = ?", [sceneId]);
  await exec(
    "INSERT INTO story_beat (uuid, name, scene_id, beat_order) " +
    "VALUES (?, ?, ?, ?)",
    [newUuid(), `Beat ${beatLetter(existing.length)}`, sceneId, existing.length + 1]);
}

export async function addShot(exec: SqlExec, sceneId: number,
                              beatId: number | null): Promise<void> {
  const scene = await exec(
    "SELECT scene_number FROM scene WHERE id = ?", [sceneId]);
  const inScene = await exec(
    "SELECT shot_number FROM shot WHERE scene_id = ?", [sceneId]);
  const number = nextShotNumber(
    (scene[0]?.["scene_number"] ?? null) as string | number | null,
    inScene.map((r) => (r["shot_number"] ?? null) as string | null));
  await exec(
    "INSERT INTO shot (uuid, name, scene_id, story_beat_id, " +
    "shot_number, shot_order) VALUES (?, ?, ?, ?, ?, ?)",
    [newUuid(), "", sceneId, beatId, number, inScene.length + 1]);
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
    (scene[0]?.["scene_number"] ?? null) as string | number | null,
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

/**
 * Cut or restore a shot. Cutting is the everyday edit decision; it keeps
 * the row, its media and its number, so a crew's 42B is never reissued
 * and the shot can come back in the next cut. Restore returns it to
 * `active` rather than remembering an earlier `draft`: every derivation
 * treats the two alike (§6.6).
 */
export async function setShotCut(exec: SqlExec, id: number,
                                 cut: boolean): Promise<void> {
  await exec(
    "UPDATE shot SET lifecycle_status = ?, updated_at = datetime('now') " +
    "WHERE id = ?", [cut ? "cut" : "active", id]);
}

export async function removeShot(exec: SqlExec, id: number): Promise<void> {
  await exec("DELETE FROM shot WHERE id = ?", [id]);
}

/**
 * Move a shot one step past its neighbour in the scene's order.
 *
 * `hidden` names shots the view is not showing (cut shots, when they
 * are filtered out). They are stepped over rather than swapped with, or
 * a click would trade places with something invisible and seem to do
 * nothing. Every shot in the scene is then written back as 1..n, so the
 * hidden ones keep their place relative to each other.
 */
export async function moveShot(exec: SqlExec, id: number,
                               shotsInScene: Row[],
                               delta: number,
                               hidden: ReadonlySet<number> = new Set()):
    Promise<void> {
  const ids = shotsInScene.map((r) => Number(r["id"]));
  const i = ids.indexOf(id);
  if (i < 0) return;
  let j = i + delta;
  while (j >= 0 && j < ids.length && hidden.has(ids[j] as number)) j += delta;
  if (j < 0 || j >= ids.length) return;
  const next = ids.filter((x) => x !== id);
  const target = next.indexOf(ids[j] as number);
  next.splice(delta < 0 ? target : target + 1, 0, id);
  for (const [k, shotId] of next.entries()) {
    const was = shotsInScene.find((r) => Number(r["id"]) === shotId);
    if (Number(was?.["shot_order"]) === k + 1) continue;
    await exec("UPDATE shot SET shot_order = ? WHERE id = ?", [k + 1, shotId]);
  }
}

/**
 * `moveShot` for a caller that holds only an id: reads the scene's
 * shots itself, so nothing but plain data crosses a process boundary.
 */
export async function moveShotInScene(
    exec: SqlExec, id: number, delta: -1 | 1,
    hidden: readonly number[] = []): Promise<void> {
  const own = await exec("SELECT scene_id FROM shot WHERE id = ?", [id]);
  if (own[0] === undefined) throw new Error(`no shot with id ${String(id)}`);
  const siblings = await exec(
    "SELECT id, shot_order FROM shot WHERE scene_id = ? " +
    "ORDER BY shot_order, id", [own[0]["scene_id"] as SqlValue]);
  await moveShot(exec, id, siblings, delta, new Set(hidden));
}
