// SPDX-License-Identifier: Apache-2.0
/**
 * storyStrip.ts — where each stage sits on the story strip.
 *
 * Arc stages, relationship stages and wardrobe stages are all §4.5
 * pattern 3, latest wins: a stage starts at its scene and stays in force
 * until the next stage of the same lane starts. Drawing that is the same
 * computation for every lane, so it lives here, headless and tested,
 * rather than once per tab.
 *
 * Ties follow §4.5 too: two stages keyed at one scene are resolved by
 * row id, the later row winning. The loser is still returned, marked
 * `hidden`, because a stage that can never be in force is something a
 * writer needs to see, not something the strip should silently drop.
 */

export interface StageInput {
  id: number;
  sceneId: number | null;
}

export interface PlacedStage {
  id: number;
  /** Index into the strip's scenes where the stage starts. */
  start: number;
  /** Last index it is in force at, inclusive. */
  end: number;
}

export interface StripLayout {
  placed: PlacedStage[];
  /** Keyed at the same scene as a later row, so never in force. */
  hidden: number[];
  /** Keyed at no scene, or at one the strip does not show (cut, gone). */
  unplaced: number[];
}

export function layoutStages(sceneIds: number[],
                             stages: StageInput[]): StripLayout {
  const index = new Map(sceneIds.map((id, i) => [id, i]));
  const unplaced: number[] = [];
  const atIndex = new Map<number, StageInput[]>();
  for (const s of stages) {
    const i = s.sceneId === null ? undefined : index.get(s.sceneId);
    if (i === undefined) {
      unplaced.push(s.id);
      continue;
    }
    const list = atIndex.get(i) ?? [];
    list.push(s);
    atIndex.set(i, list);
  }
  const hidden: number[] = [];
  const starts = [...atIndex.keys()].sort((a, b) => a - b);
  const placed: PlacedStage[] = starts.map((start, k) => {
    const here = (atIndex.get(start) ?? []).sort((a, b) => a.id - b.id);
    const winner = here[here.length - 1] as StageInput;
    for (const s of here.slice(0, -1)) hidden.push(s.id);
    const next = starts[k + 1];
    return { id: winner.id, start,
             end: next === undefined ? sceneIds.length - 1 : next - 1 };
  });
  return { placed, hidden: hidden.sort((a, b) => a - b),
           unplaced: unplaced.sort((a, b) => a - b) };
}

/** The stage in force at a strip index, or null before the first. */
export function stageAt(layout: StripLayout, i: number): number | null {
  return layout.placed.find((p) => i >= p.start && i <= p.end)?.id ?? null;
}
