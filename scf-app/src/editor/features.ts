/**
 * editor/features.ts — the remaining Part 3 features, headless.
 *
 * BEATS (G5): performance_beat.line_ref anchors a beat to a screenplay
 * line's uuid — authored from the editor, superseding line_text
 * matching. Re-anchoring is deterministic because lineState emits
 * explicit events: a merge moves beats from absorbed lines to the
 * survivor; a split leaves beats on the original (the first fragment
 * keeps the id, so anchored beats stay with it by construction — no
 * work to do, which is the point).
 *
 * VERSIONS: v1's snapshot model ported as-is — publish copies the
 * current lines and title page into the version tables with summary
 * counts; the diff view reuses the re-import differ (versions are just
 * rows).
 *
 * PROP TAGS: block-anchored ranges — line uuid + offsets, never text
 * match. Edits can invalidate offsets; revalidation is honest about it:
 * exact offsets → still anchored; text found elsewhere in the line →
 * re-anchored (reported); text gone → detached (reported, never
 * deleted).
 */

import type { SqlExec } from "@scf-core/db.ts";
import { withTransaction } from "@scf-core/db.ts";
import type { Row } from "@scf-core/db.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import { readScreenplay } from "@scf-core/screenplay/rowModel.ts";
import { diffScreenplay, type ReimportDiff }
  from "@scf-core/screenplay/reimport.ts";
import type { LineEvent } from "./lineState.ts";
import type { Block } from "./screenplayDoc.ts";

// ---------------------------------------------------------------------------
// Beats (G5)
// ---------------------------------------------------------------------------

export async function createBeatForLine(
    exec: SqlExec, block: Block, modality: "physical" | "vocal" | "facial",
    lineText: string): Promise<number | null> {
  if (block.sceneId === null || block.characterId === null) return null;
  // Human-authored from the editor — no machine-created marking (and
  // Production-category entities carry no identity columns anyway).
  await exec(
    `INSERT INTO performance_beat
       (name, scene_id, character_id, modality, line_ref, line_text)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`Beat @ ${lineText.slice(0, 40)}`, block.sceneId,
     block.characterId, modality, block.id, lineText]);
  const row = await exec("SELECT last_insert_rowid() AS id");
  return row[0]!["id"] as number;
}

/**
 * Consume lineState events: merges re-anchor beats (and prop tags) from
 * absorbed ids to the survivor. Splits need nothing — first fragment
 * keeps the id. Returns how many rows moved, for the UI to mention.
 */
export async function reanchorForEvents(
    exec: SqlExec, events: readonly LineEvent[]): Promise<number> {
  let moved = 0;
  for (const event of events) {
    if (event.kind !== "merge" || event.absorbedIds.length === 0) {
      continue;
    }
    const slots = event.absorbedIds.map(() => "?").join(", ");
    for (const table of ["performance_beat", "screenplay_prop_tags"]) {
      const col = table === "performance_beat" ? "line_ref" : "line_uuid";
      const before = await exec(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IN (${slots})`,
        event.absorbedIds);
      const n = before[0]!["n"] as number;
      if (n > 0) {
        await exec(
          `UPDATE ${table} SET ${col} = ? WHERE ${col} IN (${slots})`,
          [event.survivorId, ...event.absorbedIds]);
        moved += n;
      }
    }
  }
  return moved;
}

export async function beatsForLine(
    exec: SqlExec, lineId: string): Promise<Row[]> {
  return exec(
    "SELECT pb.*, c.name AS character_name FROM performance_beat pb " +
    "LEFT JOIN character c ON c.id = pb.character_id " +
    "WHERE pb.line_ref = ? ORDER BY pb.beat_order, pb.id", [lineId]);
}

/** Line ids that carry at least one beat (for gutter dots). */
export async function beatAnchoredLineIds(
    exec: SqlExec): Promise<Set<string>> {
  const rows = await exec(
    "SELECT DISTINCT line_ref FROM performance_beat " +
    "WHERE line_ref IS NOT NULL");
  return new Set(rows.map((r) => String(r["line_ref"])));
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function publishVersion(
    exec: SqlExec, description: string): Promise<number> {
  return withTransaction(exec, () =>
    publishVersionInner(exec, description));
}

async function publishVersionInner(
    exec: SqlExec, description: string): Promise<number> {
  const sp = await readScreenplay(exec);
  const counts = {
    line_count: sp.lines.length,
    scene_count: sp.lines.filter((l) => l.lineType === "heading").length,
    character_count: new Set(sp.lines
      .filter((l) => l.characterId !== null)
      .map((l) => l.characterId)).size,
    location_count: new Set(sp.lines
      .filter((l) => l.locationId !== null)
      .map((l) => l.locationId)).size,
    word_count: sp.lines.reduce(
      (n, l) => n + l.content.split(/\s+/).filter((w) => w !== "").length,
      0),
  };
  const next = await exec(
    "SELECT COALESCE(MAX(version_number), 0) + 1 AS n " +
    "FROM screenplay_versions");
  const versionNumber = next[0]!["n"] as number;
  await exec(
    `INSERT INTO screenplay_versions
       (version_number, description, line_count, scene_count,
        character_count, location_count, word_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [versionNumber, description, counts.line_count, counts.scene_count,
     counts.character_count, counts.location_count, counts.word_count]);
  const idRow = await exec("SELECT last_insert_rowid() AS id");
  const versionId = idRow[0]!["id"] as number;
  // v1-faithful: snapshot rows do NOT copy the live line's uuid — they
  // are their own rows and receive fresh identity from the open-time
  // uuid backfill (v1's publish omits uuid for exactly this reason; the
  // unique index on version-line uuids depends on it).
  for (const line of sp.lines) {
    await exec(
      `INSERT INTO screenplay_version_lines
         (version_id, line_order, line_type, content, scene_id,
          character_id, location_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [versionId, line.lineOrder, line.lineType, line.content,
       line.sceneId, line.characterId, line.locationId,
       line.metadata === null ? null : JSON.stringify(line.metadata)]);
  }
  for (const tp of sp.titlePage) {
    await exec(
      `INSERT INTO screenplay_version_title_page
         (version_id, key, value, sort_order)
       VALUES (?, ?, ?, ?)`,
      [versionId, tp.key, tp.value, tp.sortOrder]);
  }
  return versionId;
}

export async function listVersions(exec: SqlExec): Promise<Row[]> {
  return exec(
    "SELECT * FROM screenplay_versions ORDER BY version_number DESC");
}

export async function versionRows(
    exec: SqlExec, versionId: number): Promise<ScreenplayRow[]> {
  const rows = await exec(
    "SELECT * FROM screenplay_version_lines WHERE version_id = ? " +
    "ORDER BY line_order", [versionId]);
  return rows.map((r) => ({
    lineOrder: r["line_order"] as number,
    lineType: String(r["line_type"]),
    content: String(r["content"]),
    sceneId: (r["scene_id"] as number | null),
    characterId: (r["character_id"] as number | null),
    locationId: (r["location_id"] as number | null),
    metadata: null,
    uuid: r["uuid"] === null ? undefined : String(r["uuid"]),
  }));
}

/** Diff a published version against the current screenplay. */
export async function diffVersionAgainstCurrent(
    exec: SqlExec, versionId: number): Promise<ReimportDiff> {
  const old = await versionRows(exec, versionId);
  const current = (await readScreenplay(exec)).lines;
  return diffScreenplay(old, current);
}

// ---------------------------------------------------------------------------
// Prop tags
// ---------------------------------------------------------------------------

export async function tagPropRange(
    exec: SqlExec, lineId: string, propId: number, taggedText: string,
    startOffset: number, endOffset: number): Promise<void> {
  await exec(
    `INSERT INTO screenplay_prop_tags
       (tagged_text, prop_id, line_uuid, start_offset, end_offset)
     VALUES (?, ?, ?, ?, ?)`,
    [taggedText, propId, lineId, startOffset, endOffset]);
}

export interface ValidatedTag {
  id: number;
  propId: number;
  propName: string;
  lineId: string;
  taggedText: string;
  startOffset: number;
  endOffset: number;
  status: "anchored" | "reanchored" | "detached";
}

/**
 * Validate tags against current line text. Exact offsets that still
 * hold → anchored. Text found elsewhere in the line → reanchored (and
 * persisted). Text gone → detached; the row stays, the UI reports it.
 */
export async function validateTags(
    exec: SqlExec,
    textByLineId: Map<string, string>): Promise<ValidatedTag[]> {
  const rows = await exec(
    "SELECT t.*, p.name AS prop_name FROM screenplay_prop_tags t " +
    "LEFT JOIN prop p ON p.id = t.prop_id " +
    "WHERE t.line_uuid IS NOT NULL");
  const out: ValidatedTag[] = [];
  for (const r of rows) {
    const lineId = String(r["line_uuid"]);
    const text = textByLineId.get(lineId);
    const tagged = String(r["tagged_text"]);
    let start = r["start_offset"] as number | null ?? 0;
    let end = r["end_offset"] as number | null ?? 0;
    let status: ValidatedTag["status"];
    if (text === undefined) {
      status = "detached";
    } else if (text.slice(start, end) === tagged) {
      status = "anchored";
    } else {
      const at = text.indexOf(tagged);
      if (at !== -1) {
        status = "reanchored";
        start = at;
        end = at + tagged.length;
        await exec(
          "UPDATE screenplay_prop_tags SET start_offset = ?, " +
          "end_offset = ? WHERE id = ?", [start, end, r["id"] as number]);
      } else {
        status = "detached";
      }
    }
    out.push({
      id: r["id"] as number,
      propId: r["prop_id"] as number,
      propName: String(r["prop_name"] ?? "prop"),
      lineId, taggedText: tagged, startOffset: start, endOffset: end,
      status,
    });
  }
  return out;
}
