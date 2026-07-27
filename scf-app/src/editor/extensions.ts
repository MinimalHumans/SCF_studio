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
  Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap,
  type DecorationSet, gutter, GutterMarker,
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import {
  autocompletion, completionKeymap, type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  TYPE_CYCLE, lineState, setLineType, type BlockType,
} from "./lineState.ts";
import { blankBetween } from "./screenplayDoc.ts";

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
  for (let n = 2; n <= state.doc.lines; n++) {
    const prev = entries[n - 2];
    const entry = entries[n - 1];
    if (prev !== undefined && entry !== undefined &&
        blankBetween(prev.type, entry.type)) {
      const at = state.doc.line(n).from;
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

const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let d = lineDecos.get(cls);
  if (d === undefined) {
    d = Decoration.line({ class: cls });
    lineDecos.set(cls, d);
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
      builder.add(line.from, line.from, lineDeco(`sp-${entry.type}`));
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
  constructor(private readonly label: string,
              private readonly cls: string) {
    super();
  }
  override eq(other: TypeMarker): boolean {
    return other.label === this.label;
  }
  override toDOM(): Node {
    const el = document.createElement("span");
    el.className = `sp-gutter-type ${this.cls}`;
    el.textContent = this.label;
    return el;
  }
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
    const entry =
      view.state.field(lineState).entries[
        view.state.doc.lineAt(line.from).number - 1];
    return entry === undefined ? null
      : new TypeMarker(TYPE_ABBREV[entry.type], `sp-g-${entry.type}`);
  },
  lineMarkerChange: (update) =>
    update.state.field(lineState) !== update.startState.field(lineState),
});

/** v1 parity: heading and character lines uppercase AS YOU TYPE — the
 * enforcement lives in the data, so every surface (rail, entities,
 * export) agrees, not just a CSS transform. */
const uppercaseInput = EditorView.inputHandler.of(
  (view, from, to, text) => {
    if (!/\p{Ll}/u.test(text)) return false;
    const line = view.state.doc.lineAt(from);
    const entry = view.state.field(lineState).entries[line.number - 1];
    if (entry === undefined ||
        (entry.type !== "heading" && entry.type !== "character")) {
      return false;
    }
    view.dispatch({
      changes: { from, to, insert: text.toUpperCase() },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
    return true;
  });

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
    history(),
    uppercaseInput,
    autocompletion({
      override: [screenplayCompletions(cb)],
      activateOnTyping: true,
      icons: false,
    }),
    EditorView.lineWrapping,
    keymap.of([
      ...completionKeymap,
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
