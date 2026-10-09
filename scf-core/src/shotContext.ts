// SPDX-License-Identifier: Apache-2.0
/**
 * shotContext.ts — the composite behind "prompt for shot 10A"
 * (docs/scf-mcp-design.md §4).
 *
 * Every member is the UNMODIFIED return of a canonical query — no
 * filtering, no merging, no re-ordering, no picking a winner. A second
 * description of what is in force at a shot is a second answer, and the
 * format has already paid for that mistake once (canonicalQueries.ts's
 * own header makes the same point about Q05/Q07).
 *
 * Three calls, not one (design doc §4.7): the frame (`shotContext`), what
 * to attach (`shotMedia`) and what is thin (`shotReadiness`). Each still
 * does the hard part, working out who is at the shot and what to ask
 * about each; together they answer what one call did, in parts a client
 * with a limit on a single result can take whole. The scene package (Q04)
 * and the brief (Q00) are their own queries and are not repeated here.
 *
 * Not a seventeenth canonical query (design doc §4.5): promote it only
 * if a second implementation needs it.
 */

import {
  resolveIdentifier, type FileLocator, type ResolutionState,
} from "./assets.ts";
import type { Row } from "./db.ts";
import { listEntities, type ListedRow } from "./listEntities.ts";
import {
  ANCHOR_TYPE_FOR_INTENT, rows, type ScfContext,
} from "./resolution.ts";
import { QUERY_PATHS } from "./queryPaths.ts";
import { byRelatedOrder } from "./relatedOrder.ts";
import { presenceAtShot, type Presence } from "./presence.ts";
import { rangeLines, type RangeVerdict } from "./lines.ts";
import {
  projectScreenplayLines, sceneScriptLines,
} from "./screenplay/sceneScript.ts";
import {
  uuidLookupForAll, type ProjectedRow, type QueryResult,
} from "./queryResult.ts";
import {
  q06Result, q07Result, q13Result, q14Result,
  type Q05Result, type Q07Result, type Q13Result, type Q14Result,
} from "./canonicalQueries.ts";

/**
 * The version the three shot calls share (design doc §4.4). 3.0 split
 * one composite into three and dropped `scene` and `brief`.
 */
export type ShotContextFormat = "3.0";

/** The frame: what is in the shot and how it reads. */
export interface ShotContext {
  contextFormat: ShotContextFormat;
  /**
   * The shot itself — size, lens, angle, movement, description, the
   * story beat it serves, its scene — exactly as `listEntities` returns
   * it. Its `scene_uuid` is what to ask Q04 (the scene package) with.
   */
  shot: ListedRow;
  /** The frame at this shot (Q07). */
  look: QueryResult<Q07Result>;
  /**
   * Who is at the shot and how they read (spec §4.6), each marked
   * recorded or inherited. `shotMedia` and `shotReadiness` follow it.
   */
  presence: ShotPresenceMember;
  /**
   * The screenplay lines the shot covers (spec §4.7), projected as Q04
   * projects the scene's screenplay. NULL when the shot records no range:
   * an unrecorded shot does not inherit its scene's lines, which would
   * hand a three-second insert the whole scene; Q04 has the scene's text.
   * Also null when the range cannot be read; the finding says why (§4.7).
   */
  lines: ProjectedRow[] | null;
  /** Physical direction (Q06), one per character SEEN at the shot. */
  physical: QueryResult<Q05Result>[];
}

/** What to attach: the media in force for what is at the shot. */
export interface ShotMedia {
  contextFormat: ShotContextFormat;
  shotUuid: string;
  /** The one subject asked about, or null for every subject at the shot. */
  subject: string | null;
  /**
   * Media in force (Q13), one per subject and intent that has something
   * to say. A result with no references and an empty trail is left out,
   * and `swept` names its intent in `empty`. A result whose trail
   * explains an absence (a binding EXCLUDED, and why) is kept: that is
   * an answer, not an empty one.
   */
  media: QueryResult<Q13Result>[];
  /**
   * Every subject the sweep considered, the intents asked for, and which
   * came back empty. A composite that returns a partial answer silently
   * is worse than one that refuses; this is how a caller sees an absence
   * rather than a gap.
   */
  swept: SweptSubject[];
  /**
   * Assets related to this SHOT or its SCENE rather than to a subject
   * in it (§8.6) — a DOP's framing plate for the scene is about the
   * scene, belongs to no character, prop or location, and the media
   * cascade starts at a subject, so nothing in `media` can reach it.
   */
  related: RelatedAsset[];
}

/** What is thin: pre-flight for everything the shot needs. */
export interface ShotReadiness {
  contextFormat: ShotContextFormat;
  shotUuid: string;
  /**
   * Pre-flight readiness (Q14), each result unmodified (design doc §4.6),
   * in this order:
   *
   *   Q07  the shot's look
   *   Q08  the scene's sound
   *   then each character at the shot, in `presence` order:
   *     Q02 and Q06  if SEEN (subject in context, which alone checks
   *                  costume; and physical direction)
   *     Q05          if they SPEAK in the shot's lines
   *   then Q05 for anyone who speaks in its lines and is not at the shot
   *
   * With no lines, every character seen or heard at the shot counts as
   * speaking. Q13 is not asked: `shotMedia` already reports what its
   * rubric would. Rubrics overlap (Q02 also asks about appearance, which
   * Q07 asks about), and a finding raised by two of them appears in both,
   * each under its own target: the composite does not merge.
   */
  readiness: QueryResult<Q14Result>[];
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
  /** `asset_relationship.order`: position among the entity's related
   *  assets (§8.6, proposal 0037). Null where none is stored. */
  order: number | null;
  notes: string | null;
  /** Derived from the identifier (§8.5); a hint, never a purpose. */
  format: string | null;
  /** §8.3's resolution state, as a Q13 reference carries it, so a
   *  storyboard that is not on disk is reported rather than handed on
   *  as if it were. `unaddressed` when the session maps no root. */
  state: ResolutionState;
  /** Why, for anything not `resolved`. For a person; never parsed. */
  detail: string | null;
  /** Read from the resolved file. Null unless `state` is `resolved`. */
  sizeBytes: number | null;
}

/**
 * Assets pointed at this shot and at its scene.
 *
 * Read from `asset_relationship`, whose `entity_id` is polymorphic on
 * `entity_type` (§12.1.2). Scene rows come first, then shot rows, each
 * in §8.6's order. Deliberately NOT a fourth binding table: a
 * binding carries precedence, baselines and filters, none of which
 * means anything for "this picture is of that scene".
 */
async function relatedAssets(
    ctx: ScfContext, shotId: number, shotUuid: string,
    sceneId: number | null, sceneUuid: string | null, locate: FileLocator,
): Promise<RelatedAsset[]> {
  if (!ctx.registry.entities.has("asset_relationship")) return [];
  const out: RelatedAsset[] = [];
  for (const [about, id, uuid] of [
    ["scene", sceneId, sceneUuid], ["shot", shotId, shotUuid],
  ] as const) {
    if (id === null || uuid === null) continue;
    const links = await rows(ctx.exec, "asset_relationship",
                             "entity_type = ? AND entity_id = ?", [about, id]);
    for (const link of links.sort(byRelatedOrder)) {
      const asset = (await rows(ctx.exec, "asset", "id = ?",
                                [link["asset_id"] ?? null]))[0];
      if (asset === undefined) continue;
      const identifier = asset["identifier"] === null
        || asset["identifier"] === undefined
        ? null : String(asset["identifier"]);
      const resolution = await resolveIdentifier(identifier, locate);
      out.push({
        about, aboutUuid: uuid,
        uuid: String(asset["uuid"] ?? ""),
        name: asset["name"] === null || asset["name"] === undefined
          ? null : String(asset["name"]),
        identifier,
        relationship: link["relationship_type"] === null
          || link["relationship_type"] === undefined
          ? null : String(link["relationship_type"]),
        order: link["order"] === null || link["order"] === undefined
          ? null : Number(link["order"]),
        notes: link["notes"] === null || link["notes"] === undefined
          ? null : String(link["notes"]),
        format: resolution.format,
        state: resolution.state,
        detail: resolution.detail,
        sizeBytes: resolution.state === "resolved"
          ? resolution.sizeBytes : null,
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
  /**
   * Intents asked for whose result had nothing to say (no references and
   * an empty trail), and so are not in `media`.
   */
  empty: string[];
  /** Why `intents` is empty, when it is. */
  note?: string;
}

/**
 * The asset intents to ask for about ONE subject: what a query path
 * declares for its kind, plus what the file actually binds to it.
 *
 * Both halves. A declared path asks for `motion` on a character with no
 * motion bundle and gets an empty answer, and that empty answer is the
 * difference between "there is no motion reference for her" and "nobody
 * asked". The second half is every intent a live binding or shot override
 * puts in force for this subject: total on any file, no per-kind list,
 * and it cannot ask for an intent the file has nothing under.
 *
 * Anchors only where the subject has neither: an anchor IS media the
 * subject has, so a subject whose only media is an anchor must still be
 * asked about, under the intents that map to its anchor type (§12.8).
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
 * rows, and the scene's subjects too unless the frame is complete.
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

/**
 * The characters who speak in a range of lines, in script order, once
 * each. Only a cue line names its character, so a line of dialogue (or a
 * parenthetical) is spoken by the nearest cue above it in the scene, which
 * may sit just outside the range: 3C opens on "Is Ada's room still—",
 * whose MARCUS cue is the line before. A cue naming no character row is
 * skipped, since a voice direction needs someone to direct.
 */
async function speakersIn(
    ctx: ScfContext, sceneId: number, range: RangeVerdict): Promise<number[]> {
  if (range.kind !== "lines") return [];
  const inRange = new Set(range.lines.map((l) => String(l["uuid"])));
  const out: number[] = [];
  let speaker: number | null = null;
  for (const l of await sceneScriptLines(ctx.exec, sceneId)) {
    const type = l["line_type"];
    if (type === "character") {
      const id = Number(l["character_id"]);
      speaker = Number.isFinite(id) && id > 0 ? id : null;
    } else if (type !== "dialogue" && type !== "parenthetical" &&
               type !== "blank") {
      speaker = null;
    }
    const speaks = type === "character" || type === "dialogue" ||
      type === "parenthetical";
    if (speaks && speaker !== null && inRange.has(String(l["uuid"])) &&
        !out.includes(speaker)) {
      out.push(speaker);
    }
  }
  return out;
}

/** The readiness list, in the order documented on `ShotReadiness`. */
async function readinessFor(
    ctx: ScfContext, presence: ShotPresenceMember, range: RangeVerdict,
    sceneUuid: string, sceneId: number,
    shotUuid: string, shotId: number): Promise<QueryResult<Q14Result>[]> {
  const out: QueryResult<Q14Result>[] = [
    await q14Result(ctx, "Q07", null, null, sceneUuid, sceneId,
                    shotUuid, shotId),
    await q14Result(ctx, "Q08", null, null, sceneUuid, sceneId, null, null),
  ];

  const characters: Array<{ id: number; uuid: string; seen: boolean }> = [];
  for (const s of presence.subjects) {
    if (s.subjectType !== "character" || s.presence === "named") continue;
    const id = (await rows(ctx.exec, "character", "uuid = ?", [s.uuid]))[0];
    if (id === undefined) continue;
    characters.push({ id: Number(id["id"]), uuid: s.uuid,
                      seen: s.presence === "seen" });
  }
  // With no lines to read, anyone seen or heard may speak.
  const speakers = range.kind === "lines"
    ? await speakersIn(ctx, sceneId, range)
    : characters.map((c) => c.id);

  for (const c of characters) {
    if (c.seen) {
      // Their rubrics take a character and a scene, not a shot, and the
      // envelope records exactly what was asked (§12.1.1).
      for (const target of ["Q02", "Q06"]) {
        out.push(await q14Result(ctx, target, c.uuid, c.id, sceneUuid,
                                 sceneId, null, null));
      }
    }
    if (speakers.includes(c.id)) {
      out.push(await q14Result(ctx, "Q05", c.uuid, c.id, sceneUuid,
                               sceneId, null, null));
    }
  }
  // Someone the lines give a voice to who is not at the shot: an
  // off-screen line the frame was not recorded with.
  for (const id of speakers) {
    if (characters.some((c) => c.id === id)) continue;
    const row = (await rows(ctx.exec, "character", "id = ?", [id]))[0];
    if (row === undefined) continue;
    out.push(await q14Result(ctx, "Q05", String(row["uuid"]), id,
                             sceneUuid, sceneId, null, null));
  }
  return out;
}

/** The shot, its scene and its listed row: what all three calls start from. */
interface ResolvedShot {
  shotRow: Record<string, unknown>;
  shotId: number;
  sceneId: number;
  sceneUuid: string;
  sceneLocationId: number | null;
  shot: ListedRow;
}

async function resolveShot(
    ctx: ScfContext, shotUuid: string): Promise<ResolvedShot> {
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
  const loc = Number(sceneRow["location_id"]);
  return { shotRow, shotId, sceneId, sceneUuid, shot,
           sceneLocationId: Number.isFinite(loc) && loc > 0 ? loc : null };
}

type Subject = { type: string; uuid: string; presence: Presence };

/**
 * Every subject at the shot: `presence`'s characters and props, then the
 * scene's location, which a shot always shares (spec §4.6).
 */
async function subjectsAt(
    ctx: ScfContext, r: ResolvedShot,
    presence: ShotPresenceMember): Promise<Subject[]> {
  const subjects: Subject[] = presence.subjects.map((s) => ({
    type: s.subjectType, uuid: s.uuid, presence: s.presence,
  }));
  if (r.sceneLocationId !== null) {
    const location = (await rows(ctx.exec, "location", "id = ?",
                                 [r.sceneLocationId]))[0];
    if (location !== undefined) {
      subjects.push({ type: "location", uuid: String(location["uuid"]),
                      presence: "seen" });
    }
  }
  return subjects;
}

/** The frame: shot, look, presence, lines and physical direction. */
export async function shotContext(
    ctx: ScfContext, shotUuid: string): Promise<ShotContext> {
  const r = await resolveShot(ctx, shotUuid);
  const look = await q07Result(ctx, r.sceneUuid, r.sceneId, shotUuid,
                               r.shotId);
  const range = await rangeLines(ctx.exec, r.sceneId,
    r.shotRow["line_start_ref"], r.shotRow["line_end_ref"]);
  const lines = range.kind === "lines"
    ? projectScreenplayLines(range.lines,
        await uuidLookupForAll(ctx.exec, ctx.registry))
    : null;
  const presence = await presenceMember(ctx, r.shotId);

  // Physical direction is for a body on screen. A heard character has
  // none to give (§4.6), and a named one is not there.
  const physical: QueryResult<Q05Result>[] = [];
  for (const subj of await subjectsAt(ctx, r, presence)) {
    if (subj.type !== "character" || subj.presence !== "seen") continue;
    const characterId = await idFor(ctx, "character", subj.uuid);
    if (characterId === null) continue;
    physical.push(await q06Result(ctx, subj.uuid, r.sceneUuid, characterId,
                                  r.sceneId));
  }
  return { contextFormat: "3.0", shot: r.shot, look, presence, lines,
           physical };
}

/** A Q13 result with nothing to say: no references and an empty trail. */
const isEmpty = (m: QueryResult<Q13Result>): boolean =>
  m.result.references.length === 0 && m.result.trail.length === 0;

/**
 * What to attach. With `subjectUuid`, only that subject is swept, so a
 * shot with many subjects can be fetched one at a time; it must be at the
 * shot. `related` is about the shot and its scene, and comes either way.
 */
export async function shotMedia(
    ctx: ScfContext, shotUuid: string,
    locate: FileLocator = NO_ROOT, rootMapped = false,
    subjectUuid: string | null = null,
): Promise<ShotMedia> {
  const r = await resolveShot(ctx, shotUuid);
  const presence = await presenceMember(ctx, r.shotId);
  let subjects = await subjectsAt(ctx, r, presence);
  if (subjectUuid !== null) {
    subjects = subjects.filter((s) => s.uuid === subjectUuid);
    if (subjects.length === 0) {
      throw new Error(`shotMedia: ${subjectUuid} is not at shot ${shotUuid}`);
    }
  }

  const media: QueryResult<Q13Result>[] = [];
  const swept: SweptSubject[] = [];
  for (const subj of subjects) {
    const subjectId = await idFor(ctx, subj.type, subj.uuid);
    if (subjectId === null) {
      swept.push({ subjectType: subj.type, uuid: subj.uuid, name: null,
                   intents: [], empty: [], note: "no row with that uuid" });
      continue;
    }
    const row = (await rows(ctx.exec, subj.type, "id = ?", [subjectId]))[0];
    const name = row?.["name"] === null || row?.["name"] === undefined
      ? null : String(row["name"]);
    if (subj.presence === "named") {
      swept.push({ subjectType: subj.type, uuid: subj.uuid, name,
                   intents: [], empty: [],
                   note: "named only: not seen or heard here" });
      continue;
    }
    const all = await intentsFor(ctx, subj.type, subjectId);
    const intents = subj.presence === "heard"
      ? all.filter((i) => HEARD_INTENTS.has(i)) : all;
    const empty: string[] = [];
    for (const intent of intents) {
      const m = await q13Result(
        ctx, subj.type, subj.uuid, subjectId, intent,
        r.sceneUuid, r.sceneId, shotUuid, r.shotId, locate, rootMapped);
      if (isEmpty(m)) empty.push(intent); else media.push(m);
    }
    swept.push({
      subjectType: subj.type, uuid: subj.uuid, name, intents, empty,
      ...(intents.length === 0
        ? { note: subj.presence === "heard"
            ? "heard only, and nothing binds voice or sound to it"
            : "nothing binds media to this subject" } : {}),
    });
  }

  const related = await relatedAssets(ctx, r.shotId, shotUuid,
                                      r.sceneId, r.sceneUuid, locate);
  return { contextFormat: "3.0", shotUuid, subject: subjectUuid, media,
           swept, related };
}

/** What is thin: the readiness list, in the order `ShotReadiness` gives. */
export async function shotReadiness(
    ctx: ScfContext, shotUuid: string): Promise<ShotReadiness> {
  const r = await resolveShot(ctx, shotUuid);
  const presence = await presenceMember(ctx, r.shotId);
  const range = await rangeLines(ctx.exec, r.sceneId,
    r.shotRow["line_start_ref"], r.shotRow["line_end_ref"]);
  const readiness = await readinessFor(
    ctx, presence, range, r.sceneUuid, r.sceneId, shotUuid, r.shotId);
  return { contextFormat: "3.0", shotUuid, readiness };
}
