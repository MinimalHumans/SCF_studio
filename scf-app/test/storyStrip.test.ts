// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { layoutStages, stageAt } from "../src/state/storyStrip.ts";

// Scenes 10, 20, 30, 40, 50 in story order — ids deliberately not
// indexes, so a test that confuses the two fails.
const scenes = [10, 20, 30, 40, 50];

describe("where a stage is in force (§4.5, latest wins)", () => {
  test("from its scene to the scene before the next stage", () => {
    const l = layoutStages(scenes, [
      { id: 1, sceneId: 10 }, { id: 2, sceneId: 40 }]);
    expect(l.placed).toEqual([
      { id: 1, start: 0, end: 2 }, { id: 2, start: 3, end: 4 }]);
    expect(stageAt(l, 2)).toBe(1);
    expect(stageAt(l, 3)).toBe(2);
  });

  test("by story order, not by the order rows were written", () => {
    const l = layoutStages(scenes, [
      { id: 7, sceneId: 50 }, { id: 3, sceneId: 20 }]);
    expect(l.placed.map((p) => p.id)).toEqual([3, 7]);
  });

  test("nothing is in force before the first stage", () => {
    const l = layoutStages(scenes, [{ id: 1, sceneId: 30 }]);
    expect(stageAt(l, 0)).toBeNull();
    expect(stageAt(l, 4)).toBe(1);
  });

  test("a tie at one scene goes to the later row; the other is named",
       () => {
    const l = layoutStages(scenes, [
      { id: 5, sceneId: 20 }, { id: 2, sceneId: 20 }]);
    expect(l.placed).toEqual([{ id: 5, start: 1, end: 4 }]);
    expect(l.hidden).toEqual([2]);
  });

  test("a stage at no scene, or at one not on the strip, is unplaced",
       () => {
    const l = layoutStages(scenes, [
      { id: 1, sceneId: null }, { id: 2, sceneId: 99 },
      { id: 3, sceneId: 10 }]);
    expect(l.unplaced).toEqual([1, 2]);
    expect(l.placed).toEqual([{ id: 3, start: 0, end: 4 }]);
  });
});
