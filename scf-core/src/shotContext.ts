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
import { listEntities, type ListedRow } from "./listEntities.ts";
import {
  ANCHOR_TYPE_FOR_INTENT, rows, type ScfContext,
} from "./resolution.ts";
import { QUERY_PATHS } from "./queryPaths.ts";
import { presenceAtShot, type Presence } from "./presence.ts";
import { rangeLines } from "./lines.ts";
import { projectScreenplayLines } from "./screenplay/sceneScript.ts";
import {
  uuidLookupForAll, type ProjectedRow, type QueryResult,
} from "./queryResult.ts";
import {
  q00Result, q04Result, q06Result, q07Result, q13Result, q14Result,
  type Q00Result, type Q04Result, type Q05Result, type Q07Result,
  type Q13Result, type Q14Result,
} from "./canonicalQueries.ts";

export interface ShotContext {
  contextFormat: "1.0";
  /**
   * The shot itself — size, lens, angle, movement, description, the
   * story beat it serves — exactly as `listEntities` returns it. No
   * canonical query is scoped to a shot's own row, so the members below
   * all describe what surrounds the shot; without this a caller had to
   * make a second call for the framing it was writing a prompt about.
   */
  shot: ListedRow;
  /** Project register (Q00). */
  brief: QueryResult<Q00Result>;
  /** The scene, its cast, its text (Q04). */
  scene: QueryResult<Q04Result>;
  /** The frame at this shot (Q07). */
  look: QueryResult<Q07Result>;
  /**
   * Who is at the shot and how they read (spec §4.6), each marked
   * recorded or inherited. The sweeps below follow it.
   */
  presence: ShotPresenceMember;
  /**
   * The screenplay lines the shot covers (spec §4.7), projected as Q04
   * projects the scene's screenplay. NULL when the shot records no range:
   * an unrecorded shot does not inherit its scene's lines, which would
   * hand a three-second insert the whole scene. The scene's screenplay is
   * in `scene` for a caller that wants it. Also null when the range cannot
   * be read; the finding says why (§4.7).
   */
  lines: ProjectedRow[] | null;
  /** Physical direction (Q06), one per character SEEN at the shot. */
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
  /**
   * Assets related to this SHOT or its SCENE rather than to a subject
   * in it (§8.6) — a DOP's framing plate for the scene is about the
   * scene, belongs to no character, prop or location, and the media
   * cascade starts at a subject, so nothing in `media` can reach it.
   */
  related: RelatedAsset[];
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

/** An asset the file relates to this shot or its scene. */
export interface RelatedAsset {
  /** `scene` or `shot` — what the asset is about. */
  about: string;
  /** That row's uuid. */
  aboutUuid: string;
  uuid: string;
  name: string | null;
  identifier: string | null;
  /** `asset_relationship.relationship_type`, as stored. */
  relationship: string | null;
  notes: string | null;
}

/**
 * Assets pointed at this shot and at its scene.
 *
 * Read from `asset_relationship`, whose `entity_id` is polymorphic on
 * `entity_type` (§12.1.2). Deliberately NOT a fourth binding table: a
 * binding carries precedence, baselines and filters, none of which
 * means anything for "this picture is of that scene".
 */
async function relatedAssets(
    ctx: ScfContext, shotId: number, shotUuid: string,
    sceneId: number | null, sceneUuid: string | null,
): Promise<RelatedAsset[]> {
  if (!ctx.registry.entities.has("asset_relationship")) return [];
  const out: RelatedAsset[] = [];
  for (const [about, id, uuid] of [
    ["scene", sceneId, sceneUuid], ["shot", shotId, shotUuid],
  ] as const) {
    if (id === null || uuid === null) continue;
    for (const link of await rows(
      ctx.exec, "asset_relationship",
      "entity_type = ? AND entity_id = ?", [about, id])) {
      const asset = (await rows(ctx.exec, "asset", "id = ?",
                                [link["asset_id"] ?? null]))[0];
      if (asset === undefined) continue;
      out.push({
        about, aboutUuid: uuid,
        uuid: String(asset["uuid"] ?? ""),
        name: asset["name"] === null || asset["name"] === undefined
          ? null : String(asset["name"]),
        identifier: asset["identifier"] === null
          || asset["identifier"] === undefined
          ? null : String(asset["identifier"]),
        relationship: link["relationship_type"] === null
          || link["relationship_type"] === undefined
          ? null : String(link["relationship_type"]),
        notes: link["notes"] === null || link["notes"] === undefined
          ? null : String(link["notes"]),
      });
    }
  }
  return out;
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

/** One subject at the shot, portably (no row ids), spec §4.6. */
export interface PresentSubject {
  subjectType: string;
  uuid: string;
  name: string | null;
  presence: Presence;
  framing: string | null;
  facing: string | null;
  focus: string | null;
  /** `recorded` by a shot row, or `inherited` from the scene. */
  source: "recorded" | "inherited";
}

export interface ShotPresenceMember {
  /** `shot.presence_complete`: the recorded subjects are the whole frame. */
  complete: boolean;
  subjects: PresentSubject[];
}

/**
 * The intents a subject is asked for, given how it is at the shot. A
 * heard subject has a voice and a sound and no look; a named one has
 * nothing to put in a prompt.
 */
const HEARD_INTENTS = new Set(["voice_identity", "acoustic"]);

/**
 * Who is at the shot (spec §4.6), from `presenceAtShot`: the shot's
 * rows, and the scene's subjects too unless the frame is complete. The
 * location is always its scene's (§4.6: a new place is a new scene),
 * so it is the one subject that never comes from a shot row.
 */
async function presenceMember(
    ctx: ScfContext, shotId: number): Promise<ShotPresenceMember> {
  const at = await presenceAtShot(ctx, shotId);
  const subjects: PresentSubject[] = [];
  for (const s of at?.subjects ?? []) {
    const row = (await rows(ctx.exec, s.subjectType, "id = ?", [s.id]))[0];
    if (row === undefined) continue;
    subjects.push({
      subjectType: s.subjectType,
      uuid: String(row["uuid"] ?? ""),
      name: row["name"] === null || row["name"] === undefined
        ? null : String(row["name"]),
      presence: s.presence, framing: s.framing, facing: s.facing,
      focus: s.focus, source: s.source,
    });
  }
  return { complete: at?.complete ?? false, subjects };
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

  // The same projection `list` returns, found rather than rebuilt, so the
  // two can never describe one shot differently.
  const shot = (await listEntities(ctx, "shot",
    { field: "scene_id", uuid: sceneUuid })).find((s) => s.uuid === shotUuid);
  if (shot === undefined) {
    throw new Error(`shotContext: shot ${shotUuid} is not listed in its ` +
                    `scene (is it cut?)`);
  }

  const brief = await q00Result(ctx);
  const scene = await q04Result(ctx, sceneUuid, sceneId);
  const look = await q07Result(ctx, sceneUuid, sceneId, shotUuid, shotId);

  const range = await rangeLines(ctx.exec, sceneId,
    shotRow["line_start_ref"], shotRow["line_end_ref"]);
  const lines = range.kind === "lines"
    ? projectScreenplayLines(range.lines,
        await uuidLookupForAll(ctx.exec, ctx.registry))
    : null;

  const presence = await presenceMember(ctx, shotId);
  const subjects: Array<{ type: string; uuid: string; presence: Presence }> =
    presence.subjects.map((s) => ({
      type: s.subjectType, uuid: s.uuid, presence: s.presence,
    }));
  const location = scene.result.location;
  if (location !== null && location.uuid !== null) {
    subjects.push({ type: "location", uuid: location.uuid, presence: "seen" });
  }

  // Physical direction is for a body on screen. A heard character has
  // none to give (§4.6), and a named one is not there.
  const physical: QueryResult<Q05Result>[] = [];
  for (const subj of subjects) {
    if (subj.type !== "character" || subj.presence !== "seen") continue;
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
    if (subj.presence === "named") {
      swept.push({ subjectType: subj.type, uuid: subj.uuid, name,
                   intents: [], note: "named only: not seen or heard here" });
      continue;
    }
    const all = await intentsFor(ctx, subj.type, subjectId);
    const intents = subj.presence === "heard"
      ? all.filter((i) => HEARD_INTENTS.has(i)) : all;
    swept.push({
      subjectType: subj.type, uuid: subj.uuid, name, intents,
      ...(intents.length === 0
        ? { note: subj.presence === "heard"
            ? "heard only, and nothing binds voice or sound to it"
            : "nothing binds media to this subject" } : {}),
    });
    for (const intent of intents) {
      media.push(await q13Result(
        ctx, subj.type, subj.uuid, subjectId, intent,
        sceneUuid, sceneId, shotUuid, shotId, locate, rootMapped));
    }
  }

  const readiness = await q14Result(
    ctx, "Q07", null, null, sceneUuid, sceneId, shotUuid, shotId);

  const related = await relatedAssets(ctx, shotId, shotUuid,
                                      sceneId, sceneUuid);

  return { contextFormat: "1.0", shot, brief, scene, look, presence, lines,
           physical, media,
           swept, related, readiness };
}
