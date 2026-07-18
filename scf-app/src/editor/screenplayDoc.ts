/**
 * editor/screenplayDoc.ts — the editor's document model glue.
 *
 * Three pure pieces around lineState:
 *
 *  1. Import projection: parsed line stream / stored rows → editor blocks
 *     (blank lines dropped — blanks are never stored, per the fragility
 *     postmortem) with each block carrying its uuid as line identity.
 *
 *  2. Fountain export: blocks → text with spacing DERIVED from the
 *     spec's own rules (blank before headings/cues/transitions, after
 *     headings, around sections…). Spacing is presentation; the
 *     structured data IS the screenplay.
 *
 *  3. Commit projection: editor state → row upserts keyed by line ID —
 *     transactional, pure, no parsing. Heading edits never mutate scene
 *     entities; they surface as stale-scene notices for the UI to offer
 *     a sync.
 */

import type { EditorState } from "@codemirror/state";
import { newUuid } from "@scf-core/db.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import { parseHeading } from "@scf-core/proposals/propose.ts";
import { lineEntries, type BlockType, type LineEntry } from "./lineState.ts";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  sceneId: number | null;
  characterId: number | null;
  locationId: number | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Forcing markers (. @ > ~ ><) are Fountain SYNTAX, not content: block
 * text stores the logical line, markers are re-derived at export. Types
 * whose marker doubles as content structure (# sections, = synopses,
 * [[notes]]) keep their raw form — the exporter passes those through.
 */
export function stripMarker(type: BlockType, raw: string): string {
  switch (type) {
    case "heading":
      return /^\.(?!\.)/.test(raw.trimStart())
        ? raw.trimStart().slice(1) : raw;
    case "character":
      return raw.trimStart().startsWith("@")
        ? raw.trimStart().slice(1) : raw;
    case "transition": {
      const t = raw.trimStart();
      return t.startsWith(">") && !t.trimEnd().endsWith("<")
        ? t.slice(1).trimStart() : raw;
    }
    case "centered": {
      const t = raw.trim();
      return t.startsWith(">") && t.endsWith("<")
        ? t.slice(1, -1).trim() : raw;
    }
    case "lyric":
      return raw.trimStart().startsWith("~")
        ? raw.trimStart().slice(1) : raw;
    case "action":
      return raw.trimStart().startsWith("!")
        ? raw.trimStart().slice(1) : raw;
    default:
      return raw;
  }
}

const EDITOR_TYPES = new Set<string>([
  "heading", "action", "character", "dialogue", "parenthetical",
  "transition", "centered", "lyric", "section", "synopsis", "note",
]);

/**
 * Stored rows → editor blocks. Blanks (legacy rows or fresh imports) are
 * dropped; boneyard rows keep their text as note blocks so nothing the
 * author imported silently disappears; page breaks drop (pagination is
 * derived, not authored, in v2).
 */
export function rowsToBlocks(rows: ScreenplayRow[]): Block[] {
  const blocks: Block[] = [];
  for (const row of rows) {
    if (row.lineType === "blank" || row.lineType === "page_break" ||
        row.lineType === "title_page") {
      continue;
    }
    const type: BlockType = EDITOR_TYPES.has(row.lineType)
      ? row.lineType as BlockType
      : row.lineType === "boneyard" ? "note" : "action";
    blocks.push({
      id: row.uuid ?? newUuid(),
      type,
      text: stripMarker(type, row.content),
      sceneId: row.sceneId,
      characterId: row.characterId,
      locationId: row.locationId,
      metadata: row.metadata,
    });
  }
  return blocks;
}

/** Blocks → the CM6 document (one line per block) + line entries. */
export function blocksToDoc(blocks: Block[]): {
  doc: string; entries: LineEntry[];
} {
  return {
    doc: blocks.map((b) => b.text).join("\n"),
    entries: blocks.map((b) => ({ id: b.id, type: b.type })),
  };
}

// ---------------------------------------------------------------------------
// Spacing derivation (Fountain export)
// ---------------------------------------------------------------------------

/** Does a blank line belong between a block of type `a` and one of type
 * `b`? The Fountain spec's own spacing rules, as a pure function. */
export function blankBetween(a: BlockType, b: BlockType): boolean {
  // Dialogue clusters stay tight: cue -> (parenthetical|dialogue|lyric),
  // and parenthetical/lyric within a speech.
  if (a === "character" &&
      (b === "dialogue" || b === "parenthetical" || b === "lyric")) {
    return false;
  }
  if ((a === "dialogue" || a === "parenthetical" || a === "lyric") &&
      (b === "dialogue" || b === "parenthetical" || b === "lyric")) {
    return false;
  }
  // Consecutive lyrics outside dialogue stay tight (a sung verse).
  if (a === "lyric" && b === "lyric") return false;
  // Everything else separates: headings, action paragraphs, cues,
  // transitions, sections, synopses, notes.
  return true;
}

/** Export blocks as spec-spaced Fountain text. */
export function blocksToFountain(blocks: Block[]): string {
  let out = "";
  blocks.forEach((block, i) => {
    if (i > 0 &&
        blankBetween(blocks[i - 1]!.type, block.type)) {
      out += "\n";
    }
    // Forced markers for types whose unforced form depends on content
    // the author may not have typed (a lowercase cue, a non-INT heading).
    out += exportLine(block) + "\n";
  });
  return out;
}

const HEADING_SHAPE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

function exportLine(block: Block): string {
  const t = block.text;
  switch (block.type) {
    case "heading":
      return HEADING_SHAPE.test(t.trim()) ? t : `.${t}`;
    case "character":
      return /\p{Ll}/u.test(t.trim().replace(/\([^)]*\)\s*$/g, "")
                              .replace(/\^\s*$/, ""))
        ? `@${t}` : t;
    case "transition":
      return /TO:\s*$/.test(t.trim()) && !/\p{Ll}/u.test(t)
        ? t : `> ${t}`;
    case "centered":
      return `>${t}<`;
    case "lyric":
      return `~${t}`;
    case "parenthetical": {
      const trimmed = t.trim();
      return trimmed.startsWith("(") && trimmed.endsWith(")")
        ? t : `(${t})`;
    }
    case "section":
      return t.startsWith("#") ? t : `# ${t}`;
    case "synopsis":
      return t.startsWith("=") ? t : `= ${t}`;
    case "note":
      return /^\s*\[\[.*\]\]\s*$/.test(t) ? t : `[[${t}]]`;
    case "action": {
      // Authorial type is explicit state; export must round-trip it.
      // An action line that LOOKS like a heading or transition would
      // reclassify once spec spacing surrounds it — Fountain's ! exists
      // exactly for this.
      const trimmed = t.trim();
      const shapedLikeHeading = HEADING_SHAPE.test(trimmed) ||
        /^\.(?!\.)/.test(trimmed);
      const shapedLikeTransition =
        /TO:\s*$/.test(trimmed) && !/\p{Ll}/u.test(trimmed);
      const shapedLikeMarker = /^[@>~#=]|^={3,}/.test(trimmed);
      return shapedLikeHeading || shapedLikeTransition ||
             shapedLikeMarker ? `!${t}` : t;
    }
    default:
      return t;
  }
}

// ---------------------------------------------------------------------------
// Commit projection
// ---------------------------------------------------------------------------

export interface CommitPlan {
  /** Rows in document order, uuid-keyed; line_order is the index. */
  rows: ScreenplayRow[];
  /** Headings whose text changed relative to the last committed state —
   * the linked scene is STALE, never auto-mutated. */
  staleScenes: Array<{
    uuid: string; sceneId: number | null; headingText: string;
  }>;
}

/**
 * Project editor state onto rows. `previous` is the last committed
 * blocks by uuid (for entity-id carry and stale detection). Pure — the
 * caller writes rows and shows stale notices.
 */
export function commitPlan(
    state: EditorState,
    previous: Map<string, Block>): CommitPlan {
  const entries = lineEntries(state);
  const rows: ScreenplayRow[] = [];
  const staleScenes: CommitPlan["staleScenes"] = [];
  for (let i = 0; i < state.doc.lines; i++) {
    const entry = entries[i];
    if (entry === undefined) break;
    const text = state.doc.line(i + 1).text;
    const prev = previous.get(entry.id);
    rows.push({
      lineOrder: i,
      lineType: entry.type,
      content: text,
      sceneId: prev?.sceneId ?? null,
      characterId: prev?.characterId ?? null,
      locationId: prev?.locationId ?? null,
      metadata: prev?.metadata ?? null,
      uuid: entry.id,
    });
    if (entry.type === "heading" && prev !== undefined &&
        prev.type === "heading" && prev.text !== text) {
      staleScenes.push({ uuid: entry.id, sceneId: prev.sceneId,
                         headingText: text });
    }
  }
  return { rows, staleScenes };
}

/** The sync a stale notice offers: derived scene fields from the edited
 * heading — applied only when the author accepts. */
export function sceneSyncFromHeading(headingText: string): {
  name: string; int_ext: string | null; time_of_day: string | null;
} {
  const parsed = parseHeading(headingText);
  return {
    name: headingText.trim().replace(/^\./, ""),
    int_ext: parsed.intExt,
    time_of_day: parsed.timeOfDay,
  };
}
