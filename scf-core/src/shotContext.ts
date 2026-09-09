// SPDX-License-Identifier: Apache-2.0
/**
 * shotContext.ts — the composite behind "prompt for shot 10A"
 * (spec/scf-mcp-design.md §4).
 *
 * Every member is the UNMODIFIED return of a canonical query — no
 * filtering, no merging, no re-ordering, no picking a winner. A second
 * description of what is in force at a shot is a second answer, and the
 * format has already paid for that mistake once (canonicalQueries.ts's
 * own header makes the same point about Q05/Q07).
 *
 * Not a seventeenth canonical query (design doc §4.5): promote it only
 * if a second implementation needs it.
 */

import type { FileLocator } from "./assets.ts";
import type { QueryResult } from "./queryResult.ts";
import { rows, type ScfContext } from "./resolution.ts";
import {
  q00Result, q04Result, q06Result, q07Result, q13Result, q14Result,
  type Q00Result, type Q04Result, type Q05Result, type Q07Result,
  type Q13Result, type Q14Result,
} from "./canonicalQueries.ts";
import { QUERY_PATHS } from "./queryPaths.ts";

export interface ShotContext {
  contextFormat: "1.0";
  /** Project register (Q00). */
  brief: QueryResult<Q00Result>;
  /** The scene, its cast, its text (Q04). */
  scene: QueryResult<Q04Result>;
  /** The frame at this shot (Q07). */
  look: QueryResult<Q07Result>;
  /** Physical direction (Q06), one per character in the scene. */
  physical: QueryResult<Q05Result>[];
  /** Media in force (Q13), one per subject x applicable intent. */
  media: QueryResult<Q13Result>[];
  /** Pre-flight readiness (Q14) for the shot's own look. */
  readiness: QueryResult<Q14Result>;
}

/** Resolves nothing — the state of a `.scf` opened on its own (§0.3). */
const NO_ROOT: FileLocator = async () => undefined;

async function idFor(
    ctx: ScfContext, entity: string, uuid: string): Promise<number | null> {
  const row = (await rows(ctx.exec, entity, "uuid = ?", [uuid]))[0];
  return row === undefined ? null : Number(row["id"]);
}

/**
 * The asset intents that apply to a subject type, derived from
 * `QUERY_PATHS` rather than hard-coded (design doc §4.2): every
 * `step.intent` on a query path whose params key on `<subjectType>_id`.
 * Today that is Q02/Q05/Q06 for `character` (visual_identity,
 * voice_identity, motion); `prop`/`location` have no such path yet and
 * so correctly yield no intents, not a hard-coded guess.
 */
function intentsFor(subjectType: string): string[] {
  const key = `${subjectType}_id`;
  const found = new Set<string>();
  for (const path of Object.values(QUERY_PATHS)) {
    if (!path.params.includes(key)) continue;
    for (const step of path.steps) {
      if (step.intent !== undefined) found.add(step.intent);
    }
  }
  return [...found];
}

interface Subject { type: string; uuid: string }

/**
 * Who is in the scene (design doc §4.2). There is no shot-level cast in
 * the registry — no `shot_character` junction exists, only
 * `scene_character` — so "in frame" means Q04's scene-level cast, props
 * and location; that is the only registry-derivable notion of presence.
 */
function subjectsOf(scene: Q04Result): Subject[] {
  const subjects: Subject[] = [];
  for (const c of scene.cast) {
    if (c.uuid !== null) subjects.push({ type: "character", uuid: c.uuid });
  }
  for (const p of scene.props) {
    if (p.uuid !== null) subjects.push({ type: "prop", uuid: p.uuid });
  }
  if (scene.location !== null && scene.location.uuid !== null) {
    subjects.push({ type: "location", uuid: scene.location.uuid });
  }
  return subjects;
}

export async function shotContext(
    ctx: ScfContext, shotUuid: string,
    locate: FileLocator = NO_ROOT, rootMapped = false,
): Promise<ShotContext> {
  const shotRow = (await rows(ctx.exec, "shot", "uuid = ?", [shotUuid]))[0];
  if (shotRow === undefined) {
    throw new Error(`shotContext: no shot with uuid ${shotUuid}`);
  }
  const shotId = Number(shotRow["id"]);
  const sceneId = Number(shotRow["scene_id"]);
  const sceneRow = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0];
  if (sceneRow === undefined) {
    throw new Error(
      `shotContext: shot ${shotUuid} has no resolvable scene`);
  }
  const sceneUuid = String(sceneRow["uuid"]);

  const brief = await q00Result(ctx);
  const scene = await q04Result(ctx, sceneUuid, sceneId);
  const look = await q07Result(ctx, sceneUuid, sceneId, shotUuid, shotId);

  const subjects = subjectsOf(scene.result);

  const physical: QueryResult<Q05Result>[] = [];
  for (const subj of subjects) {
    if (subj.type !== "character") continue;
    const characterId = await idFor(ctx, "character", subj.uuid);
    if (characterId === null) continue;
    physical.push(
      await q06Result(ctx, subj.uuid, sceneUuid, characterId, sceneId));
  }

  const media: QueryResult<Q13Result>[] = [];
  for (const subj of subjects) {
    const intents = intentsFor(subj.type);
    if (intents.length === 0) continue;
    const subjectId = await idFor(ctx, subj.type, subj.uuid);
    if (subjectId === null) continue;
    for (const intent of intents) {
      media.push(await q13Result(
        ctx, subj.type, subj.uuid, subjectId, intent,
        sceneUuid, sceneId, shotUuid, shotId, locate, rootMapped));
    }
  }

  const readiness = await q14Result(
    ctx, "Q07", null, null, sceneUuid, sceneId, shotUuid, shotId);

  return { contextFormat: "1.0", brief, scene, look, physical, media,
           readiness };
}
