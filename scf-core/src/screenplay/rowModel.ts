/**
 * screenplay/rowModel.ts — Stage 2: the typed line stream becomes the row
 * model. Pure mapping, no heuristics, and — pointedly — NO entity
 * creation: entity ids (scene_id, character_id, location_id) are only
 * ever GIVEN to this layer (from accepted Stage-3 proposals or the
 * editor); v1's _find_or_create_* lived in its save path and is the
 * regret this design bans.
 *
 * Storage is v1's own tables ("same files, same tables"):
 *   screenplay_lines(line_order, line_type, content, scene_id,
 *                    character_id, location_id, metadata, uuid, …)
 *   screenplay_title_page(key, value, sort_order)
 * plus the version and prop-tag tables, created verbatim so Python and TS
 * produce the same schema. Title-page lines go to their own table (v1
 * convention); all other lines are rows.
 *
 * The line-type vocabulary is v2's (Stage 1's): v1's set plus lyric,
 * note, boneyard, page_break — the column is TEXT, and down-mapping
 * would discard what Stage 1 worked to classify.
 *
 * Byte fidelity survives the database: content is the raw line text; a
 * line's eol is stored in metadata only when it isn't "\n" (including ""
 * for a final unterminated line), so import → rows → export reproduces
 * the source byte-for-byte. Stage-1 meta (scene numbers, cue parts, FDX
 * marks/revisions) rides in the metadata JSON.
 */

import type { Row, SqlExec, SqlValue } from "../db.ts";
import { newUuid, q } from "../db.ts";
import type { FountainDocument, FountainLine } from "../fountain/types.ts";
import type { FdxLine } from "../fdx/parser.ts";

export interface ScreenplayRow {
  lineOrder: number;
  lineType: string;
  content: string;
  sceneId: number | null;
  characterId: number | null;
  locationId: number | null;
  /** JSON-serializable extras; null when empty. */
  metadata: Record<string, unknown> | null;
  uuid?: string;
}

export interface TitlePageRow {
  key: string;
  value: string;
  sortOrder: number;
}

export interface ScreenplayRows {
  bom: boolean;
  titlePage: TitlePageRow[];
  lines: ScreenplayRow[];
}

// ---------------------------------------------------------------------------
// Line stream -> rows (pure)
// ---------------------------------------------------------------------------

function lineMetadata(line: FountainLine): Record<string, unknown> | null {
  const meta: Record<string, unknown> = {};
  if (line.eol !== "\n") meta["eol"] = line.eol;
  if (line.heading?.sceneNumber !== undefined) {
    meta["sceneNumber"] = line.heading.sceneNumber;
  }
  if (line.character !== undefined) meta["character"] = line.character;
  if (line.section !== undefined) meta["section"] = line.section;
  const fdx = (line as FdxLine).fdx;
  if (fdx !== undefined) meta["fdx"] = fdx;
  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Map a parsed document to rows. Title-page lines become
 * screenplay_title_page rows (continuation lines append to the previous
 * key's value with their line breaks preserved); every other line becomes
 * a screenplay_lines row in document order.
 */
export function linesToRows(doc: FountainDocument): ScreenplayRows {
  const titlePage: TitlePageRow[] = [];
  const lines: ScreenplayRow[] = [];
  let order = 0;
  let titleBoundary: { eols: string[] } | null = null;

  for (const line of doc.lines) {
    if (line.type === "title_page") {
      const tp = line.titlePage;
      if (tp?.key !== undefined) {
        titlePage.push({ key: tp.key, value: tp.value,
                         sortOrder: titlePage.length });
      } else if (titlePage.length > 0) {
        const last = titlePage[titlePage.length - 1]!;
        last.value = last.value === ""
          ? (tp?.value ?? "")
          : `${last.value}\n${tp?.value ?? ""}`;
      }
      (titleBoundary ??= { eols: [] }).eols.push(line.eol);
      continue;
    }
    lines.push({
      lineOrder: order++,
      lineType: line.type,
      content: line.raw,
      sceneId: null,
      characterId: null,
      locationId: null,
      metadata: lineMetadata(line),
    });
  }
  return { bom: doc.bom, titlePage, lines };
}

/**
 * Thread entity context through rows the way v1's save path did — but
 * deterministically from GIVEN assignments, creating nothing:
 *  - a heading row takes its assigned scene id; every following row
 *    inherits it until the next heading
 *  - a character row takes its assigned character id; dialogue and
 *    parenthetical rows inherit it; a blank resets it
 * `sceneByLineOrder` / `characterByLineOrder` come from accepted
 * proposals (Stage 3) or editor actions. Rows are returned re-threaded;
 * the input is not mutated.
 */
export function applyAssignments(
    rows: ScreenplayRow[],
    sceneByLineOrder: Map<number, number>,
    characterByLineOrder: Map<number, number>,
    locationByLineOrder: Map<number, number> =
      new Map()): ScreenplayRow[] {
  let currentScene: number | null = null;
  let currentCharacter: number | null = null;
  return rows.map((row) => {
    const out = { ...row };
    if (row.lineType === "heading") {
      currentScene = sceneByLineOrder.get(row.lineOrder) ?? null;
      currentCharacter = null;
      out.sceneId = currentScene;
      out.locationId = locationByLineOrder.get(row.lineOrder) ?? null;
    } else {
      out.sceneId = currentScene;
      if (row.lineType === "character") {
        currentCharacter =
          characterByLineOrder.get(row.lineOrder) ?? null;
        out.characterId = currentCharacter;
      } else if (row.lineType === "dialogue" ||
                 row.lineType === "parenthetical") {
        out.characterId = currentCharacter;
      } else if (row.lineType === "blank") {
        currentCharacter = null;
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Rows -> text (byte-stable export)
// ---------------------------------------------------------------------------

/**
 * Serialize rows back to Fountain text. With unmodified rows from
 * linesToRows(parseFountain(text)) — and no title page, or an untouched
 * one — the output is byte-identical to the source. Title pages are
 * re-emitted from their key/value rows (multi-line values indent per the
 * spec), which normalizes only the title page's own whitespace.
 */
export function rowsToText(sp: ScreenplayRows): string {
  let out = sp.bom ? "\uFEFF" : "";
  if (sp.titlePage.length > 0) {
    for (const tp of [...sp.titlePage]
        .sort((a, b) => a.sortOrder - b.sortOrder)) {
      const parts = tp.value.split("\n");
      out += `${tp.key}: ${parts[0] ?? ""}`.trimEnd() + "\n";
      for (const cont of parts.slice(1)) out += `   ${cont}\n`;
    }
    out += "\n";
  }
  sp.lines.forEach((row, i) => {
    const eol = row.metadata?.["eol"];
    out += row.content +
      (typeof eol === "string" ? eol : i === sp.lines.length - 1 &&
        sp.titlePage.length === 0 && row.content === "" ? "" : "\n");
  });
  return out;
}

// ---------------------------------------------------------------------------
// Database I/O (v1's tables, verbatim DDL)
// ---------------------------------------------------------------------------

/** DDL identical to Python's screenplay_db.init_screenplay_tables. */
export async function initScreenplayTables(exec: SqlExec): Promise<void> {
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER REFERENCES scene(id) ON DELETE SET NULL,
    line_order INTEGER NOT NULL,
    line_type TEXT NOT NULL DEFAULT 'action',
    content TEXT NOT NULL DEFAULT '',
    character_id INTEGER REFERENCES character(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES location(id) ON DELETE SET NULL,
    metadata JSON,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_screenplay_lines_order
    ON screenplay_lines(line_order)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_screenplay_lines_scene
    ON screenplay_lines(scene_id)`);
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_title_page (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_number INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    published_at TEXT DEFAULT (datetime('now')),
    line_count INTEGER DEFAULT 0,
    scene_count INTEGER DEFAULT 0,
    character_count INTEGER DEFAULT 0,
    location_count INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_version_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL
      REFERENCES screenplay_versions(id) ON DELETE CASCADE,
    line_order INTEGER NOT NULL,
    line_type TEXT NOT NULL DEFAULT 'action',
    content TEXT NOT NULL DEFAULT '',
    scene_id INTEGER,
    character_id INTEGER,
    location_id INTEGER,
    metadata JSON,
    source_uuid TEXT
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_version_lines_version
    ON screenplay_version_lines(version_id)`);
  // Added in 2.6. A snapshot row has its own uuid (v1's contract, and
  // the unique index on version-line uuids depends on it), so it needed
  // a SECOND column to record which LIVE line it was taken from.
  // Without it a revert has no way to give a restored line back its
  // original identity, and every beat and prop tag anchored to it would
  // be orphaned by the act of reverting.
  const versionCols = await exec(
    `PRAGMA table_info("screenplay_version_lines")`);
  if (!versionCols.some((c) => String(c["name"]) === "source_uuid")) {
    await exec(
      "ALTER TABLE screenplay_version_lines ADD COLUMN source_uuid TEXT");
  }
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_version_title_page (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL
      REFERENCES screenplay_versions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
  )`);
  await exec(`CREATE TABLE IF NOT EXISTS screenplay_prop_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tagged_text TEXT NOT NULL,
    prop_id INTEGER NOT NULL REFERENCES prop(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_prop_tags_prop
    ON screenplay_prop_tags(prop_id)`);
  // v2 additive columns: prop tags anchored to line identity + offsets
  // (block-anchored ranges, not text match). Mirrored in Python's
  // screenplay_db.init_screenplay_tables.
  const tagCols = await exec(`PRAGMA table_info("screenplay_prop_tags")`);
  const have = new Set(tagCols.map((c) => String(c["name"])));
  for (const [col, typ] of [["line_uuid", "TEXT"],
                            ["start_offset", "INTEGER"],
                            ["end_offset", "INTEGER"]] as const) {
    if (!have.has(col)) {
      await exec(
        `ALTER TABLE screenplay_prop_tags ADD COLUMN ${col} ${typ}`);
    }
  }
}

/**
 * Replace the stored screenplay with these rows. Fresh-import semantics:
 * existing lines are deleted and uuids stamped anew (uuid-preserving
 * re-import belongs to the revision flow, which diffs before writing).
 */
export async function writeScreenplay(
    exec: SqlExec, sp: ScreenplayRows): Promise<void> {
  await exec("DELETE FROM screenplay_lines");
  await exec("DELETE FROM screenplay_title_page");
  for (const row of sp.lines) {
    await exec(
      `INSERT INTO screenplay_lines
       (line_order, line_type, content, scene_id, character_id,
        location_id, metadata, uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.lineOrder, row.lineType, row.content, row.sceneId,
       row.characterId, row.locationId,
       row.metadata === null ? null : JSON.stringify(row.metadata),
       row.uuid ?? newUuid()]);
  }
  for (const tp of sp.titlePage) {
    await exec(
      `INSERT INTO screenplay_title_page (key, value, sort_order)
       VALUES (?, ?, ?)`,
      [tp.key, tp.value, tp.sortOrder]);
  }
}

export async function readScreenplay(
    exec: SqlExec): Promise<ScreenplayRows> {
  const lineRows = await exec(
    "SELECT * FROM screenplay_lines ORDER BY line_order");
  const tpRows = await exec(
    "SELECT * FROM screenplay_title_page ORDER BY sort_order");
  const toMeta = (v: SqlValue | undefined):
      Record<string, unknown> | null => {
    if (v === null || v === undefined || v === "") return null;
    try {
      return JSON.parse(String(v)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const asNum = (v: SqlValue | undefined): number | null =>
    typeof v === "number" ? v : null;
  return {
    bom: false,
    titlePage: tpRows.map((r: Row) => ({
      key: String(r["key"]), value: String(r["value"]),
      sortOrder: asNum(r["sort_order"]) ?? 0,
    })),
    lines: lineRows.map((r: Row) => ({
      lineOrder: asNum(r["line_order"]) ?? 0,
      lineType: String(r["line_type"]),
      content: String(r["content"]),
      sceneId: asNum(r["scene_id"]),
      characterId: asNum(r["character_id"]),
      locationId: asNum(r["location_id"]),
      metadata: toMeta(r["metadata"]),
      uuid: r["uuid"] === null || r["uuid"] === undefined
        ? undefined : String(r["uuid"]),
    })),
  };
}
