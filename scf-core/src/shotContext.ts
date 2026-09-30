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
import {
  ANCHOR_TYPE_FOR_INTENT, rows, type ScfContext,
} from "./resolution.ts";
import { QUERY_PATHS } from "./queryPaths.ts";
import {
  q00Result, q04Result, q06Result, q07Result, q13Result, q14Result,
  type Q00Result, type Q04Result, type Q05Result, type Q07Result,
  type Q13Result, type Q14Result,
} from "./canonicalQueries.ts";

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
  /**
   * Every subject the media sweep considered and what it asked for.
   * A composite that returns a partial answer silently is worse than
   * one that refuses: this is how a caller sees that a subject was
   * swept with no intents rather than skipped by accident.
   */
  swept: SweptSubject[];
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

/** What the media sweep did about one subject. */
export interface SweptSubject {
  subjectType: string;
  uuid: string;
  name: string | null;
  /** Intents asked for, in the order Q13 was called. */
  intents: string[];
  /** Why `intents` is empty, when it is. */
  note?: string;
}

/**
 * The asset intents to ask for about ONE subject: what a query path
 * declares for its kind, plus what the file actually binds to it.
 *
 * The first version was the first half alone, derived from
 * `QUERY_PATHS`, which keys on `<subjectType>_id`. Only `character` has
 * such a path, so props and locations were swept with NO intents and
 * the composite returned a shot prompt with no location media in it,
 * silently. The subject set was never the problem — it already
 * contained them.
 *
 * The second half closes that: every intent a live binding or shot
 * override puts in force for this subject. Total on any file, no
 * per-kind list, and it cannot ask for an intent the file has nothing
 * under.
 *
 * Both halves, not the second alone. A declared path asks for `motion`
 * on a character with no motion bundle and gets an empty answer, and
 * that empty answer is the difference between "there is no motion
 * reference for her" and "nobody asked" — the distinction this whole
 * composite got wrong the first time.
 *
 * Anchors are the last addition, and only where the subject has
 * neither: an anchor IS media the subject has, so a subject whose only
 * media is an anchor must still be asked about, under the intents that
 * map to its anchor type (§12.8). A subject with bundles is not
 * widened that way — its anchors come back under the intents it is
 * already asked for.
 */
async function intentsFor(
    ctx: ScfContext, subjectType: string, subjectId: number,
): Promise<string[]> {
  const intents = new Set<string>();
  const key = `${subjectType}_id`;
  for (const path of Object.values(QUERY_PATHS)) {
    if (!path.params.includes(key)) continue;
    for (const step of path.steps) {
      if (step.intent !== undefined) intents.add(step.intent);
    }
  }

  const bundleIds: number[] = [];
  const column = `${subjectType}_id`;
  for (const [entity, ref] of [
    [`${subjectType}_asset_binding`, "bundle_id"],
    [`${subjectType}_shot_override`, "bundle_override_id"],
  ] as const) {
    if (!ctx.registry.entities.has(entity)) continue;
    for (const row of await rows(ctx.exec, entity, `${column} = ?`,
                                 [subjectId])) {
      const id = row[ref];
      if (id !== null && id !== undefined) bundleIds.push(Number(id));
    }
  }

  for (const id of new Set(bundleIds)) {
    const bundle = (await rows(ctx.exec, "bundle", "id = ?", [id]))[0];
    const intent = bundle?.["intent"];
    if (intent !== null && intent !== undefined && String(intent) !== "") {
      intents.add(String(intent));
    }
  }
  if (intents.size > 0) return [...intents];

  // Neither a declared path nor a binding: anchors are all that is left.
  const anchorTypes = new Set((await rows(
    ctx.exec, "entity_anchor", "subject_type = ? AND subject_id = ?",
    [subjectType, subjectId])).map((a) => String(a["anchor_type"] ?? "")));
  for (const [intent, anchorType] of Object.entries(ANCHOR_TYPE_FOR_INTENT)) {
    if (anchorTypes.has(anchorType)) intents.add(intent);
  }
  return [...intents];
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
  const swept: SweptSubject[] = [];
  for (const subj of subjects) {
    const subjectId = await idFor(ctx, subj.type, subj.uuid);
    if (subjectId === null) {
      swept.push({ subjectType: subj.type, uuid: subj.uuid, name: null,
                   intents: [], note: "no row with that uuid" });
      continue;
    }
    const row = (await rows(ctx.exec, subj.type, "id = ?", [subjectId]))[0];
    const name = row?.["name"] === null || row?.["name"] === undefined
      ? null : String(row["name"]);
    const intents = await intentsFor(ctx, subj.type, subjectId);
    swept.push({
      subjectType: subj.type, uuid: subj.uuid, name, intents,
      ...(intents.length === 0
        ? { note: "nothing binds media to this subject" } : {}),
    });
    for (const intent of intents) {
      media.push(await q13Result(
        ctx, subj.type, subj.uuid, subjectId, intent,
        sceneUuid, sceneId, shotUuid, shotId, locate, rootMapped));
    }
  }

  const readiness = await q14Result(
    ctx, "Q07", null, null, sceneUuid, sceneId, shotUuid, shotId);

  return { contextFormat: "1.0", brief, scene, look, physical, media,
           swept, readiness };
}
