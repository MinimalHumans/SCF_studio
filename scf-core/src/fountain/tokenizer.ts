/**
 * fountain/tokenizer.ts — Stage 1: text → typed line stream.
 *
 * Deterministic and spec-faithful (Fountain 1.1), implementing the rules
 * v1 skipped or fudged: forced elements (. ! @ > ~), dual dialogue (^),
 * notes [[...]], boneyard slash-star comments, sections/synopses, title
 * page grammar, scene numbers (#1A#), and line-ending edge cases
 * (LF/CRLF/CR, BOM, whitespace-only lines).
 *
 * NO entity logic in this stage — cue normalization, dedup, and proposal
 * confidence all live in Stage 3.
 *
 * Structure: two passes.
 *  Pass A resolves the only cross-line lexical state — boneyard and note
 *  spans — producing per-line "effective" text (raw minus removed spans)
 *  and a consumed flag for lines wholly inside a span.
 *  Pass B classifies each line from its effective text plus visible-line
 *  adjacency, with a small dialogue state machine.
 *
 * Documented spec interpretations (the corpus arbitrates these):
 *  - "Blank" means empty-or-whitespace-only, EXCEPT inside a dialogue
 *    block, where a whitespace-only non-empty line continues the dialogue
 *    (the spec's two-spaces rule, accepted for any non-empty whitespace).
 *  - Boneyard- and note-only lines are transparent for adjacency checks
 *    (their content is "removed from processing" per spec), and they do
 *    not break an open dialogue block.
 *  - A truly empty line while inside a multi-line note closes the note
 *    (the spec forbids blank lines within notes); the already-consumed
 *    lines stay classified as note.
 *  - Unforced scene headings and transitions require the preceding AND
 *    following visible line to be blank (or file boundary). Forced ones
 *    require neither.
 *  - Leading whitespace is ignored for classification tests; raw text is
 *    never modified.
 */

import type {
  CharacterMeta, FountainDocument, FountainLine, LineType,
} from "./types.ts";

interface RawLine { raw: string; eol: string; }

function splitLines(text: string): RawLine[] {
  const out: RawLine[] = [];
  const re = /\r\n|\n|\r/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push({ raw: text.slice(last, m.index), eol: m[0] });
    last = m.index + m[0].length;
  }
  // Final line without terminator (also covers empty input -> one line).
  out.push({ raw: text.slice(last), eol: "" });
  return out;
}

type Consumed = "none" | "boneyard" | "note";

interface LexedLine extends RawLine {
  effective: string;
  consumed: Consumed;
}

/** Pass A: resolve boneyard and note spans across lines. */
function lexSpans(lines: RawLine[]): LexedLine[] {
  let inBoneyard = false;
  let inNote = false;
  return lines.map((line) => {
    const s = line.raw;
    if (inNote && s.trim() === "") {
      // Blank line closes an (unterminated) note per spec.
      inNote = false;
    }
    let out = "";
    let i = 0;
    let sawBoneyard = inBoneyard;
    let sawNote = inNote;
    while (i < s.length) {
      if (inBoneyard) {
        sawBoneyard = true;
        const end = s.indexOf("*/", i);
        if (end === -1) { i = s.length; break; }
        i = end + 2;
        inBoneyard = false;
        continue;
      }
      if (inNote) {
        sawNote = true;
        const end = s.indexOf("]]", i);
        if (end === -1) { i = s.length; break; }
        i = end + 2;
        inNote = false;
        continue;
      }
      const boneyardStart = s.indexOf("/*", i);
      const noteStart = s.indexOf("[[", i);
      const starts = [boneyardStart, noteStart].filter((x) => x !== -1);
      if (starts.length === 0) {
        out += s.slice(i);
        break;
      }
      const next = Math.min(...starts);
      out += s.slice(i, next);
      if (next === boneyardStart) {
        inBoneyard = true;
        sawBoneyard = true;
      } else {
        inNote = true;
        sawNote = true;
      }
      i = next + 2;
    }
    const removedAny = sawBoneyard || sawNote;
    const effective = removedAny ? out : s;
    // A line that lexes to nothing but wasn't blank is a span-only line.
    const consumed: Consumed =
      removedAny && effective.trim() === "" && s.trim() !== ""
        ? (sawBoneyard ? "boneyard" : "note")
        : "none";
    return { ...line, effective, consumed };
  });
}

/** Spec-enumerated title page keys; only these OPEN a title page. */
const TITLE_PAGE_OPENING_KEYS = new Set([
  "title", "credit", "author", "authors", "source", "draft date",
  "contact", "notes", "copyright",
]);

const HEADING_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const SCENE_NUMBER_RE = /#([^\s#][^#]*)#\s*$/;
const PAGE_BREAK_RE = /^={3,}\s*$/;

function hasLower(s: string): boolean {
  return /\p{Ll}/u.test(s);
}
function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

function parseCharacterCue(trimmed: string,
                           forced: boolean): CharacterMeta | null {
  let text = trimmed;
  let dual = false;
  if (text.endsWith("^")) {
    dual = true;
    text = text.slice(0, -1).trimEnd();
  }
  const extensions: string[] = [];
  // Peel trailing (EXT) groups: NAME (V.O.) (CONT'D)
  const extRe = /\(([^()]*)\)\s*$/;
  for (;;) {
    const m = extRe.exec(text);
    if (m === null) break;
    extensions.unshift(m[1] ?? "");
    text = text.slice(0, m.index).trimEnd();
  }
  const name = text.trim();
  if (name === "") return null;
  if (!forced) {
    if (!hasLetter(name) || hasLower(name)) return null;
  }
  return { name, extensions, dual, forced };
}

/** Tokenize + classify. The only public entry point of Stage 1. */
export function parseFountain(input: string): FountainDocument {
  let text = input;
  let bom = false;
  if (text.startsWith("\uFEFF")) {
    bom = true;
    text = text.slice(1);
  }
  const lexed = lexSpans(splitLines(text));
  const n = lexed.length;

  const isBlankAt = (i: number): boolean =>
    lexed[i] !== undefined && lexed[i]!.effective.trim() === "" &&
    lexed[i]!.consumed === "none";
  const visible = (i: number): boolean =>
    lexed[i] !== undefined && lexed[i]!.consumed === "none";

  /** Previous visible line index, or -1 (file start). */
  const prevVisible = (i: number): number => {
    for (let j = i - 1; j >= 0; j--) if (visible(j)) return j;
    return -1;
  };
  /** Next visible line index, or -1 (EOF). */
  const nextVisible = (i: number): number => {
    for (let j = i + 1; j < n; j++) if (visible(j)) return j;
    return -1;
  };
  const prevIsBlankOrStart = (i: number): boolean => {
    const j = prevVisible(i);
    return j === -1 || isBlankAt(j);
  };
  const nextIsBlankOrEof = (i: number): boolean => {
    const j = nextVisible(i);
    return j === -1 || isBlankAt(j);
  };
  const nextIsNonBlank = (i: number): boolean => {
    const j = nextVisible(i);
    return j !== -1 && !isBlankAt(j);
  };

  const out: FountainLine[] = [];
  let inTitlePage = false;
  let dialogue = false;

  // Title page: only if the very first line is a KNOWN key (spec's
  // enumerated set) — "FADE IN:" must not open a title page. Once in
  // title-page mode, arbitrary "Key: value" keys are accepted.
  const first = lexed[0];
  const firstKey =
    /^([A-Za-z][A-Za-z0-9 _\-]*):/.exec(first?.effective ?? "");
  if (firstKey !== null &&
      TITLE_PAGE_OPENING_KEYS.has(
        (firstKey[1] ?? "").trim().toLowerCase())) {
    inTitlePage = true;
  }

  for (let i = 0; i < n; i++) {
    const line = lexed[i]!;
    const push = (type: LineType,
                  extra: Partial<FountainLine> = {}): void => {
      out.push({
        index: i, raw: line.raw, eol: line.eol, type,
        ...(line.effective !== line.raw
          ? { effective: line.effective } : {}),
        ...extra,
      });
    };

    if (line.consumed === "boneyard") { push("boneyard"); continue; }
    if (line.consumed === "note") { push("note"); continue; }

    const eff = line.effective;
    const trimmed = eff.trim();

    // --- title page ---
    if (inTitlePage) {
      if (trimmed === "") {
        inTitlePage = false;
        push("blank");
        continue;
      }
      const key = /^([A-Za-z][A-Za-z0-9 _\-]*):(.*)$/.exec(eff);
      if (key !== null && !/^\s/.test(eff)) {
        push("title_page", {
          titlePage: { key: key[1] ?? "", value: (key[2] ?? "").trim() },
        });
      } else {
        push("title_page", { titlePage: { value: trimmed } });
      }
      continue;
    }

    // --- dialogue block state machine ---
    if (dialogue) {
      if (eff === "") {
        dialogue = false;
        push("blank");
        continue;
      }
      if (trimmed === "") {
        // Whitespace-only, non-empty: preserved blank inside dialogue.
        push("dialogue");
        continue;
      }
      if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        push("parenthetical");
        continue;
      }
      if (trimmed.startsWith("~")) {
        push("lyric");
        continue;
      }
      push("dialogue");
      continue;
    }

    // --- blank ---
    if (trimmed === "") { push("blank"); continue; }

    // --- structural single-line types ---
    if (PAGE_BREAK_RE.test(trimmed)) { push("page_break"); continue; }
    if (trimmed.startsWith("#")) {
      const m = /^(#+)\s*(.*)$/.exec(trimmed);
      push("section", {
        section: { depth: (m?.[1] ?? "#").length, text: m?.[2] ?? "" },
      });
      continue;
    }
    if (trimmed.startsWith("=")) { push("synopsis"); continue; }

    // --- forced elements ---
    if (trimmed.startsWith("!")) { push("action"); continue; }
    if (trimmed.startsWith(".") && !trimmed.startsWith("..")) {
      const numberMatch = SCENE_NUMBER_RE.exec(trimmed);
      push("heading", numberMatch !== null
        ? { heading: { sceneNumber: numberMatch[1] } } : {});
      continue;
    }
    if (trimmed.startsWith("~")) { push("lyric"); continue; }
    if (trimmed.startsWith(">") && trimmed.endsWith("<")) {
      push("centered");
      continue;
    }
    if (trimmed.startsWith(">")) { push("transition"); continue; }
    if (trimmed.startsWith("@")) {
      const cue = parseCharacterCue(trimmed.slice(1).trim(), true);
      if (cue !== null) {
        dialogue = true;
        push("character", { character: cue });
        continue;
      }
    }

    // --- unforced scene heading ---
    if (HEADING_RE.test(trimmed) && prevIsBlankOrStart(i) &&
        nextIsBlankOrEof(i)) {
      const numberMatch = SCENE_NUMBER_RE.exec(trimmed);
      push("heading", numberMatch !== null
        ? { heading: { sceneNumber: numberMatch[1] } } : {});
      continue;
    }

    // --- unforced transition ---
    if (trimmed.endsWith("TO:") && !hasLower(trimmed) &&
        prevIsBlankOrStart(i) && nextIsBlankOrEof(i)) {
      push("transition");
      continue;
    }

    // --- unforced character cue ---
    if (prevIsBlankOrStart(i) && nextIsNonBlank(i)) {
      const cue = parseCharacterCue(trimmed, false);
      if (cue !== null) {
        dialogue = true;
        push("character", { character: cue });
        continue;
      }
    }

    // --- default ---
    push("action");
  }

  return { bom, lines: out };
}
