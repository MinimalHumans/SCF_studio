/**
 * canonicalQueries.ts — normative result builders. Spec §12.2, §12.3.
 *
 * Two queries so far, chosen because they stress different machinery: if
 * one envelope and one projection rule serve both, they will probably
 * serve the other fourteen.
 *
 *   Q05 Voice direction — position pattern 2 (persistence, §4.5), a
 *       baseline that may be absent, and a merge over a JSON column.
 *   Q07 Look resolution — the direction cascade (§7): a `refines`
 *       closure, one row per entity, and a leaf that changes when a
 *       shot is supplied.
 *
 * These wrap the resolvers rather than reimplementing them. A second
 * description of "what is in force at scene 12" is a second answer, and
 * the format has already paid for that mistake once.
 */

import type { ScfContext } from "./resolution.ts";
import { resolveDescription, resolveDirection } from "./resolution.ts";
import {
  envelope, projectRow, uuidLookupFor,
  type ProjectedRow, type QueryResult,
} from "./queryResult.ts";

// ---------------------------------------------------------------------------
// Q05 — Voice direction
// ---------------------------------------------------------------------------

export interface Q05Result {
  modality: string;
  /**
   * The character's standing description. Null when none is authored —
   * a well-defined absence (§9.2), and the case the readiness report
   * exists to warn about, not an error.
   */
  baseline: ProjectedRow | null;
  /** States in force at this position, oldest first (§4.5 pattern 2). */
  states: ProjectedRow[];
  /**
   * States merged oldest-first, so a later state overrides an earlier
   * one key by key. The merged view is derived and carries no identity.
   */
  modulations: Record<string, unknown>;
  /** Beats authored for this character in this scene, in beat order. */
  beats: ProjectedRow[];
}

const STATE_REFS = {
  scene_id: "scene",
  resolved_at_scene_id: "scene",
  character_id: "character",
};

const BEAT_REFS = { scene_id: "scene", character_id: "character" };
const PROFILE_REFS = { character_id: "character" };

export async function q05Result(
    ctx: ScfContext, characterUuid: string, sceneUuid: string,
    characterId: number, sceneId: number,
): Promise<QueryResult<Q05Result>> {
  const resolved = await resolveDescription(ctx, characterId, sceneId,
                                            "vocal");
  const lookup = await uuidLookupFor(ctx.exec, ["scene", "character"]);

  return envelope("Q05", ctx.registry,
    { character: characterUuid, scene: sceneUuid },
    {
      modality: resolved.modality,
      baseline: resolved.profile === null
        ? null : projectRow(resolved.profile, PROFILE_REFS, lookup),
      states: resolved.states.map(
        (s) => projectRow(s, STATE_REFS, lookup)),
      modulations: resolved.modulations,
      beats: resolved.beats.map((b) => projectRow(b, BEAT_REFS, lookup)),
    });
}

// ---------------------------------------------------------------------------
// Q07 — Look resolution
// ---------------------------------------------------------------------------

export interface Q07Layer {
  /** The registry entity this layer came from. */
  entity: string;
  row: ProjectedRow;
}

export interface Q07Result {
  /**
   * The cascade's leaf (§7.1). Not derivable from the data — it is what
   * the query IS, and it changes when a shot is supplied.
   */
  leaf: string;
  /** Root first; the last layer is the opinion in force (§7.4). */
  layers: Q07Layer[];
}

/** §12.3.2 — the leaf depends on whether a shot was given. */
export const Q07_SCENE_LEAF = "scene_color_palette";
export const Q07_SHOT_LEAF = "shot_design";

export async function q07Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
    shotUuid: string | null, shotId: number | null,
): Promise<QueryResult<Q07Result>> {
  const leaf = shotId === null ? Q07_SCENE_LEAF : Q07_SHOT_LEAF;
  const layers = await resolveDirection(ctx, leaf, sceneId, shotId);

  // Every entity in the chain, so a layer's own references resolve.
  const entities = [...new Set(layers.map(([entity]) => entity))];
  const lookup = await uuidLookupFor(
    ctx.exec, [...entities, "scene", "shot", "project", "sequence"]);

  const refs: Record<string, string> = {
    scene_id: "scene", shot_id: "shot",
    project_id: "project", sequence_id: "sequence",
  };

  return envelope("Q07", ctx.registry,
    { scene: sceneUuid, shot: shotUuid },
    {
      leaf,
      layers: layers.map(([entity, row]) => ({
        entity, row: projectRow(row, refs, lookup),
      })),
    });
}
