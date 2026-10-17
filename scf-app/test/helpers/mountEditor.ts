// SPDX-License-Identifier: Apache-2.0
/**
 * mountEditor.ts — a real EditorView with the real screenplay
 * extensions, mounted in jsdom.
 *
 * jsdom has no layout, so this drives editing semantics (keymap, input
 * handlers, paste, history, completion), not scrolling or measurement.
 * Test files using it need the `@vitest-environment jsdom` pragma.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  screenplayExtensions, type ScriptCallbacks,
} from "../../src/editor/extensions.ts";
import {
  lineState, loadLines, type LineEntry,
} from "../../src/editor/lineState.ts";

// CodeMirror measures with Range rects, which jsdom does not implement.
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
const zeroRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
  toJSON: () => ({}),
};
rangeProto["getClientRects"] ??= () => [];
rangeProto["getBoundingClientRect"] ??= () => zeroRect;

export interface Mounted {
  view: EditorView;
  cb: ScriptCallbacks & { commitRequests: number };
  /** Select `pos`, or a range. */
  select: (anchor: number, head?: number) => void;
  /** Put the cursor at the end of 1-based line `n`. */
  endOfLine: (n: number) => void;
  /** Type like a keyboard: input handlers first, plain insert if none claim it. */
  type: (text: string) => void;
  /** Dispatch a keydown on the content; true if the keymap handled it. */
  press: (key: string, mods?: { shift?: boolean; ctrl?: boolean }) => boolean;
  /** Fire a paste event carrying plain text; true if a handler claimed it. */
  paste: (text: string) => boolean;
  entries: () => readonly LineEntry[];
  destroy: () => void;
}

export function mountEditor(
    lines: Array<[string, LineEntry["type"]]>,
    names: { locations?: string[]; characters?: string[] } = {}): Mounted {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const cb = {
    commitRequests: 0,
    onCommitRequest() { cb.commitRequests++; },
    onChipClick() { /* not under test */ },
    getLocations: () => names.locations ?? [],
    getCharacters: () => names.characters ?? [],
  };
  const view = new EditorView({
    state: EditorState.create({
      doc: lines.map(([text]) => text).join("\n"),
      extensions: [screenplayExtensions(cb)],
    }),
    parent,
  });
  view.dispatch({
    effects: loadLines.of(lines.map(([, type], i) =>
      ({ id: `L${String(i)}`, type }))),
  });

  const select = (anchor: number, head: number = anchor): void => {
    view.dispatch({ selection: { anchor, head } });
  };
  return {
    view, cb, select,
    endOfLine: (n) => { select(view.state.doc.line(n).to); },
    type: (text) => {
      for (const ch of text) {
        const { from, to } = view.state.selection.main;
        const claimed = view.state.facet(EditorView.inputHandler)
          .some((h) => h(view, from, to, ch, () =>
            view.state.update({ changes: { from, to, insert: ch } })));
        if (!claimed) {
          view.dispatch({
            changes: { from, to, insert: ch },
            selection: { anchor: from + ch.length },
            userEvent: "input.type",
          });
        }
      }
    },
    press: (key, mods = {}) => {
      const ev = new KeyboardEvent("keydown", {
        key, shiftKey: mods.shift === true, ctrlKey: mods.ctrl === true,
        bubbles: true, cancelable: true,
      });
      view.contentDOM.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    paste: (text) => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", {
        value: { getData: (t: string) => t === "text/plain" ? text : "" },
      });
      view.contentDOM.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    entries: () => view.state.field(lineState).entries,
    destroy: () => { view.destroy(); parent.remove(); },
  };
}
