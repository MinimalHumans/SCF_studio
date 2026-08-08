import { describe, expect, it } from "vitest";
import {
  blockOfLine, planSceneMove, sceneBlocks,
} from "../src/editor/sceneMove.ts";
import type { BlockType, LineEntry } from "../src/editor/lineState.ts";

/** A tiny script: preamble, then three scenes. */
const SCRIPT: Array<[BlockType, string]> = [
  ["action", "FADE IN:"],
  ["heading", "INT. KITCHEN - DAY"],
  ["action", "She cooks."],
  ["heading", "INT. MOON BASE - DAY"],
  ["character", "ALEXIS"],
  ["dialogue", "Dust everywhere."],
  ["heading", "EXT. RIDGE - NIGHT"],
  ["action", "Wind."],
];

const entries: LineEntry[] = SCRIPT.map(([type], i) =>
  ({ id: `id${String(i)}`, type }));
const lines: string[] = SCRIPT.map(([, text]) => text);

describe("sceneBlocks", () => {
  it("spans each heading to the next, ignoring the preamble", () => {
    expect(sceneBlocks(entries)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 7 },
    ]);
  });

  it("is empty for a script with no headings", () => {
    expect(sceneBlocks([{ type: "action" }, { type: "action" }]))
      .toEqual([]);
  });

  it("maps a line back to its block, preamble as -1", () => {
    expect(blockOfLine(entries, 0)).toBe(-1);
    expect(blockOfLine(entries, 2)).toBe(0);
    expect(blockOfLine(entries, 5)).toBe(1);
    expect(blockOfLine(entries, 7)).toBe(2);
  });
});

describe("planSceneMove", () => {
  it("moves a scene later, taking its whole block", () => {
    // Chris's case: scene 2 (Moon Base) moved to the end.
    const plan = planSceneMove(lines, entries, 1, 3);
    expect(plan).not.toBeNull();
    expect(plan!.doc.split("\n")).toEqual([
      "FADE IN:",
      "INT. KITCHEN - DAY",
      "She cooks.",
      "EXT. RIDGE - NIGHT",
      "Wind.",
      "INT. MOON BASE - DAY",
      "ALEXIS",
      "Dust everywhere.",
    ]);
    // Identity travels with the text — nothing is minted, nothing dies,
    // so the scene entity and everything hanging off it is untouched.
    expect(plan!.entries.map((e) => e.id)).toEqual([
      "id0", "id1", "id2", "id6", "id7", "id3", "id4", "id5",
    ]);
    expect(plan!.entries).toHaveLength(lines.length);
    expect(plan!.headingAt).toBe(5);
  });

  it("moves a scene earlier", () => {
    const plan = planSceneMove(lines, entries, 2, 0);
    expect(plan!.doc.split("\n")).toEqual([
      "FADE IN:",
      "EXT. RIDGE - NIGHT",
      "Wind.",
      "INT. KITCHEN - DAY",
      "She cooks.",
      "INT. MOON BASE - DAY",
      "ALEXIS",
      "Dust everywhere.",
    ]);
    expect(plan!.headingAt).toBe(1);
  });

  it("keeps entries aligned with lines in every direction", () => {
    for (let from = 0; from < 3; from++) {
      for (let before = 0; before <= 3; before++) {
        const plan = planSceneMove(lines, entries, from, before);
        if (plan === null) continue;
        expect(plan.entries).toHaveLength(plan.doc.split("\n").length);
        expect([...plan.entries].map((e) => e.id).sort())
          .toEqual([...entries].map((e) => e.id).sort());
      }
    }
  });

  it("never moves a block above the preamble", () => {
    const plan = planSceneMove(lines, entries, 2, 0);
    expect(plan!.doc.split("\n")[0]).toBe("FADE IN:");
  });

  it("reports no-ops rather than churning a write", () => {
    expect(planSceneMove(lines, entries, 1, 1)).toBeNull();
    expect(planSceneMove(lines, entries, 1, 2)).toBeNull();
    expect(planSceneMove(lines, entries, 9, 0)).toBeNull();
    expect(planSceneMove(lines, entries, 0, 9)).toBeNull();
  });
});
