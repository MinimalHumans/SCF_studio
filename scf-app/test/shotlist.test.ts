// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import type { Row } from "@scf-core/db.ts";
import {
  actionText, beatBanner, buildSheets, DEFAULT_OPTIONS, runningTime,
  seconds, shortAngle, shortSize, sizeLegend, withDefaults,
} from "../src/state/shotlist.ts";

const scenes: Row[] = [
  { id: 2, scene_number: "2", name: "INT. ROOM - DAY" },
  { id: 1, scene_number: "1", name: "EXT. ROAD - DAY" },
  { id: 3, scene_number: "3", name: "EXT. FIELD - DUSK" },
];
const beats: Row[] = [
  { id: 11, scene_id: 2, beat_order: 2, name: "Beat B", description: "Leaves." },
  { id: 10, scene_id: 2, beat_order: 1, name: "Waking", description: "Wakes up." },
];
const shots: Row[] = [
  { id: 1, scene_id: 2, story_beat_id: 11, shot_order: 3, shot_number: "2C",
    duration_seconds: 4 },
  { id: 2, scene_id: 2, story_beat_id: 10, shot_order: 2, shot_number: "2B",
    duration_seconds: 3 },
  { id: 3, scene_id: 2, story_beat_id: null, shot_order: 1, shot_number: "2A",
    duration_seconds: null },
  { id: 4, scene_id: 1, story_beat_id: null, shot_order: 1, shot_number: "1A",
    lifecycle_status: "cut", duration_seconds: 5 },
];

const opts = { scope: "all", groupByBeat: true, includeCut: false };

describe("which scenes and shots print", () => {
  test("scenes keep the given order and empty scenes are left out", () => {
    const sheets = buildSheets(scenes, beats, shots, opts);
    // Scene 1's only shot is cut, scene 3 has none.
    expect(sheets.map((s) => s.scene["id"])).toEqual([2]);
  });

  test("cut shots print only when asked", () => {
    const sheets = buildSheets(scenes, beats, shots,
                               { ...opts, includeCut: true });
    expect(sheets.map((s) => s.scene["id"])).toEqual([2, 1]);
  });

  test("one scene in scope prints only that scene", () => {
    const sheets = buildSheets(scenes, beats, shots,
                               { ...opts, scope: "1", includeCut: true });
    expect(sheets.map((s) => s.scene["id"])).toEqual([1]);
  });

  test("loose shots first, then beats in beat order, lettered", () => {
    const [sheet] = buildSheets(scenes, beats, shots, opts);
    expect(sheet!.groups.map((g) => [g.letter,
      g.shots.map((s) => s["shot_number"])]))
      .toEqual([[null, ["2A"]], ["A", ["2B"]], ["B", ["2C"]]]);
  });

  test("ungrouped is one list in shot order", () => {
    const [sheet] = buildSheets(scenes, beats, shots,
                                { ...opts, groupByBeat: false });
    expect(sheet!.groups).toHaveLength(1);
    expect(sheet!.groups[0]!.shots.map((s) => s["shot_number"]))
      .toEqual(["2A", "2B", "2C"]);
  });

  test("running time sums what is known and says when it is partial", () => {
    const [sheet] = buildSheets(scenes, beats, shots, opts);
    expect(sheet!.seconds).toBe(7);
    expect(sheet!.allTimed).toBe(false);
  });
});

describe("what the cells say", () => {
  test("sizes shorten the way a camera report writes them", () => {
    expect(shortSize("extreme close-up")).toBe("ECU");
    expect(shortSize("Medium_Close_Up")).toBe("MCU");
    expect(shortSize("medium wide")).toBe("MW");
    expect(shortSize("extreme wide")).toBe("EWS");
    // A vocabulary of the writer's own prints as written.
    expect(shortSize("hero dolly")).toBe("Hero dolly");
    expect(shortSize(null)).toBe("");
  });

  test("angles keep their words", () => {
    expect(shortAngle("eye level")).toBe("Eye level");
    expect(shortAngle("low angle")).toBe("Low");
    expect(shortAngle("point of view")).toBe("POV");
  });

  test("the legend lists only the short forms used, in size order", () => {
    expect(sizeLegend(["MW", "ECU", "MW", "Hero"]))
      .toEqual([["ECU", "extreme close-up"], ["MW", "medium wide"]]);
  });

  test("seconds and running time", () => {
    expect(seconds(6)).toBe("6");
    expect(seconds(2.5)).toBe("2.5");
    expect(seconds(null)).toBe("");
    expect(runningTime(43)).toBe("43 s");
    expect(runningTime(125)).toBe("2 min 05 s");
  });

  test("a beat's default name is not repeated in its banner", () => {
    expect(beatBanner({ beat: beats[0]!, letter: "B", shots: [] }))
      .toBe("Beat B — Leaves.");
    expect(beatBanner({ beat: beats[1]!, letter: "A", shots: [] }))
      .toBe("Beat A — Waking. Wakes up.");
  });

  test("action prefers the description and does not repeat the title", () => {
    const shot = { name: "The ridge road", description: "The ridge road, a figure." };
    expect(actionText(shot, false)).toBe("The ridge road, a figure.");
    expect(actionText({ name: "Push in", description: "On Eleanor." }, false))
      .toBe("Push in. On Eleanor.");
    expect(actionText({ name: "Push in", description: "On Eleanor." }, true))
      .toBe("On Eleanor.");
    expect(actionText({ name: "Push in", description: null }, false))
      .toBe("Push in");
  });
});

describe("remembered options", () => {
  test("a column added later appears with its default", () => {
    const saved = { orientation: "portrait", columns: { frame: false } };
    const o = withDefaults(saved);
    expect(o.orientation).toBe("portrait");
    expect(o.columns.frame).toBe(false);
    expect(o.columns.done).toBe(DEFAULT_OPTIONS.columns.done);
  });

  test("garbage falls back to the defaults", () => {
    expect(withDefaults("nope")).toEqual(DEFAULT_OPTIONS);
  });
});
