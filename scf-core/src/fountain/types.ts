// SPDX-License-Identifier: Apache-2.0
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

/**
 * The fourteen line types from the design doc, plus title_page.
 *
 * THE ARRAY IS THE SOURCE, and the type is derived from it. It was the
 * other way round until 0.30, and the vocabulary was therefore visible
 * only to the TypeScript compiler: a value that exists at type-check
 * time and nowhere a generator, a test or a third-party reader can
 * look. A reader building against §1.3 guessed `scene_heading` for a
 * scene heading, produced a confidently wrong story order, and had
 * nothing raised against it, because `line_type` is a free TEXT column
 * that enforces nothing.
 *
 * `scripts/emit_screenplay_tables.mjs` publishes this array as
 * `spec/screenplay-tables.json`, and `screenplayTables.test.ts` checks
 * the published file back against it. Adding a member here without
 * regenerating fails CI.
 */
export const LINE_TYPES = [
  "heading", "action", "character", "dialogue", "parenthetical",
  "transition", "centered", "lyric", "section", "synopsis",
  "note", "boneyard", "page_break", "blank", "title_page",
] as const;

export type LineType = (typeof LINE_TYPES)[number];

/**
 * One line each, for the published artifact. A reader deciding what to
 * emit for a given piece of a screenplay needs to know what these MEAN,
 * not only that they are spelled this way.
 */
export const LINE_TYPE_NOTES: Record<LineType, string> = {
  heading: "A scene heading. NOT `scene_heading`.",
  action: "Action or description. The default for an unclassified line.",
  character: "A character cue, with extensions and markers stripped.",
  dialogue: "A line of dialogue belonging to the preceding cue.",
  parenthetical: "A parenthetical within a dialogue block.",
  transition: "A transition, e.g. CUT TO:.",
  centered: "Text the screenplay centres.",
  lyric: "A lyric line, Fountain's leading ~.",
  section: "A section heading, Fountain's leading #. Outline, not script.",
  synopsis: "A synopsis line, Fountain's leading =. Outline, not script.",
  note: "An inline note, Fountain's [[...]].",
  boneyard: "Text struck out but retained, Fountain's /* ... */.",
  page_break: "An explicit page break.",
  blank: "A blank line. Carried, never inferred — it is layout the author wrote.",
  title_page: "A title-page line. Its key and value live in screenplay_title_page.",
};

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
