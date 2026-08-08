/**
 * editor/extensions.ts — the CM6 view layer over lineState.
 *
 * Rendering only: line classes for screenplay typography, derived-gap
 * classes from the same blankBetween() rules the exporter uses (blanks
 * as presentation, never text), a type gutter, and the Tab keymap that
 * cycles a line's explicit type. No logic here touches identity — that
 * all lives in lineState.
 */

import { EditorState, RangeSetBuilder, StateEffect, StateField,
  type Extension } from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType,
  highlightActiveLineGutter, keymap,
  type DecorationSet, gutter, GutterMarker,
} from "@codemirror/view";
import {
  history, historyKeymap, defaultKeymap, invertedEffects,
} from "@codemirror/commands";
import {
  autocompletion, completionKeymap, type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  TYPE_CYCLE, lineEntries, lineState, loadLines, mintLineId,
  setLineType, type BlockType, type LineEntry,
} from "./lineState.ts";
import { blankBetween } from "./screenplayDoc.ts";
import {
  SCF_CLIP_MIME, decodeClip, encodeClip, planPasteEntries, resolvePaste,
  type ClipLine,
} from "./clipboard.ts";

/**
 * Per-line annotations — entity chips, beat counts, prop-tag ranges —
 * keyed by LINE ID, not position: identity survives transactions in
 * lineState, so annotations need no mapping, only refresh after
 * load/commit when the database is consulted again.
 */
export interface TagRange {
  from: number; // offset within the line
  to: number;
  status: "anchored" | "reanchored" | "detached";
  propName: string;
}
export interface LineAnnotation {
  chip?: { label: string; entity: string; entityId: number };
  beats?: number;
  tags?: TagRange[];
}
export const setAnnotations =
  StateEffect.define<Map<string, LineAnnotation>>();
export const annotationsField =
  StateField.define<Map<string, LineAnnotation>>({
    create: () => new Map(),
    update: (value, tr) => {
      for (const e of tr.effects) {
        if (e.is(setAnnotations)) return e.value;
      }
      return value;
    },
  });

class ChipWidget extends WidgetType {
  constructor(private readonly label: string,
              private readonly entity: string,
              private readonly entityId: number,
              private readonly onClick: (e: string, id: number) => void) {
    super();
  }
  override eq(other: ChipWidget): boolean {
    return other.label === this.label && other.entity === this.entity &&
           other.entityId === this.entityId;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("button");
    el.className = `sp-chip sp-chip-${this.entity}`;
    el.textContent = this.label;
    el.title = `open ${this.entity}`;
    el.onmousedown = (ev) => {
      ev.preventDefault();
      this.onClick(this.entity, this.entityId);
    };
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Spacing between blocks is a real, MEASURED block widget — never a CSS
 * margin. CM6's pointer mapping, vertical cursor motion, and gutter
 * alignment all assume line positions match measured block heights;
 * margins broke all three at once (clicks landing on the wrong line,
 * arrow keys skipping cues, gutter labels drifting).
 */
export const LINES_PER_PAGE = 55; // manuscript rows per page

/** Manuscript column width per element (chars), for wrap estimation. */
const WRAP_WIDTH: Partial<Record<BlockType, number>> = {
  action: 60, dialogue: 35, parenthetical: 20, lyric: 35,
};

/**
 * Pagination in FORMATTED manuscript rows: every block is >=1 row,
 * derived blank lines count (blankBetween), long lines wrap at their
 * element's column. Cached against the entries identity; recomputed
 * only when lines change.
 */
export interface Pagination {
  /** editor line numbers (1-based) that START a new page */
  breakBefore: Set<number>;
  pageOfLine: (lineNo: number) => number;
  total: number;
  /** estimated total manuscript rows (for stable scroll height) */
  totalRows: number;
}
const paginationCache = new WeakMap<readonly unknown[], Pagination>();
export function paginationFor(state: EditorState): Pagination {
  const entries = state.field(lineState).entries;
  const cached = paginationCache.get(entries);
  if (cached !== undefined) return cached;
  const breakBefore = new Set<number>();
  const pageByLine: number[] = [];
  let rows = 0;
  let page = 1;
  let totalRows = 0;
  for (let n = 1; n <= entries.length; n++) {
    const entry = entries[n - 1]!;
    const prev = entries[n - 2];
    const gap = prev !== undefined &&
      blankBetween(prev.type, entry.type) ? 1 : 0;
    const len = n <= state.doc.lines ? state.doc.line(n).length : 0;
    const width = WRAP_WIDTH[entry.type] ?? 60;
    const weight = gap + Math.max(1, Math.ceil(len / width));
    if (rows + weight > LINES_PER_PAGE && n > 1) {
      // Widow/orphan rules: a heading, cue, or parenthetical must not
      // sit alone at a page bottom with its content on the next page.
      let breakAt = n;
      let pulled = 0;
      while (breakAt > 2 && pulled < 3) {
        const before = entries[breakAt - 2];
        if (before !== undefined &&
            (before.type === "heading" || before.type === "character" ||
             before.type === "parenthetical")) {
          breakAt -= 1;
          pulled += 1;
        } else {
          break;
        }
      }
      breakBefore.add(breakAt);
      page += 1;
      rows = 0;
      for (let m = breakAt; m < n; m++) {
        const e2 = entries[m - 1]!;
        const p2 = entries[m - 2];
        const g2 = p2 !== undefined &&
          blankBetween(p2.type, e2.type) ? 1 : 0;
        const l2 = m <= state.doc.lines ? state.doc.line(m).length : 0;
        rows += g2 + Math.max(1, Math.ceil(
          l2 / (WRAP_WIDTH[e2.type] ?? 60)));
        pageByLine[m - 1] = page;
      }
    }
    rows += weight;
    totalRows += weight;
    pageByLine[n - 1] = page;
  }
  const result: Pagination = {
    breakBefore,
    pageOfLine: (lineNo: number) =>
      pageByLine[Math.min(Math.max(lineNo, 1),
                          pageByLine.length) - 1] ?? 1,
    total: page,
    totalRows,
  };
  paginationCache.set(entries, result);
  return result;
}

class PageBreakWidget extends WidgetType {
  constructor(private readonly page: number) {
    super();
  }
  override eq(other: PageBreakWidget): boolean {
    return other.page === this.page;
  }
  override get estimatedHeight(): number {
    return 30;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "sp-pagebreak";
    const label = document.createElement("span");
    label.textContent = `p. ${String(this.page)}`;
    el.appendChild(label);
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class SpacerWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override get estimatedHeight(): number {
    return 14;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "sp-spacer";
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}
const SPACER = Decoration.widget({
  widget: new SpacerWidget(), block: true, side: -10,
});

/**
 * Block decorations must come from a StateField (they participate in
 * vertical layout, which ViewPlugins run too late for — CM6 enforces
 * this at runtime). Derived from lineState over the whole document;
 * recomputed only when the doc or the line entries change.
 */
function buildSpacers(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const entries = state.field(lineState).entries;
  const pagination = paginationFor(state);
  for (let n = 2; n <= state.doc.lines; n++) {
    const at = state.doc.line(n).from;
    if (pagination.breakBefore.has(n)) {
      builder.add(at, at, Decoration.widget({
        widget: new PageBreakWidget(pagination.pageOfLine(n)),
        block: true, side: -20,
      }));
    }
    const prev = entries[n - 2];
    const entry = entries[n - 1];
    if (prev !== undefined && entry !== undefined &&
        blankBetween(prev.type, entry.type)) {
      builder.add(at, at, SPACER);
    }
  }
  return builder.finish();
}

const spacerField = StateField.define<DecorationSet>({
  create: buildSpacers,
  update: (deco, tr) =>
    tr.docChanged ||
    tr.state.field(lineState) !== tr.startState.field(lineState)
      ? buildSpacers(tr.state)
      : deco,
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Spellcheck is on for prose and off for the lines that are not prose.
 * Slug lines, cues, transitions and section markers are made of proper
 * nouns and screenplay keywords; left checked, they underline almost
 * every character and location name in the script, which is exactly the
 * noise that makes people switch spellcheck off entirely.
 */
const NO_SPELLCHECK = new Set<BlockType>([
  "heading", "character", "transition", "section", "synopsis", "note",
]);

const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string, spellcheck: boolean): Decoration {
  const key = spellcheck ? cls : `${cls}\u0000nospell`;
  let d = lineDecos.get(key);
  if (d === undefined) {
    d = Decoration.line(spellcheck
      ? { class: cls }
      : { class: cls, attributes: { spellcheck: "false" } });
    lineDecos.set(key, d);
  }
  return d;
}

function buildDecorations(view: EditorView,
    onChipClick: (entity: string, id: number) => void): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const entries = view.state.field(lineState).entries;
  const annotations = view.state.field(annotationsField);
  for (const { from, to } of view.visibleRanges) {
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      const entry = entries[n - 1];
      if (entry === undefined) continue;
      const line = view.state.doc.line(n);
      builder.add(line.from, line.from, lineDeco(
        `sp-${entry.type}`, !NO_SPELLCHECK.has(entry.type)));
      const ann = annotations.get(entry.id);
      if (ann?.tags !== undefined) {
        for (const tag of ann.tags) {
          if (tag.status === "detached") continue;
          const f = Math.min(line.from + tag.from, line.to);
          const t = Math.min(line.from + tag.to, line.to);
          if (t > f) {
            builder.add(f, t, Decoration.mark({
              class: `sp-tag sp-tag-${tag.status}`,
              attributes: { title: `prop: ${tag.propName}` },
            }));
          }
        }
      }
      if (ann?.chip !== undefined) {
        builder.add(line.to, line.to, Decoration.widget({
          widget: new ChipWidget(ann.chip.label, ann.chip.entity,
                                 ann.chip.entityId, onChipClick),
          side: 1,
        }));
      }
    }
  }
  return builder.finish();
}

function screenplayDecorations(
    onChipClick: (entity: string, id: number) => void): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, onChipClick);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged ||
          update.state.field(lineState) !==
            update.startState.field(lineState) ||
          update.state.field(annotationsField) !==
            update.startState.field(annotationsField)) {
        this.decorations = buildDecorations(update.view, onChipClick);
      }
    }
  }, { decorations: (v) => v.decorations });
}

const TYPE_ABBREV: Record<BlockType, string> = {
  heading: "SCN", action: "act", character: "CHR", dialogue: "dlg",
  parenthetical: "(p)", transition: "TRN", centered: "ctr", lyric: "lyr",
  section: "sec", synopsis: "syn", note: "nte",
};

class TypeMarker extends GutterMarker {
  constructor(private readonly lineNo: number,
              private readonly label: string,
              private readonly sceneNo: number | null,
              private readonly cls: string) {
    super();
  }
  override eq(other: TypeMarker): boolean {
    return other.label === this.label && other.lineNo === this.lineNo &&
           other.sceneNo === this.sceneNo;
  }
  override toDOM(): Node {
    // Order per spec: line number | type | scene number.
    const el = document.createElement("span");
    el.className = `sp-gutter-entry ${this.cls}`;
    const scene = document.createElement("span");
    scene.className = "sp-gutter-sceneno";
    scene.textContent = this.sceneNo !== null
      ? String(this.sceneNo) : "";
    const type = document.createElement("span");
    type.className = "sp-gutter-type";
    type.textContent = this.label;
    const no = document.createElement("span");
    no.className = "sp-gutter-lineno";
    no.textContent = String(this.lineNo);
    el.append(no, type, scene);
    return el;
  }
}

const ordinalCache =
  new WeakMap<readonly unknown[], Array<number | null>>();
function sceneOrdinals(
    entries: readonly { type: BlockType }[]): Array<number | null> {
  const cached = ordinalCache.get(entries);
  if (cached !== undefined) return cached;
  const out: Array<number | null> = [];
  let n = 0;
  for (const e of entries) {
    if (e.type === "heading") {
      n += 1;
      out.push(n);
    } else {
      out.push(null);
    }
  }
  ordinalCache.set(entries, out);
  return out;
}

class BeatDotMarker extends GutterMarker {
  constructor(private readonly n: number) {
    super();
  }
  override eq(other: BeatDotMarker): boolean {
    return other.n === this.n;
  }
  override toDOM(): Node {
    const el = document.createElement("span");
    el.className = "sp-gutter-beats";
    el.title = `${this.n} performance beat(s)`;
    el.textContent = "●";
    return el;
  }
}

const beatGutter = gutter({
  class: "sp-beat-gutter",
  lineMarker: (view, line) => {
    const entry = view.state.field(lineState)
      .entries[view.state.doc.lineAt(line.from).number - 1];
    if (entry === undefined) return null;
    const beats = view.state.field(annotationsField)
      .get(entry.id)?.beats ?? 0;
    return beats > 0 ? new BeatDotMarker(beats) : null;
  },
  lineMarkerChange: (update) =>
    update.state.field(annotationsField) !==
      update.startState.field(annotationsField) ||
    update.state.field(lineState) !== update.startState.field(lineState),
});

const typeGutter = gutter({
  class: "sp-gutter",
  lineMarker: (view, line) => {
    const lineNo = view.state.doc.lineAt(line.from).number;
    const entries = view.state.field(lineState).entries;
    const entry = entries[lineNo - 1];
    if (entry === undefined) return null;
    return new TypeMarker(
      lineNo, TYPE_ABBREV[entry.type],
      sceneOrdinals(entries)[lineNo - 1] ?? null,
      `sp-g-${entry.type}`);
  },
  lineMarkerChange: (update) =>
    update.state.field(lineState) !== update.startState.field(lineState),
});

/** v1 parity: heading and character lines uppercase AS YOU TYPE — the
 * enforcement lives in the data, so every surface (rail, entities,
 * export) agrees, not just a CSS transform. */
const HEADING_START =
  /^(?:INT|EXT|EST|I\/E)[./ ]/i;

const uppercaseInput = EditorView.inputHandler.of(
  (view, from, to, text) => {
    const line = view.state.doc.lineAt(from);
    const entry = view.state.field(lineState).entries[line.number - 1];
    if (entry === undefined) return false;
    // v1 parity: an action line whose text starts INT./EXT./EST./I/E
    // becomes a heading the moment the prefix appears — this is why
    // typed scenes (and therefore new locations) exist at all when a
    // fresh line inferred "action". One-way; Tab can always re-type.
    if (entry.type === "action") {
      const would = line.text.slice(0, from - line.from) + text +
                    line.text.slice(to - line.from);
      if (HEADING_START.test(would.trimStart())) {
        view.dispatch({
          changes: { from, to, insert: text.toUpperCase() },
          selection: { anchor: from + text.length },
          effects: setLineType.of({ line: line.number,
                                    type: "heading" }),
          userEvent: "input.type",
        });
        return true;
      }
      return false;
    }
    if (entry.type !== "heading" && entry.type !== "character") {
      return false;
    }
    if (!/\p{Ll}/u.test(text)) return false;
    view.dispatch({
      changes: { from, to, insert: text.toUpperCase() },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
    return true;
  });

/** Shift-Enter: new line CONTINUES the current mode (dialogue stays
 * dialogue, action stays action) instead of context inference. */
function sameTypeNewline(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const entry = view.state.field(lineState).entries[line.number - 1];
  if (entry === undefined) return false;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: "\n" },
    selection: { anchor: sel.from + 1 },
    userEvent: "input.type",
  });
  const newLineNo = view.state.doc.lineAt(sel.from + 1).number;
  view.dispatch({
    effects: setLineType.of({ line: newLineNo, type: entry.type }),
  });
  return true;
}

/**
 * Line TYPE and line IDENTITY live in state effects, not in the text, so
 * the history has no idea they changed. Undo reverted the DOCUMENT and
 * left the entry array where it was — which for a scene move meant the
 * pre-move text carrying the post-move entries, i.e. every line rendering
 * as the wrong type. That is the "whole screenplay loses its formatting"
 * failure, and the same trap as the R33 import-undo bug: an effect the
 * history cannot see.
 *
 * invertedEffects registers the UNDO of each effect against the history
 * event, so text and state travel together in both directions. This
 * covers scene moves and pastes (loadLines) and Tab type cycling
 * (setLineType), which was never undoable either.
 */
const undoableLineState = invertedEffects.of((tr) => {
  const out = [];
  for (const effect of tr.effects) {
    if (effect.is(loadLines)) {
      out.push(loadLines.of([...tr.startState.field(lineState).entries]));
    } else if (effect.is(setLineType)) {
      const before =
        tr.startState.field(lineState).entries[effect.value.line - 1];
      if (before !== undefined) {
        out.push(setLineType.of({
          line: effect.value.line, type: before.type,
        }));
      }
    }
  }
  return out;
});

/**
 * Enter on an already-empty line makes it a scene heading instead of
 * inserting another line.
 *
 * The blank-free document model means there is no blank line to press
 * Enter on twice in the Final Draft sense — blanks are derived spacing,
 * never text (screenplayDoc.ts). What the author's hands actually do is
 * Enter (new empty line), Enter (make it a slug), and that is what this
 * binds. Applies from any line type, per Chris.
 *
 * A THIRD Enter falls through to the normal insert, so an empty heading
 * is never a trap: you can always keep going, and Tab re-types it.
 */
function headingOnEmptyLine(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.from);
  if (line.text.trim() !== "") return false;
  const entry = view.state.field(lineState).entries[line.number - 1];
  if (entry === undefined || entry.type === "heading") return false;
  view.dispatch({
    effects: setLineType.of({ line: line.number, type: "heading" }),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Collect the selected lines as a clipboard payload. */
function clipLinesFor(view: EditorView): ClipLine[] {
  const sel = view.state.selection.main;
  const entries = view.state.field(lineState).entries;
  const first = view.state.doc.lineAt(sel.from);
  let last = view.state.doc.lineAt(sel.to);
  // Selecting whole lines (shift-Down from a line start) leaves the head
  // resting on the START of the line AFTER the selection. That line is
  // not part of the copy: counting it added an empty fragment marked
  // not-whole, which forced the entire payload into copy semantics and
  // made a cut-and-paste move impossible.
  if (last.number > first.number && sel.to === last.from) {
    last = view.state.doc.line(last.number - 1);
  }
  const out: ClipLine[] = [];
  for (let n = first.number; n <= last.number; n++) {
    const entry = entries[n - 1];
    if (entry === undefined) continue;
    const line = view.state.doc.line(n);
    const from = Math.max(sel.from, line.from);
    const to = Math.min(sel.to, line.to);
    out.push({
      uuid: entry.id,
      type: entry.type,
      text: view.state.doc.sliceString(from, to),
      // Only a line taken end to end can carry its identity to a new
      // home: a partial line leaves the original in place, and two lines
      // cannot hold one uuid.
      whole: from === line.from && to === line.to,
      sceneId: null,
      characterId: null,
      locationId: null,
    });
  }
  return out;
}

export interface ClipboardContext {
  /** Identifies the working database (uuids are per-file). */
  getProjectKey: () => string;
  /** Committed links by line id, for carrying them across a paste. */
  getLinks: (lineId: string) => {
    sceneId: number | null;
    characterId: number | null;
    locationId: number | null;
  } | null;
  /** Told what a paste did, so the UI can say so. */
  onPaste?: (mode: "move" | "copy", lines: number) => void;
}

function clipboardHandlers(ctx: ClipboardContext): Extension {
  const write = (event: ClipboardEvent, view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (sel.empty) return false;
    const lines = clipLinesFor(view).map((line) => {
      const links = ctx.getLinks(line.uuid);
      return links === null ? line : { ...line, ...links };
    });
    if (lines.length === 0) return false;
    // Deliberately NOT handled: returning false lets CodeMirror's own
    // handler run, which writes text/plain and calls preventDefault.
    // Setting an extra flavour first survives that, and the plain text
    // still pastes into Final Draft or a mail client.
    event.clipboardData?.setData(SCF_CLIP_MIME, encodeClip({
      v: 1, project: ctx.getProjectKey(), lines,
    }));
    return false;
  };

  return EditorView.domEventHandlers({
    copy: write,
    cut: write,
    paste: (event, view) => {
      const payload = decodeClip(
        event.clipboardData?.getData(SCF_CLIP_MIME));
      // No payload means the text came from outside the editor. Chris's
      // call: leave it as-is rather than re-classifying — the Stage-1
      // classifier runs at import, and the editor does not re-derive
      // type from text after a line exists.
      if (payload === null || payload.lines.length === 0) return false;

      const entries = view.state.field(lineState).entries;
      const resolution = resolvePaste(payload, {
        project: ctx.getProjectKey(),
        liveIds: new Set(entries.map((e) => e.id)),
        mint: mintLineId,
      });

      const sel = view.state.selection.main;
      const firstLine = view.state.doc.lineAt(sel.from);
      const lastLine = view.state.doc.lineAt(sel.to);
      const atLineStart = sel.from === firstLine.from;
      const blockInsert =
        sel.from === sel.to && atLineStart && resolution.wholeLines;
      // A block insert carries its own line terminator, so the line it
      // lands on is pushed down whole rather than splicing onto the last
      // pasted line.
      const insert = blockInsert
        ? `${resolution.text}\n` : resolution.text;

      const next = planPasteEntries(
        entries,
        resolution.lines.map((l) => ({ id: l.id, type: l.type })),
        {
          firstLine: firstLine.number,
          lastLine: lastLine.number,
          atLineStart, blockInsert,
        });

      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        // State the whole array: the mapping's split rule would give the
        // pasted text the identity of the line it pushed down.
        effects: loadLines.of(next as LineEntry[]),
        userEvent: "input.paste",
      });
      ctx.onPaste?.(resolution.mode, resolution.lines.length);
      return true;
    },
  });
}

function cycleType(view: EditorView, direction: 1 | -1): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const entry = view.state.field(lineState).entries[line.number - 1];
  if (entry === undefined) return false;
  const at = TYPE_CYCLE.indexOf(entry.type);
  const next = TYPE_CYCLE[
    (at === -1 ? 0 : at + direction + TYPE_CYCLE.length) %
      TYPE_CYCLE.length]!;
  view.dispatch({
    effects: setLineType.of({ line: line.number, type: next }),
  });
  return true;
}

export interface ScriptCallbacks {
  onCommitRequest: () => void;
  onChipClick: (entity: string, entityId: number) => void;
  /** Current entity names for autocomplete (refreshed after commits). */
  getLocations: () => string[];
  getCharacters: () => string[];
  clipboard: ClipboardContext;
}

// v1's lists and triggers, ported: prefixes on an empty/short heading
// line; location names after the prefix (accepting appends " - ");
// time-of-day after " - "; character names on cue lines (>=2 chars,
// extensions excluded from the query).
const HEADING_PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "EST. "];
const TIME_OF_DAY = [
  "DAY", "NIGHT", "MORNING", "AFTERNOON", "EVENING", "DAWN", "DUSK",
  "SUNSET", "SUNRISE", "TWILIGHT", "MIDDAY", "CONTINUOUS", "LATER",
  "MOMENTS LATER", "SAME TIME",
];
const PREFIX_RE =
  /^(\.?(?:INT\.\/EXT\.|EXT\.\/INT\.|INT\/EXT\.|EXT\/INT\.|INT\.|EXT\.|EST\.|I\/E\.?)\s+)(.*)$/i;

function screenplayCompletions(cb: ScriptCallbacks) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    if (context.pos !== line.to) return null; // complete at line end only
    const entry =
      context.state.field(lineState).entries[line.number - 1];
    if (entry === undefined) return null;
    const text = line.text.replace(/^[ \t]+/, "");
    const lineStart = line.to - text.length;

    if (entry.type === "character") {
      const query = text.replace(/\s*\([^)]*\)\s*$/g, "").trim();
      if (query.length < 2) return null;
      const options = cb.getCharacters()
        .filter((n) => n.toUpperCase().startsWith(query.toUpperCase()) &&
                       n.toUpperCase() !== query.toUpperCase())
        .map((n) => ({ label: n.toUpperCase(), type: "variable" }));
      return options.length > 0
        ? { from: lineStart, options, filter: false } : null;
    }

    if (entry.type !== "heading") return null;

    const dashAt = text.lastIndexOf(" - ");
    if (dashAt !== -1 && PREFIX_RE.test(text)) {
      const after = text.slice(dashAt + 3).toUpperCase();
      const options = TIME_OF_DAY
        .filter((t) => t.startsWith(after))
        .map((t) => ({ label: t, type: "keyword" }));
      return options.length > 0
        ? { from: line.from + (line.text.length - text.length) +
                  dashAt + 3,
            options, filter: false }
        : null;
    }

    const prefixed = PREFIX_RE.exec(text);
    if (prefixed !== null && (prefixed[2] ?? "").trim().length >= 1) {
      const q = (prefixed[2] ?? "").replace(/\s*-\s*$/, "").trim();
      const nameFrom = line.from + (line.text.length - text.length) +
        (prefixed[1] ?? "").length;
      const options = cb.getLocations()
        .filter((n) => n.toUpperCase().startsWith(q.toUpperCase()))
        .map((n) => ({
          label: n.toUpperCase(),
          type: "constant",
          apply: `${n.toUpperCase()} - `,
        }));
      return options.length > 0
        ? { from: nameFrom, options, filter: false } : null;
    }

    if (text.length < 10) {
      const upper = text.toUpperCase();
      const options = HEADING_PREFIXES
        .filter((prefix) => prefix.startsWith(upper) || upper === "")
        .map((prefix) => ({ label: prefix.trim(), type: "keyword",
                            apply: prefix }));
      return options.length > 0
        ? { from: lineStart, options, filter: false } : null;
    }
    return null;
  };
}

export function screenplayExtensions(cb: ScriptCallbacks): Extension {
  return [
    lineState,
    annotationsField,
    spacerField,
    screenplayDecorations(cb.onChipClick),
    typeGutter,
    beatGutter,
    highlightActiveLineGutter(),
    history(),
    undoableLineState,
    uppercaseInput,
    autocompletion({
      override: [screenplayCompletions(cb)],
      activateOnTyping: true,
      icons: false,
    }),
    EditorView.lineWrapping,
    clipboardHandlers(cb.clipboard),
    // Native spellcheck. autocorrect/autocapitalize stay off: the
    // uppercase-as-you-type rule owns capitalization on heading and cue
    // lines, and a second opinion would fight it.
    EditorView.contentAttributes.of({
      spellcheck: "true", autocorrect: "off", autocapitalize: "off",
    }),
    keymap.of([
      ...completionKeymap,
      { key: "Enter", run: headingOnEmptyLine },
      { key: "Shift-Enter", run: sameTypeNewline },
      { key: "Tab", run: (v) => cycleType(v, 1) },
      { key: "Shift-Tab", run: (v) => cycleType(v, -1) },
      { key: "Mod-s", run: () => { cb.onCommitRequest(); return true; },
        preventDefault: true },
      ...historyKeymap,
      ...defaultKeymap.filter((b) => b.key !== "Tab" &&
                                     b.key !== "Shift-Tab"),
    ]),
  ];
}
