/**
 * editor.test.ts — the Part 3 state layer, headless.
 *
 * These tests run @codemirror/state in Node with no DOM: the design's
 * riskiest piece (line identity mapped through transactions) gets pinned
 * before any rendering exists. Each test states which Part 3 commitment
 * it guards.
 */

import { describe, expect, test, beforeEach } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import {
  assertAligned, inferredTypeAfter, lineEntries, lineEvents, lineState,
  loadLines, setIdMinter, setLineType, type LineEntry,
} from "../src/editor/lineState.ts";
import {
  blankBetween, blocksToDoc, blocksToFountain, commitPlan, rowsToBlocks,
  sceneSyncFromHeading, type Block,
} from "../src/editor/screenplayDoc.ts";
import { parseFountain } from "@scf-core/fountain/index.ts";
import { linesToRows } from "@scf-core/screenplay/rowModel.ts";

let counter = 0;
beforeEach(() => {
  counter = 0;
  setIdMinter(() => `new-${++counter}`);
});

function stateOf(blocks: Array<[string, LineEntry["type"]]>): EditorState {
  const entries: LineEntry[] = blocks.map(([, type], i) =>
    ({ id: `L${i}`, type }));
  const base = EditorState.create({
    doc: blocks.map(([text]) => text).join("\n"),
    extensions: [lineState],
  });
  return base.update({ effects: loadLines.of(entries) }).state;
}

const SCRIPT: Array<[string, LineEntry["type"]]> = [
  ["INT. KITCHEN - NIGHT", "heading"],
  ["Eleanor sets the kettle on.", "action"],
  ["ELEANOR", "character"],
  ["You came back.", "dialogue"],
  ["EXT. CREEK - DAY", "heading"],
];

describe("lineState: identity through transactions", () => {
  test("typing within a line preserves id and type by construction",
      () => {
    const s0 = stateOf(SCRIPT);
    const line2 = s0.doc.line(2);
    const s1 = s0.update({
      changes: { from: line2.to, insert: " It whistles." },
    }).state;
    assertAligned(s1);
    expect(lineEntries(s1)).toEqual(lineEntries(s0));
    expect(lineEvents(s1)).toEqual([]);
  });

  test("Enter splits: first fragment keeps the id; new line minted " +
       "with inferred type; explicit split event", () => {
    const s0 = stateOf(SCRIPT);
    const line2 = s0.doc.line(2); // action
    const cut = line2.from + "Eleanor sets".length;
    const s1 = s0.update({ changes: { from: cut, insert: "\n" } }).state;
    assertAligned(s1);
    const entries = lineEntries(s1);
    expect(entries[1]).toEqual({ id: "L1", type: "action" });
    expect(entries[2]).toEqual({ id: "new-1", type: "action" });
    expect(entries[3]).toEqual({ id: "L2", type: "character" });
    expect(lineEvents(s1)).toEqual([
      { kind: "split", originalId: "L1", newIds: ["new-1"] },
    ]);
  });

  test("split after a cue infers dialogue for the new line", () => {
    const s0 = stateOf(SCRIPT);
    const cue = s0.doc.line(3); // ELEANOR
    const s1 = s0.update({
      changes: { from: cue.to, insert: "\n" },
    }).state;
    expect(lineEntries(s1)[3]).toEqual({ id: "new-1", type: "dialogue" });
  });

  test("backspace join: earlier id survives; merge event lists absorbed",
      () => {
    const s0 = stateOf(SCRIPT);
    const line3 = s0.doc.line(3);
    // Delete the newline between line 2 and line 3.
    const s1 = s0.update({
      changes: { from: line3.from - 1, to: line3.from },
    }).state;
    assertAligned(s1);
    const entries = lineEntries(s1);
    expect(entries.map((e) => e.id)).toEqual(["L0", "L1", "L3", "L4"]);
    expect(entries[1]!.type).toBe("action"); // survivor's type wins
    expect(lineEvents(s1)).toEqual([
      { kind: "merge", survivorId: "L1", absorbedIds: ["L2"] },
    ]);
  });

  test("selecting across lines and deleting merges into the earliest",
      () => {
    const s0 = stateOf(SCRIPT);
    const from = s0.doc.line(2).from + 7;
    const to = s0.doc.line(4).from + 4;
    const s1 = s0.update({ changes: { from, to } }).state;
    assertAligned(s1);
    expect(lineEntries(s1).map((e) => e.id))
      .toEqual(["L0", "L1", "L4"]);
    expect(lineEvents(s1)).toEqual([
      { kind: "merge", survivorId: "L1", absorbedIds: ["L2", "L3"] },
    ]);
  });

  test("multi-line paste chains inference from the split line", () => {
    const s0 = stateOf(SCRIPT);
    const cue = s0.doc.line(3); // character
    const s1 = s0.update({
      changes: { from: cue.to, insert: "\nHello.\nMARCUS" },
    }).state;
    assertAligned(s1);
    const entries = lineEntries(s1);
    // character -> dialogue -> character
    expect(entries[3]).toEqual({ id: "new-1", type: "dialogue" });
    expect(entries[4]).toEqual({ id: "new-2", type: "character" });
  });

  test("two edits in one transaction both map (back-to-front)", () => {
    const s0 = stateOf(SCRIPT);
    const l1 = s0.doc.line(1);
    const l4 = s0.doc.line(4);
    const s1 = s0.update({
      changes: [
        { from: l1.to, insert: "\n" },
        { from: l4.to, insert: "\n" },
      ],
    }).state;
    assertAligned(s1);
    expect(lineEntries(s1).map((e) => e.id)).toEqual(
      ["L0", "new-2", "L1", "L2", "L3", "new-1", "L4"]);
    expect(lineEvents(s1)).toHaveLength(2);
  });

  test("setLineType changes type only; events clear next transaction",
      () => {
    const s0 = stateOf(SCRIPT);
    const s1 = s0.update({
      effects: setLineType.of({ line: 2, type: "centered" }),
    }).state;
    expect(lineEntries(s1)[1]).toEqual({ id: "L1", type: "centered" });
    const split = s1.update({
      changes: { from: s1.doc.line(1).to, insert: "\n" },
    }).state;
    expect(lineEvents(split)).toHaveLength(1);
    const later = split.update({
      changes: { from: 0, insert: "X" },
    }).state;
    expect(lineEvents(later)).toEqual([]);
  });

  test("inference table matches the Celtx-style flow", () => {
    expect(inferredTypeAfter("heading")).toBe("action");
    expect(inferredTypeAfter("character")).toBe("dialogue");
    expect(inferredTypeAfter("parenthetical")).toBe("dialogue");
    expect(inferredTypeAfter("dialogue")).toBe("character");
    expect(inferredTypeAfter("transition")).toBe("heading");
    expect(inferredTypeAfter("action")).toBe("action");
  });
});

// ---------------------------------------------------------------------------

const FOUNTAIN = `INT. KITCHEN - NIGHT

Eleanor sets the kettle on.

ELEANOR
(softly)
You came back.

MARCUS
I never left.

CUT TO:

EXT. CREEK - DAY

Water over stones.`;

describe("screenplayDoc: blocks, spacing, export", () => {
  test("rowsToBlocks drops blanks; nothing else is lost", () => {
    const rows = linesToRows(parseFountain(FOUNTAIN)).lines;
    rows.forEach((r, i) => { r.uuid = `u${i}`; });
    const blocks = rowsToBlocks(rows);
    expect(blocks.some((b) => (b.type as string) === "blank")).toBe(false);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading", "action", "character", "parenthetical", "dialogue",
      "character", "dialogue", "transition", "heading", "action",
    ]);
    // Identity: uuids carried from rows.
    expect(blocks[0]!.id).toBe("u0");
  });

  test("spacing derivation reproduces spec spacing exactly", () => {
    const rows = linesToRows(parseFountain(FOUNTAIN)).lines;
    const blocks = rowsToBlocks(rows);
    expect(blocksToFountain(blocks)).toBe(FOUNTAIN + "\n");
  });

  test("export forces markers where content requires them", () => {
    const block = (type: Block["type"], text: string): Block => ({
      id: "x", type, text, sceneId: null, characterId: null,
      locationId: null, metadata: null,
    });
    expect(blocksToFountain([block("heading", "THE BARN, CONTINUOUS")]))
      .toBe(".THE BARN, CONTINUOUS\n");
    expect(blocksToFountain([block("character", "McClane")]))
      .toBe("@McClane\n");
    expect(blocksToFountain([block("transition", "SMASH CUT")]))
      .toBe("> SMASH CUT\n");
    expect(blocksToFountain([block("centered", "THE END")]))
      .toBe(">THE END<\n");
    expect(blocksToFountain([block("lyric", "Willow, weep")]))
      .toBe("~Willow, weep\n");
    expect(blocksToFountain([block("note", "fix this")]))
      .toBe("[[fix this]]\n");
  });

  test("export -> reparse -> same types (the round-trip that matters)",
      () => {
    const blocks = rowsToBlocks(linesToRows(parseFountain(FOUNTAIN)).lines);
    const reparsed = parseFountain(blocksToFountain(blocks));
    const back = rowsToBlocks(linesToRows(reparsed).lines);
    expect(back.map((b) => [b.type, b.text]))
      .toEqual(blocks.map((b) => [b.type, b.text]));
  });

  test("blankBetween: dialogue clusters tight, paragraphs apart", () => {
    expect(blankBetween("character", "dialogue")).toBe(false);
    expect(blankBetween("character", "parenthetical")).toBe(false);
    expect(blankBetween("dialogue", "parenthetical")).toBe(false);
    expect(blankBetween("dialogue", "character")).toBe(true);
    expect(blankBetween("action", "action")).toBe(true);
    expect(blankBetween("heading", "action")).toBe(true);
    expect(blankBetween("dialogue", "heading")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("screenplayDoc: commit projection", () => {
  function editorFor(blocks: Block[]): EditorState {
    const { doc, entries } = blocksToDoc(blocks);
    return EditorState.create({ doc, extensions: [lineState] })
      .update({ effects: loadLines.of(entries) }).state;
  }

  function blocksFrom(text: string): Block[] {
    const rows = linesToRows(parseFountain(text)).lines;
    rows.forEach((r, i) => { r.uuid = `u${i}`; });
    const blocks = rowsToBlocks(rows);
    blocks[0]!.sceneId = 42; // pretend the heading is linked
    return blocks;
  }

  test("rows come back uuid-keyed, ordered, entity ids carried", () => {
    const blocks = blocksFrom(FOUNTAIN);
    const prev = new Map(blocks.map((b) => [b.id, b]));
    const state = editorFor(blocks);
    const plan = commitPlan(state, prev);
    expect(plan.rows).toHaveLength(blocks.length);
    expect(plan.rows.map((r) => r.lineOrder))
      .toEqual(blocks.map((_, i) => i));
    expect(plan.rows[0]!.uuid).toBe(blocks[0]!.id);
    expect(plan.rows[0]!.sceneId).toBe(42);
    expect(plan.staleScenes).toEqual([]);
    expect(plan.rows.some((r) => r.lineType === "blank")).toBe(false);
  });

  test("editing a linked heading yields a stale notice, no mutation",
      () => {
    const blocks = blocksFrom(FOUNTAIN);
    const prev = new Map(blocks.map((b) => [b.id, b]));
    let state = editorFor(blocks);
    const h = state.doc.line(1);
    state = state.update({
      changes: { from: h.from, to: h.to,
                 insert: "INT. KITCHEN - DAWN" },
    }).state;
    const plan = commitPlan(state, prev);
    expect(plan.staleScenes).toEqual([{
      uuid: blocks[0]!.id, sceneId: 42,
      headingText: "INT. KITCHEN - DAWN",
    }]);
    // The row still carries the OLD link — nothing auto-mutated.
    expect(plan.rows[0]!.sceneId).toBe(42);
  });

  test("a new line (split) commits with a fresh uuid and no entity ids",
      () => {
    const blocks = blocksFrom(FOUNTAIN);
    const prev = new Map(blocks.map((b) => [b.id, b]));
    let state = editorFor(blocks);
    const l2 = state.doc.line(2);
    state = state.update({
      changes: { from: l2.to, insert: "\nShe waits." },
    }).state;
    const plan = commitPlan(state, prev);
    const added = plan.rows.find((r) => r.content === "She waits.")!;
    expect(added.uuid).toBe("new-1");
    expect(added.sceneId).toBeNull();
    expect(plan.rows).toHaveLength(blocks.length + 1);
  });

  test("sceneSyncFromHeading derives fields for the offered sync", () => {
    expect(sceneSyncFromHeading("INT. KITCHEN - DAWN")).toEqual({
      name: "INT. KITCHEN - DAWN", int_ext: "INT", time_of_day: "DAWN",
    });
  });
});

describe("screenplayDoc: markers are syntax, not content", () => {
  test("stripMarker removes forcing syntax at block construction", () => {
    const rows = linesToRows(parseFountain(
      "> TIME CUT:\n\n.MONTAGE - SEASONS\n\n@McClane\nHi.\n\n" +
      ">THE END<\n\n~Willow\n\n!INT. LOOKS LIKE A HEADING\n")).lines;
    const blocks = rowsToBlocks(rows);
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ["transition", "TIME CUT:"],
      ["heading", "MONTAGE - SEASONS"],
      ["character", "McClane"],
      ["dialogue", "Hi."],
      ["centered", "THE END"],
      ["lyric", "Willow"],
      ["action", "INT. LOOKS LIKE A HEADING"],
    ]);
  });

  test("export re-derives markers; forced action survives the cycle",
      () => {
    const source = "> TIME CUT:\n\n!EXT. NOT A HEADING - DAY\n";
    const once = rowsToBlocks(linesToRows(parseFountain(source)).lines);
    const exported = blocksToFountain(once);
    expect(exported).toBe(source);
    const twice = rowsToBlocks(
      linesToRows(parseFountain(exported)).lines);
    expect(twice.map((b) => [b.type, b.text]))
      .toEqual(once.map((b) => [b.type, b.text]));
  });
});

describe("split at line start: identity follows the content", () => {
  test("pushing a heading down to insert above it keeps the id (and " +
       "scene link) on the heading text", () => {
    const s0 = stateOf(SCRIPT);
    const heading = s0.doc.line(5); // EXT. CREEK - DAY, id L4
    const s1 = s0.update({
      changes: { from: heading.from, insert: "\n" },
    }).state;
    assertAligned(s1);
    const entries = lineEntries(s1);
    // New empty line above gets fresh identity, inferred from context;
    // the pushed-down heading KEEPS L4 — its scene link travels with it.
    expect(entries[4]!.id).toBe("new-1");
    expect(entries[5]).toEqual({ id: "L4", type: "heading" });
    expect(lineEvents(s1)).toEqual([
      { kind: "split", originalId: "L4", newIds: ["new-1"] },
    ]);
  });

  test("mid-line splits still keep the first fragment's id", () => {
    const s0 = stateOf(SCRIPT);
    const line2 = s0.doc.line(2);
    const cut = line2.from + 7;
    const s1 = s0.update({ changes: { from: cut, insert: "\n" } }).state;
    const entries = lineEntries(s1);
    expect(entries[1]!.id).toBe("L1");
    expect(entries[2]!.id).toBe("new-1");
  });
});

describe("scene identity is never inherited", () => {
  test("a line that becomes a heading sheds its threaded sceneId " +
       "(the mid-document new-scene bug)", () => {
    const blocks = blocksFrom(FOUNTAIN);
    // Simulate the auto-save having threaded scene context onto an
    // action line (block index 1), as the write path does.
    blocks[1]!.sceneId = 42;
    const prev = new Map(blocks.map((b) => [b.id, b]));
    let state = editorForBlocks(blocks);
    // The author Tabs that action line into a heading.
    state = state.update({
      effects: setLineType.of({ line: 2, type: "heading" }),
    }).state;
    const plan = commitPlan(state, prev);
    expect(plan.rows[1]!.lineType).toBe("heading");
    expect(plan.rows[1]!.sceneId).toBeNull(); // inheritance shed
    expect(plan.staleScenes).toEqual([]); // and no banner for it
    // A heading that was ALWAYS a heading keeps its own scene.
    expect(plan.rows[0]!.sceneId).toBe(42);
  });
});

function blocksFrom(text: string): Block[] {
  const rows = linesToRows(parseFountain(text)).lines;
  rows.forEach((r, i) => { r.uuid = `u${i}`; });
  const blocks = rowsToBlocks(rows);
  blocks[0]!.sceneId = 42;
  return blocks;
}

function editorForBlocks(blocks: Block[]): EditorState {
  const { doc, entries } = blocksToDoc(blocks);
  return EditorState.create({ doc, extensions: [lineState] })
    .update({ effects: loadLines.of(entries) }).state;
}
