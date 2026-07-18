/**
 * editor/extensions.ts — the CM6 view layer over lineState.
 *
 * Rendering only: line classes for screenplay typography, derived-gap
 * classes from the same blankBetween() rules the exporter uses (blanks
 * as presentation, never text), a type gutter, and the Tab keymap that
 * cycles a line's explicit type. No logic here touches identity — that
 * all lives in lineState.
 */

import { RangeSetBuilder, StateEffect, StateField, type Extension }
  from "@codemirror/state";
import {
  Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap,
  type DecorationSet, gutter, GutterMarker,
} from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
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
      const prev = entries[n - 2];
      const gap = prev !== undefined && blankBetween(prev.type, entry.type);
      const line = view.state.doc.line(n);
      builder.add(line.from, line.from,
        lineDeco(`sp-${entry.type}${gap ? " sp-gap" : ""}`));
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
}

export function screenplayExtensions(cb: ScriptCallbacks): Extension {
  return [
    lineState,
    annotationsField,
    screenplayDecorations(cb.onChipClick),
    typeGutter,
    beatGutter,
    history(),
    EditorView.lineWrapping,
    keymap.of([
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
