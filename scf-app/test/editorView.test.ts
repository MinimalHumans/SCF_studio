// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
/**
 * editorView.test.ts — the screenplay extensions on a real EditorView.
 *
 * editor.test.ts pins the state layer headless. This file mounts the
 * actual extension bundle in jsdom and drives it through its keymap,
 * input handlers and paste handler, so the glue between them is covered
 * too. jsdom has no layout: scrolling, viewport and pagination are out
 * of scope here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { undo, redo } from "@codemirror/commands";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import {
  lineEvents, setIdMinter, type LineEntry,
} from "../src/editor/lineState.ts";
import { mountEditor, type Mounted } from "./helpers/mountEditor.ts";

type Script = Array<[string, LineEntry["type"]]>;

const SCRIPT: Script = [
  ["INT. KITCHEN - NIGHT", "heading"],
  ["Eleanor sets the kettle on.", "action"],
  ["ELEANOR", "character"],
  ["You came back.", "dialogue"],
  ["EXT. CREEK - DAY", "heading"],
];

let m: Mounted;
let counter = 0;
beforeEach(() => {
  counter = 0;
  setIdMinter(() => `new-${String(++counter)}`);
});
afterEach(() => { m.destroy(); });

const types = (): string[] => m.entries().map((e) => e.type);
const ids = (): string[] => m.entries().map((e) => e.id);
const text = (): string => m.view.state.doc.toString();

describe("Tab cycles the line type, not the text", () => {
  test("Tab advances and Shift-Tab goes back", () => {
    m = mountEditor(SCRIPT);
    m.endOfLine(2); // action
    expect(m.press("Tab")).toBe(true);
    expect(types()[1]).toBe("character");
    expect(m.press("Tab")).toBe(true);
    expect(types()[1]).toBe("dialogue");
    expect(m.press("Tab", { shift: true })).toBe(true);
    expect(types()[1]).toBe("character");
    expect(text()).toBe(SCRIPT.map(([t]) => t).join("\n"));
  });

  test("the line keeps its id when retyped", () => {
    m = mountEditor(SCRIPT);
    const before = ids();
    m.endOfLine(2);
    m.press("Tab");
    expect(ids()).toEqual(before);
  });
});

describe("Enter and Shift-Enter", () => {
  test("Enter on an empty line makes it a heading; a third Enter inserts", () => {
    m = mountEditor([["Some action.", "action"]]);
    m.endOfLine(1);
    m.press("Enter"); // new empty line
    expect(m.view.state.doc.lines).toBe(2);
    m.press("Enter"); // becomes a heading
    expect(types()[1]).toBe("heading");
    expect(m.view.state.doc.lines).toBe(2);
    m.press("Enter"); // an empty heading is not a trap
    expect(m.view.state.doc.lines).toBe(3);
  });

  test("Shift-Enter continues the current type", () => {
    m = mountEditor(SCRIPT);
    m.endOfLine(4); // dialogue; plain Enter would infer a character cue
    m.press("Enter", { shift: true });
    expect(types()[4]).toBe("dialogue");
  });

  test("plain Enter after dialogue infers a character cue", () => {
    m = mountEditor(SCRIPT);
    m.endOfLine(4);
    m.press("Enter");
    expect(types()[4]).toBe("character");
  });
});

describe("uppercase as you type", () => {
  test("heading and character lines uppercase", () => {
    m = mountEditor([["INT. ", "heading"], ["", "character"]]);
    m.endOfLine(1);
    m.type("kitchen");
    m.endOfLine(2);
    m.type("eleanor");
    expect(m.view.state.doc.line(1).text).toBe("INT. KITCHEN");
    expect(m.view.state.doc.line(2).text).toBe("ELEANOR");
  });

  test("action lines are left alone", () => {
    m = mountEditor([["", "action"]]);
    m.type("she waits");
    expect(text()).toBe("she waits");
  });

  test("an action line becomes a heading when INT. appears", () => {
    m = mountEditor([["", "action"]]);
    m.type("int. ");
    expect(types()[0]).toBe("heading");
    // Retyping happens when the prefix completes; what follows is
    // uppercased as heading text. (The letters typed before the prefix
    // completed are not rewritten.)
    m.type("kitchen");
    expect(text().endsWith("KITCHEN")).toBe(true);
  });
});

describe("completion", () => {
  async function offered(): Promise<string[]> {
    startCompletion(m.view);
    await vi.waitFor(() => {
      expect(currentCompletions(m.view.state).length).toBeGreaterThan(0);
    });
    return currentCompletions(m.view.state).map((c) => c.label);
  }

  test("an empty heading line offers the prefixes", async () => {
    m = mountEditor([["", "heading"]]);
    m.endOfLine(1);
    expect(await offered()).toEqual(["INT.", "EXT.", "INT./EXT.", "EST."]);
  });

  test("locations are offered after the prefix", async () => {
    m = mountEditor([["INT. KIT", "heading"]],
                    { locations: ["Kitchen", "Church"] });
    m.endOfLine(1);
    expect(await offered()).toEqual(["KITCHEN"]);
  });

  test("time of day is offered after ' - '", async () => {
    m = mountEditor([["INT. KITCHEN - NI", "heading"]]);
    m.endOfLine(1);
    expect(await offered()).toEqual(["NIGHT"]);
  });

  test("character names need two characters and exclude exact matches",
      async () => {
    m = mountEditor([["EL", "character"]],
                    { characters: ["Eleanor", "Marcus", "El"] });
    m.endOfLine(1);
    expect(await offered()).toEqual(["ELEANOR"]);
  });
});

describe("paste keeps identity honest", () => {
  test("a block pasted at a line start pushes the heading down whole", () => {
    m = mountEditor(SCRIPT);
    const headingId = ids()[4];
    m.select(m.view.state.doc.line(5).from);
    expect(m.paste("One.\nTwo.")).toBe(true);
    expect(m.view.state.doc.lines).toBe(7);
    expect(m.entries()[6]).toEqual({ id: headingId, type: "heading" });
    expect(types().slice(4, 6)).toEqual(["action", "action"]);
    expect(ids().slice(4, 6)).toEqual(["new-1", "new-2"]);
  });

  test("a pasted scene heading does not inherit the scene id", () => {
    m = mountEditor(SCRIPT);
    m.endOfLine(2);
    m.paste("\nINT. CHURCH - DAY");
    const pasted = m.entries()[2]!;
    expect(pasted.id.startsWith("new-")).toBe(true);
    expect(pasted.type).toBe("action"); // classified at import, never here
    expect(SCRIPT.map((_, i) => `L${String(i)}`)).not.toContain(pasted.id);
  });

  test("an empty clipboard changes nothing", () => {
    m = mountEditor(SCRIPT);
    const before = m.entries().map((e) => ({ ...e }));
    m.endOfLine(2);
    m.paste("");
    expect(text()).toBe(SCRIPT.map(([t]) => t).join("\n"));
    expect(m.entries()).toEqual(before);
  });
});

describe("undo carries type and identity with the text", () => {
  test("undo of a Tab retype restores the type", () => {
    m = mountEditor(SCRIPT);
    m.endOfLine(2);
    m.press("Tab");
    expect(types()[1]).toBe("character");
    undo(m.view);
    expect(types()[1]).toBe("action");
    redo(m.view);
    expect(types()[1]).toBe("character");
  });

  test("undo of a paste restores the entries", () => {
    m = mountEditor(SCRIPT);
    const before = m.entries().map((e) => ({ ...e }));
    m.select(m.view.state.doc.line(5).from);
    m.paste("One.\nTwo.");
    undo(m.view);
    expect(text()).toBe(SCRIPT.map(([t]) => t).join("\n"));
    expect(m.entries()).toEqual(before);
  });
});

describe("Mod-s asks for a commit", () => {
  test("Ctrl-s calls onCommitRequest and is consumed", () => {
    m = mountEditor(SCRIPT);
    expect(m.press("s", { ctrl: true })).toBe(true);
    expect(m.cb.commitRequests).toBe(1);
  });
});

describe("events a commit would consume", () => {
  test("a split then a merge are reported in order", () => {
    m = mountEditor(SCRIPT);
    // split the action line mid-text
    m.select(m.view.state.doc.line(2).from + 8);
    m.press("Enter");
    expect(lineEvents(m.view.state).map((e) => e.kind)).toEqual(["split"]);
    // merge it back with Backspace at the start of the new line
    m.select(m.view.state.doc.line(3).from);
    m.press("Backspace");
    expect(m.view.state.doc.lines).toBe(SCRIPT.length);
    expect(lineEvents(m.view.state).map((e) => e.kind)).toEqual(["merge"]);
  });
});
