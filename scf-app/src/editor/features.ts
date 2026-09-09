// SPDX-License-Identifier: Apache-2.0
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
import { commitStructure, planCommitStructure }
  from "./structureCommit.ts";
import { cueMatchesEntity } from "./cueMatch.ts";
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
  // v1-faithful: snapshot rows do NOT copy the live line's uuid into
  // `uuid` — they are their own rows and receive fresh identity from the
  // open-time backfill (v1's publish omits uuid for exactly this reason;
  // the unique index on version-line uuids depends on it).
  //
  // `source_uuid` (2.6) is the SECOND column that records which live
  // line the row was taken from. It is what lets a revert give a
  // restored line back its original identity — and therefore lets the
  // performance beats and prop tags anchored to it survive the trip.
  // Without it, reverting the script silently orphaned everything
  // attached to it.
  for (const line of sp.lines) {
    await exec(
      `INSERT INTO screenplay_version_lines
         (version_id, line_order, line_type, content, scene_id,
          character_id, location_id, metadata, source_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [versionId, line.lineOrder, line.lineType, line.content,
       line.sceneId, line.characterId, line.locationId,
       line.metadata === null ? null : JSON.stringify(line.metadata),
       line.uuid ?? null]);
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

/**
 * Tag a prop on a line — and record that the prop is in that SCENE.
 *
 * The tag alone was not enough. Every query that asks "which props are
 * in this scene" reads `scene_prop`, including the Scene Rail's prop
 * filter — so a prop created by tagging appeared nowhere in it while
 * imported props did, because the importer writes the junction and
 * tagging did not. The tag is the evidence; the junction is what the
 * evidence means, and one without the other is a fact the app knows and
 * cannot answer with.
 *
 * The line's scene comes from the heading that governs it, matching how
 * a scene's extent is defined everywhere else. Nothing is written when
 * the line is not under a heading yet, and the row is not duplicated
 * when the prop is already linked.
 */
export async function tagPropRange(
    exec: SqlExec, lineId: string, propId: number, taggedText: string,
    startOffset: number, endOffset: number): Promise<void> {
  await exec(
    `INSERT INTO screenplay_prop_tags
       (tagged_text, prop_id, line_uuid, start_offset, end_offset)
     VALUES (?, ?, ?, ?, ?)`,
    [taggedText, propId, lineId, startOffset, endOffset]);
  await linkPropToLineScene(exec, lineId, propId);
}

/**
 * Make sure every prop tagged in the script is recorded as being in that
 * scene.
 *
 * `tagPropRange` writes the junction when the tag is made, but it can
 * only do that if the line is already in `screenplay_lines` and its
 * heading already carries a scene — neither of which is true for text
 * typed since the last commit, or for a scene whose heading has not been
 * committed into a scene record yet. Tagging is exactly the moment
 * someone does both at once.
 *
 * So the link is also DERIVED at every commit, from the tags that
 * survived, which makes it independent of when the tag was made. The
 * derivation only ever adds: a hand-authored `scene_prop` row for a prop
 * that is present but never named in the dialogue is a legitimate fact
 * the script cannot see, and this is not the place to second-guess it.
 */
export async function syncPropSceneLinks(exec: SqlExec): Promise<number> {
  const implied = await exec(
    "SELECT DISTINCT h.scene_id AS scene_id, t.prop_id AS prop_id, " +
    "  p.name AS prop_name " +
    "FROM screenplay_prop_tags t " +
    "JOIN screenplay_lines l ON l.uuid = t.line_uuid " +
    "JOIN prop p ON p.id = t.prop_id " +
    "JOIN screenplay_lines h ON h.line_type = 'heading' " +
    "  AND h.scene_id IS NOT NULL AND h.line_order <= l.line_order " +
    "LEFT JOIN screenplay_lines h2 ON h2.line_type = 'heading' " +
    "  AND h2.scene_id IS NOT NULL AND h2.line_order <= l.line_order " +
    "  AND h2.line_order > h.line_order " +
    "WHERE h2.id IS NULL");
  let added = 0;
  for (const row of implied) {
    const sceneId = row["scene_id"] as number;
    const propId = row["prop_id"] as number;
    const existing = await exec(
      "SELECT id FROM scene_prop WHERE scene_id = ? AND prop_id = ?",
      [sceneId, propId]);
    if (existing.length > 0) continue;
    await exec(
      "INSERT INTO scene_prop (name, scene_id, prop_id) VALUES (?, ?, ?)",
      [String(row["prop_name"] ?? ""), sceneId, propId]);
    added += 1;
  }
  return added;
}

export async function linkPropToLineScene(
    exec: SqlExec, lineId: string, propId: number): Promise<void> {
  const scene = await exec(
    "SELECT scene_id FROM screenplay_lines WHERE line_type = 'heading' " +
    "AND line_order <= (SELECT line_order FROM screenplay_lines " +
    "                   WHERE uuid = ?) AND scene_id IS NOT NULL " +
    "ORDER BY line_order DESC LIMIT 1", [lineId]);
  const sceneId = scene[0]?.["scene_id"] as number | null | undefined;
  if (sceneId === null || sceneId === undefined) return;
  const existing = await exec(
    "SELECT id FROM scene_prop WHERE scene_id = ? AND prop_id = ?",
    [sceneId, propId]);
  if (existing.length > 0) return;
  const name = await exec("SELECT name FROM prop WHERE id = ?", [propId]);
  await exec(
    "INSERT INTO scene_prop (name, scene_id, prop_id) VALUES (?, ?, ?)",
    [String(name[0]?.["name"] ?? ""), sceneId, propId]);
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


// ---------------------------------------------------------------------------
// Commit-time linking and creation (v1's save-path semantics, done right)
// ---------------------------------------------------------------------------

export interface CommitLinkResult {
  scenesCreated: number;
  locationsCreated: number;
  charactersCreated: number;
  linksCreated: number;
  /** Acts and sequences declared by # sections (see structureCommit). */
  actsCreated: number;
  sequencesCreated: number;
}

export interface CommitPlanInfo {
  newScenes: number;
  newLocations: Array<{ name: string; similar: string[] }>;
  newCharacters: Array<{ cue: string; similar: string[] }>;
  conflicts: Array<{ uuid: string; cue: string; entityId: number;
                     entityName: string }>;
  newActs: string[];
  newSequences: string[];
  /** Section lines with no scene heading below them — they anchor
   * nothing, so they are named rather than silently ignored. */
  danglingSections: string[];
}

const COMPOUND_CUE = /\s(?:&|AND)\s/i;

/** Read-only preview of what an explicit commit would create, plus
 * cue/entity mismatches (the George→Jorge case: the line was edited but
 * kept its old link — never silently acceptable). */
export async function planCommitLinks(
    exec: SqlExec, rows: ScreenplayRow[]): Promise<CommitPlanInfo> {
  const norm = (x: string): string => x.trim().toUpperCase();
  const { parseHeading, normalizeCue } =
    await import("@scf-core/proposals/propose.ts");
  const locations = await exec("SELECT id, name FROM location");
  const locNames = locations.map((r) => String(r["name"]));
  const locSet = new Set(locNames.map(norm));
  const characters = await exec("SELECT id, name FROM character");
  const charNames = characters.map((r) => String(r["name"]));
  const charSet = new Set(charNames.map(norm));
  const charNameById = new Map(characters.map((r) =>
    [r["id"] as number, String(r["name"])]));
  const similar = (name: string, pool: string[]): string[] =>
    pool.filter((x) => {
      const a = norm(x);
      const b = norm(name);
      return a !== b && (a.includes(b) || b.includes(a) ||
                         a.slice(0, 4) === b.slice(0, 4));
    }).slice(0, 3);

  const info: CommitPlanInfo = {
    newScenes: 0, newLocations: [], newCharacters: [], conflicts: [],
    newActs: [], newSequences: [], danglingSections: [],
  };
  const structure = await planCommitStructure(exec, rows);
  info.newActs = structure.newActs;
  info.newSequences = structure.newSequences;
  info.danglingSections = structure.danglingSections;
  const seenLoc = new Set<string>();
  const seenChar = new Set<string>();
  for (const row of rows) {
    if (row.lineType === "heading" && row.sceneId === null &&
        row.content.trim() !== "") {
      info.newScenes += 1;
      const parsed = parseHeading(row.content);
      if (parsed.locationName !== null) {
        const key = norm(parsed.locationName);
        if (!locSet.has(key) && !seenLoc.has(key)) {
          seenLoc.add(key);
          info.newLocations.push({
            name: parsed.locationName,
            similar: similar(parsed.locationName, locNames),
          });
        }
      }
    } else if (row.lineType === "character" &&
               row.content.trim() !== "") {
      const cue = normalizeCue(row.content.trim()).name;
      if (cue === "" || COMPOUND_CUE.test(cue)) continue;
      if (row.characterId !== null) {
        const entityName = charNameById.get(row.characterId);
        // Not equality: a cue is a short form by convention, and
        // `ELEANOR` above `Eleanor Cade` is the normal state of every
        // screenplay rather than a mismatch. See cueMatch.ts.
        if (entityName !== undefined &&
            !cueMatchesEntity(cue, entityName)) {
          info.conflicts.push({ uuid: row.uuid ?? "", cue,
                                entityId: row.characterId, entityName });
        }
      } else if (!charSet.has(norm(cue)) && !seenChar.has(norm(cue))) {
        seenChar.add(norm(cue));
        info.newCharacters.push({
          cue, similar: similar(cue, charNames),
        });
      }
    }
  }
  return info;
}

export interface CommitLinkOptions {
  /** false: match existing entities only, create nothing (the debounced
   * auto-save mode — text always saves, entities never appear
   * unreviewed). */
  createNew: boolean;
  /** Line uuids to unlink before matching (conflict resolution:
   * "break the link and create/match by the cue as written"). */
  unlinkUuids?: Set<string>;
  /** Entity renames to apply first (conflict resolution: "the entity
   * follows the line"): character id -> new display name. Connected cue
   * lines' text is rewritten to match. */
  renames?: Map<number, string>;
}

/**
 * v1 created entities on save; the import regret was HEURISTIC creation
 * from a parser, not this: here the author literally typed the heading
 * or cue, so creating what they named is the feature (and what v1's
 * editor did — its save summary reported "2 chars, 1 loc"). Everything
 * created is marked external_id_namespace='scf:editor'.
 *
 * Also re-threads inheritance over the blank-free block rows: headings
 * set the current scene for everything below; a cue sets the speaker
 * for its dialogue/parentheticals; any other type ends the speech.
 * Mutates `rows` in place (they are about to be written); call inside
 * the commit transaction.
 */
export async function linkAndCreateAtCommit(
    exec: SqlExec,
    rows: ScreenplayRow[],
    options: CommitLinkOptions = { createNew: true }):
    Promise<CommitLinkResult> {
  const result: CommitLinkResult = {
    scenesCreated: 0, locationsCreated: 0, charactersCreated: 0,
    linksCreated: 0, actsCreated: 0, sequencesCreated: 0,
  };
  const norm = (s: string): string => s.trim().toUpperCase();

  // Conflict resolutions first: renames (entity follows the line) and
  // unlinks (line breaks from the entity, re-resolves by its cue).
  if (options.renames !== undefined) {
    for (const [id, newName] of options.renames) {
      await exec(
        "UPDATE character SET name = ?, updated_at = datetime('now') " +
        "WHERE id = ?", [newName, id]);
      // Connected cue lines keep saying the old name otherwise —
      // rewrite the name portion, preserving extensions like (V.O.).
      const cueRows = await exec(
        "SELECT uuid, content FROM screenplay_lines " +
        "WHERE line_type = 'character' AND character_id = ?", [id]);
      for (const cueRow of cueRows) {
        const content = String(cueRow["content"]);
        const ext = /\s*(\([^)]*\)\s*)+$/.exec(content);
        const rewritten = newName.toUpperCase() +
          (ext !== null ? ` ${ext[0].trim()}` : "");
        await exec(
          "UPDATE screenplay_lines SET content = ? WHERE uuid = ?",
          [rewritten, String(cueRow["uuid"])]);
        const inMemory = rows.find((r) => r.uuid === cueRow["uuid"]);
        if (inMemory !== undefined) inMemory.content = rewritten;
      }
    }
  }
  if (options.unlinkUuids !== undefined) {
    for (const row of rows) {
      if (row.uuid !== undefined && options.unlinkUuids.has(row.uuid)) {
        row.characterId = null;
      }
    }
  }

  const locations = await exec("SELECT id, name FROM location");
  const locationByName = new Map(locations.map((r) =>
    [norm(String(r["name"])), r["id"] as number]));
  const characters = await exec("SELECT id, name FROM character");
  const characterByName = new Map(characters.map((r) =>
    [norm(String(r["name"])), r["id"] as number]));
  const links = await exec(
    "SELECT scene_id, character_id FROM scene_character");
  const linkSet = new Set(links.map((r) =>
    `${String(r["scene_id"])}:${String(r["character_id"])}`));

  const { parseHeading, normalizeCue } =
    await import("@scf-core/proposals/propose.ts");
  const smartTitle = (s: string): string =>
    s.toLowerCase().replace(/(^|[\s\-'/(])\p{L}/gu,
                            (c) => c.toUpperCase());

  let currentScene: number | null = null;
  let currentCharacter: number | null = null;
  const claimedScenes = new Set<number>();
  for (const row of rows) {
    if (row.lineType === "heading") {
      currentCharacter = null;
      // Invariant: a scene entity belongs to exactly ONE heading. A
      // heading whose sceneId equals the section above's scene, or a
      // scene already claimed by an earlier heading, is carrying
      // inherited/contaminated state — shed it (the next explicit
      // commit proposes it fresh). This also self-heals rows written
      // before the rule existed.
      if (row.sceneId !== null &&
          (row.sceneId === currentScene ||
           claimedScenes.has(row.sceneId))) {
        row.sceneId = null;
      }
      if (row.sceneId !== null) claimedScenes.add(row.sceneId);
      if (row.sceneId === null && row.content.trim() !== "" &&
          options.createNew) {
        const parsed = parseHeading(row.content);
        let locationId: number | null = null;
        if (parsed.locationName !== null) {
          const key = norm(parsed.locationName);
          locationId = locationByName.get(key) ?? null;
          if (locationId === null && options.createNew) {
            await exec(
              "INSERT INTO location (name, external_id_namespace) " +
              "VALUES (?, 'scf:editor')",
              [smartTitle(parsed.locationName)]);
            locationId = ((await exec(
              "SELECT last_insert_rowid() AS id"))[0]!["id"] as number);
            locationByName.set(key, locationId);
            result.locationsCreated += 1;
          }
        }
        const timeMap: Record<string, string> = {
          DAWN: "dawn", MORNING: "morning", AFTERNOON: "afternoon",
          DUSK: "dusk", NIGHT: "night", CONTINUOUS: "continuous",
        };
        const time = parsed.timeOfDay !== null
          ? timeMap[parsed.timeOfDay.toUpperCase()] ?? null : null;
        const intExtMap: Record<string, string> = {
          "INT": "interior", "EXT": "exterior", "INT/EXT": "int/ext",
        };
        const intExt = parsed.intExt !== null
          ? intExtMap[parsed.intExt] ?? null : null;
        await exec(
          "INSERT INTO scene (name, location_id, int_ext, time_of_day, " +
          "external_id_namespace) VALUES (?, ?, ?, ?, 'scf:editor')",
          [row.content.trim(), locationId, intExt, time]);
        row.sceneId = ((await exec(
          "SELECT last_insert_rowid() AS id"))[0]!["id"] as number);
        result.scenesCreated += 1;
      }
      currentScene = row.sceneId;
      continue;
    }
    row.sceneId = currentScene;
    if (row.lineType === "character") {
      if (row.content.trim() === "") {
        currentCharacter = null;
        continue;
      }
      const cue = normalizeCue(row.content.trim()).name;
      if (row.characterId === null && cue !== "" &&
          !COMPOUND_CUE.test(cue)) {
        const existing = characterByName.get(norm(cue));
        if (existing !== undefined) {
          row.characterId = existing;
        } else if (options.createNew) {
          await exec(
            "INSERT INTO character (name, external_id_namespace) " +
            "VALUES (?, 'scf:editor')", [smartTitle(cue)]);
          row.characterId = ((await exec(
            "SELECT last_insert_rowid() AS id"))[0]!["id"] as number);
          characterByName.set(norm(cue), row.characterId);
          result.charactersCreated += 1;
        }
      }
      currentCharacter = row.characterId;
      if (currentScene !== null && row.characterId !== null) {
        const key = `${String(currentScene)}:${String(row.characterId)}`;
        if (!linkSet.has(key)) {
          await exec(
            "INSERT INTO scene_character (name, scene_id, character_id) " +
            "VALUES (?, ?, ?)",
            [cue, currentScene, row.characterId]);
          linkSet.add(key);
          result.linksCreated += 1;
        }
      }
    } else if (row.lineType === "dialogue" ||
               row.lineType === "parenthetical") {
      row.characterId = currentCharacter;
    } else {
      currentCharacter = null;
    }
  }

  // Structure last: sections anchor to the scene below them, so every
  // heading must already have its id.
  const structure = await commitStructure(exec, rows, options.createNew);
  result.actsCreated = structure.actsCreated;
  result.sequencesCreated = structure.sequencesCreated;
  return result;
}
