/**
 * state/listOrder.ts — how a schema list decides its order.
 *
 * Pure and view-free on purpose: importing anything under ui/ pulls in
 * the store, which spawns the SQL worker, and a unit test has no
 * business doing that.
 */

import type { EntityDef } from "@scf-core/registry.ts";

export const STORY_ORDERED: Record<string,
    { sceneRef: string; fallbacks: string[] }> = {
  scene: { sceneRef: "id", fallbacks: ["t.scene_number"] },
  act: { sceneRef: "start_scene_id", fallbacks: ["t.act_number"] },
  sequence: {
    sceneRef: "start_scene_id", fallbacks: ["t.sequence_number"],
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
