/**
 * editor/integrity.ts — links that outlived the text they described.
 *
 * writeScreenplay replaces the whole line table on every commit, so a
 * deleted line's uuid simply stops existing. Three things point at line
 * uuids or at script-derived context and none of them were being swept:
 *
 *  - screenplay_prop_tags.line_uuid — validateTags already marked these
 *    "detached" and the toolbar showed a count, with no way to see or
 *    act on them.
 *  - performance_beat.line_ref — nothing reported these at all. A beat
 *    whose line is gone is invisible: no gutter dot, no warning.
 *  - scene_character — linkAndCreateAtCommit only ever INSERTs. Delete
 *    every line a character speaks in a scene and the junction stays.
 *
 * The last one is REPORTED, never swept automatically. A scene_character
 * row can legitimately be authored by hand for someone present and
 * silent, and nothing distinguishes that from a leftover — this is the
 * findings-not-enforcement rule (conventions §1). The author decides;
 * the panel just makes deciding a single click.
 *
 * The same rule is why nothing here deletes on its own. Every repair is
 * a separate call the UI makes when asked.
 */

import type { Row, SqlExec } from "@scf-core/db.ts";
import { sceneNumberOrderJoin, sceneNumberOrderTerms }
  from "@scf-core/sceneNumbers.ts";

export interface DetachedTag {
  id: number;
  propId: number;
  propName: string;
  taggedText: string;
}

export interface OrphanBeat {
  id: number;
  name: string;
  modality: string;
  characterName: string | null;
  sceneId: number | null;
  lineText: string;
}

export interface UnjustifiedLink {
  id: number;
  sceneId: number;
  /** The scene's label, as written (spec §4.2) — "12", "12A". */
  sceneNumber: string | null;
  sceneName: string;
  characterId: number;
  characterName: string;
}

export interface IntegrityReport {
  detachedTags: DetachedTag[];
  orphanBeats: OrphanBeat[];
  unjustifiedLinks: UnjustifiedLink[];
  total: number;
}

export const EMPTY_REPORT: IntegrityReport = {
  detachedTags: [], orphanBeats: [], unjustifiedLinks: [], total: 0,
};

const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);
/** A scene number is a label, not a number — see spec §4.2. */
const labelOrNull = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === ""
    ? null : String(v).trim();

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" ? v : null;

/**
 * A beat or tag is orphaned when its anchor uuid is not among the
 * script's current line uuids. Passing the live set in rather than
 * joining in SQL keeps this honest about what the EDITOR is showing:
 * the document in front of the author, not whatever last reached disk.
 */
export async function scanIntegrity(
    exec: SqlExec, liveLineIds: ReadonlySet<string>):
    Promise<IntegrityReport> {
  const tagRows = await exec(
    "SELECT t.id, t.prop_id, t.line_uuid, t.tagged_text, " +
    "p.name AS prop_name FROM screenplay_prop_tags t " +
    "LEFT JOIN prop p ON p.id = t.prop_id " +
    "WHERE t.line_uuid IS NOT NULL");
  const detachedTags: DetachedTag[] = tagRows
    .filter((r: Row) => !liveLineIds.has(str(r["line_uuid"])))
    .map((r: Row) => ({
      id: r["id"] as number,
      propId: r["prop_id"] as number,
      propName: str(r["prop_name"]) === "" ? "prop" : str(r["prop_name"]),
      taggedText: str(r["tagged_text"]),
    }));

  const beatRows = await exec(
    "SELECT pb.id, pb.name, pb.modality, pb.line_ref, pb.line_text, " +
    "pb.scene_id, c.name AS character_name FROM performance_beat pb " +
    "LEFT JOIN character c ON c.id = pb.character_id " +
    "WHERE pb.line_ref IS NOT NULL");
  const orphanBeats: OrphanBeat[] = beatRows
    .filter((r: Row) => !liveLineIds.has(str(r["line_ref"])))
    .map((r: Row) => ({
      id: r["id"] as number,
      name: str(r["name"]),
      modality: str(r["modality"]),
      characterName: r["character_name"] === null ||
        r["character_name"] === undefined
        ? null : str(r["character_name"]),
      sceneId: numOrNull(r["scene_id"]),
      lineText: str(r["line_text"]),
    }));

  // Only scenes that ARE in the script can have unjustified links: a
  // scene with no heading yet is being outlined, and its cast is
  // authored rather than derived.
  const linkRows = await exec(
    "SELECT sc.id, sc.scene_id, s.scene_number, s.name AS scene_name, " +
    "sc.character_id, c.name AS character_name " +
    "FROM scene_character sc " +
    "JOIN scene s ON s.id = sc.scene_id " +
    "LEFT JOIN character c ON c.id = sc.character_id " +
    `${sceneNumberOrderJoin("s.id", "sn")} ` +
    "WHERE sc.character_id IS NOT NULL AND EXISTS (" +
    "  SELECT 1 FROM screenplay_lines h " +
    "  WHERE h.line_type = 'heading' AND h.scene_id = sc.scene_id) " +
    "AND NOT EXISTS (" +
    "  SELECT 1 FROM screenplay_lines l " +
    "  WHERE l.line_type = 'character' AND l.scene_id = sc.scene_id " +
    "    AND l.character_id = sc.character_id) " +
    `ORDER BY ${sceneNumberOrderTerms("sn")}, s.id, c.name`);
  const unjustifiedLinks: UnjustifiedLink[] = linkRows.map((r: Row) => ({
    id: r["id"] as number,
    sceneId: r["scene_id"] as number,
    sceneNumber: labelOrNull(r["scene_number"]),
    sceneName: str(r["scene_name"]),
    characterId: r["character_id"] as number,
    characterName: str(r["character_name"]) === ""
      ? "(unnamed)" : str(r["character_name"]),
  }));

  return {
    detachedTags, orphanBeats, unjustifiedLinks,
    total: detachedTags.length + orphanBeats.length +
           unjustifiedLinks.length,
  };
}

export async function deletePropTag(
    exec: SqlExec, id: number): Promise<void> {
  await exec("DELETE FROM screenplay_prop_tags WHERE id = ?", [id]);
}

/** Re-anchor a detached tag onto a line that still exists. */
export async function reanchorPropTag(
    exec: SqlExec, id: number, lineId: string,
    start: number, end: number): Promise<void> {
  await exec(
    "UPDATE screenplay_prop_tags SET line_uuid = ?, start_offset = ?, " +
    "end_offset = ? WHERE id = ?", [lineId, start, end, id]);
}

export async function deleteBeat(
    exec: SqlExec, id: number): Promise<void> {
  await exec("DELETE FROM performance_beat WHERE id = ?", [id]);
}

/** Keep the beat, drop its dead anchor — it stays on its scene and
 * character, which is usually the part worth keeping. */
export async function unanchorBeat(
    exec: SqlExec, id: number): Promise<void> {
  await exec(
    "UPDATE performance_beat SET line_ref = NULL WHERE id = ?", [id]);
}

export async function deleteSceneCharacter(
    exec: SqlExec, id: number): Promise<void> {
  await exec("DELETE FROM scene_character WHERE id = ?", [id]);
}
