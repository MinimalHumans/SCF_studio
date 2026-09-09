// SPDX-License-Identifier: Apache-2.0
/**
 * state/listOrder.ts — how a schema list decides its order.
 *
 * Pure and view-free on purpose: importing anything under ui/ pulls in
 * the store, which spawns the SQL worker, and a unit test has no
 * business doing that.
 */

import { q } from "@scf-core/db.ts";
import type { EntityDef } from "@scf-core/registry.ts";

export const STORY_ORDERED: Record<string,
    { sceneRef: string; fallbacks: string[]; from?: string }> = {
  scene: { sceneRef: "id", fallbacks: ["t.scene_number"] },
  act: { sceneRef: "start_scene_id", fallbacks: ["t.act_number"] },
  sequence: {
    sceneRef: "start_scene_id", fallbacks: ["t.sequence_number"],
  },
  /**
   * A staging beat is the one row that sits in a scene without holding
   * a reference to one. It hangs off a `scene_blocking` OR an
   * `action_sequence` — one or the other, never both — and the scene is
   * on the parent, so `sceneRefFor` finds nothing and the list fell back
   * to A-Z.
   *
   * That reads badly because the names repeat by design: "Positions
   * established." appears once per blocking, so alphabetical interleaves
   * three scenes into a list where no row can be told from another.
   *
   * The scene is derived in a subquery rather than joined in the order
   * clause, so `storyOrder` below sees an ordinary `scene_id` column and
   * one rule still covers every list. Parent before `beat_order` in the
   * fallbacks: two blockings in one scene both start at beat 1, and
   * without it their beats interleave.
   */
  staging_beat: {
    from:
      "(SELECT x.*, COALESCE(" +
      "(SELECT bl.scene_id FROM scene_blocking bl" +
      " WHERE bl.id = x.scene_blocking_id), " +
      "(SELECT a.scene_id FROM action_sequence a" +
      " WHERE a.id = x.action_sequence_id)) AS scene_id " +
      "FROM staging_beat x)",
    sceneRef: "scene_id",
    fallbacks: ["t.scene_blocking_id", "t.action_sequence_id",
                "t.beat_order"],
  },
};

/**
 * Which of an entity's scene references is the one it SITS at.
 *
 * Several rows hold more than one — a binding has a start and an end, a
 * performance state has the scene it began in and the scene it resolved
 * in. The row belongs where it starts, so the preference is explicit
 * rather than "first field wins", which would sort bindings by their end
 * scene the day someone reorders the field list.
 */
const SCENE_REF_PREFERENCE = [
  "scene_id", "start_scene_id", "scene_range_start_id",
  "first_appearance_scene_id",
];

export function sceneRefFor(edef: EntityDef): string | undefined {
  const refs = edef.fields
    .filter((f) => f.referenceEntity === "scene")
    .map((f) => f.name);
  const preferred = SCENE_REF_PREFERENCE.find((n) => refs.includes(n));
  // Never an _end_id: a range's end is where the row stops applying.
  return preferred ?? refs.find((n) => !n.endsWith("_end_id"));
}

export const ORDER_FALLBACKS = ["beat_order", "shot_order", "sort_order"];

/**
 * What a list reads FROM, aliased `t` by the caller.
 *
 * A subquery where the scene has to be derived, the table itself
 * otherwise. Both list branches use it, not just the story-ordered one:
 * the A-Z list shows the scene beside each row and needs the same
 * column to do it.
 */
export function listTable(entity: string): string {
  return STORY_ORDERED[entity]?.from ?? q(entity);
}
