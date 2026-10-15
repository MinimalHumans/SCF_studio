// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import type { Row } from "@scf-core/db.ts";
import {
  boardAspect, buildBoard, DEFAULT_BOARD_OPTIONS, parseAspect, step,
  withBoardDefaults,
} from "../src/state/storyboard.ts";

const scenes: Row[] = [
  { id: 2, scene_number: "2", name: "INT. ROOM - DAY" },
  { id: 1, scene_number: "1", name: "EXT. ROAD - DAY" },
];
const beats: Row[] = [
  { id: 10, scene_id: 2, beat_order: 1, name: "Beat A", description: "Wakes." },
];
const shots: Row[] = [
  { id: 1, scene_id: 2, story_beat_id: 10, shot_order: 2, shot_number: "2B" },
  { id: 2, scene_id: 2, story_beat_id: null, shot_order: 1, shot_number: "2A" },
  { id: 3, scene_id: 1, story_beat_id: null, shot_order: 1, shot_number: "1A" },
  { id: 4, scene_id: 1, story_beat_id: null, shot_order: 2, shot_number: "1B",
    lifecycle_status: "cut" },
];
const frameOf = new Map([[1, "@root/b.png"], [3, "@root/a.png"]]);
const opts = { scope: "all", groupByBeat: false, includeCut: false,
               showUnboarded: true };

describe("the board's order", () => {
  test("story order, shot order, numbered across the whole board", () => {
    const { frames } = buildBoard(scenes, beats, shots, frameOf, opts);
    expect(frames.map((f) => [f.index, f.shot["shot_number"]]))
      .toEqual([[0, "2A"], [1, "2B"], [2, "1A"]]);
  });

  test("unboarded shots can be left out, and their scenes with them", () => {
    const { frames, scenes: s } = buildBoard(scenes, beats, shots,
      new Map([[1, "@root/b.png"]]), { ...opts, showUnboarded: false });
    expect(frames.map((f) => f.shot["shot_number"])).toEqual(["2B"]);
    expect(s.map((x) => x.scene["id"])).toEqual([2]);
    // Re-numbered after the filter, so the lightbox has no gaps.
    expect(frames[0]!.index).toBe(0);
  });

  test("grouped by beat, the beat travels with the frame", () => {
    const { frames } = buildBoard(scenes, beats, shots, frameOf,
                                  { ...opts, groupByBeat: true });
    const twoB = frames.find((f) => f.shot["shot_number"] === "2B")!;
    expect(twoB.beatLetter).toBe("A");
    expect(twoB.identifier).toBe("@root/b.png");
  });

  test("cut shots only when asked", () => {
    const { frames } = buildBoard(scenes, beats, shots, frameOf,
                                  { ...opts, includeCut: true });
    expect(frames.map((f) => f.shot["shot_number"])).toContain("1B");
  });
});

describe("aspect ratios as people write them", () => {
  test("parses the common forms", () => {
    expect(parseAspect("16:9")).toBeCloseTo(1.778, 3);
    expect(parseAspect("2.39:1")).toBeCloseTo(2.39);
    expect(parseAspect("1.85")).toBeCloseTo(1.85);
    expect(parseAspect("2.35:1 (scope)")).toBeCloseTo(2.35);
    expect(parseAspect("1920x1080")).toBeCloseTo(1.778, 3);
    expect(parseAspect("scope")).toBeNull();
    expect(parseAspect("35")).toBeNull();
    expect(parseAspect(null)).toBeNull();
  });

  test("the project's ratio unless one is chosen, else 16:9", () => {
    expect(boardAspect("project", "2.35:1 (scope)")).toBeCloseTo(2.35);
    expect(boardAspect("project", null)).toBeCloseTo(16 / 9);
    expect(boardAspect("4:3", "2.35:1")).toBeCloseTo(4 / 3);
  });
});

describe("the viewer", () => {
  test("stops at the ends rather than wrapping", () => {
    expect(step(0, -1, 5)).toBe(0);
    expect(step(4, 1, 5)).toBe(4);
    expect(step(2, 1, 5)).toBe(3);
    expect(step(0, 1, 0)).toBe(0);
  });

  test("remembered options are repaired", () => {
    expect(withBoardDefaults({ tab: "Nope", size: "l" }))
      .toEqual({ ...DEFAULT_BOARD_OPTIONS, size: "l" });
    expect(withBoardDefaults(null)).toEqual(DEFAULT_BOARD_OPTIONS);
  });
});
