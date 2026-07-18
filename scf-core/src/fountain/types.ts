/**
 * fountain/types.ts — the typed line stream (Stage 1 output).
 *
 * Design contract (second-implementation doc, Part 2):
 *  - text → typed line stream, deterministic and spec-faithful
 *  - NO entity logic in Stage 1
 *  - classify-then-serialize round-trips byte-stable: every line keeps its
 *    raw text and its own line ending; the serializer concatenates and
 *    never rewrites
 *
 * Line type is explicit state from here on — the editor never re-derives
 * it from text after import.
 */

/** The fourteen line types from the design doc, plus title_page. */
export type LineType =
  | "heading" | "action" | "character" | "dialogue" | "parenthetical"
  | "transition" | "centered" | "lyric" | "section" | "synopsis"
  | "note" | "boneyard" | "page_break" | "blank" | "title_page";

export interface HeadingMeta {
  /** Scene number from trailing #...# (e.g. "1A"), if present. */
  sceneNumber?: string;
}

export interface CharacterMeta {
  /** Cue with extensions and markers stripped: "ELEANOR". */
  name: string;
  /** Parenthesized extensions in order: ["V.O.", "CONT'D"]. */
  extensions: string[];
  /** Trailing ^ — dual dialogue marker. */
  dual: boolean;
  /** Forced with @ (permits lowercase cues). */
  forced: boolean;
}

export interface TitlePageMeta {
  /** Key for key lines ("Title"); undefined for continuation lines. */
  key?: string;
  /** Value text (same-line value, or the continuation line's content). */
  value: string;
}

export interface SectionMeta {
  /** Number of leading #. */
  depth: number;
  text: string;
}

export interface FountainLine {
  /** 0-based index into the document's line array. */
  index: number;
  /** Raw line text exactly as read — no trimming, no rewriting. */
  raw: string;
  /** This line's own terminator: "\n", "\r\n", "\r", or "" (last line). */
  eol: string;
  type: LineType;
  /**
   * Classification input: raw with boneyard/inline-note spans removed.
   * Only present when it differs from raw (the line carries inline
   * boneyard or notes). Serialization always uses `raw`.
   */
  effective?: string;
  heading?: HeadingMeta;
  character?: CharacterMeta;
  titlePage?: TitlePageMeta;
  section?: SectionMeta;
}

export interface FountainDocument {
  /** Byte-order mark present at file start (re-emitted on serialize). */
  bom: boolean;
  lines: FountainLine[];
}

/** The round-trip property, by construction. */
export function serialize(doc: FountainDocument): string {
  return (doc.bom ? "\uFEFF" : "") +
    doc.lines.map((l) => l.raw + l.eol).join("");
}
