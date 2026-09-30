// SPDX-License-Identifier: Apache-2.0
/**
 * presence.ts — who is at a position, and whether they are seen, heard or
 * only named. Spec §2.4.1 (at a scene) and §4.6 (at a shot).
 *
 * The one implementation of the rule. Q03, Q04, Q12, Q14, the shot
 * composite and the findings all ask here, so no two of them can
 * disagree about whether a character is on screen.
 *
 * A value's presence is read from the registry's `optionPresence`, never
 * from its name: `mentioned` meaning "not on screen" is a fact the format
 * states, not one a reader infers.
 */

import type { Presence, Registry } from "./registry.ts";
import { rows, type ScfContext } from "./resolution.ts";

export type { Presence } from "./registry.ts";

/** The subject kinds presence is recorded for, with their link tables. */
const KINDS = [
  { subject: "character", sceneLink: "scene_character",
    sceneField: "role_in_scene", shotLink: "shot_character" },
  { subject: "prop", sceneLink: "scene_prop",
    sceneField: "significance", shotLink: "shot_prop" },
] as const;

export type PresenceSubject = (typeof KINDS)[number]["subject"];

/**
 * The presence a stored vocabulary value gives, §2.4.1.
 *
 * Unset is `seen`, the reading every file written before presence was
 * defined assumes. A value the vocabulary does not list is also `seen`:
 * §9.2 wants an answer, and "on screen" is the one that loses nothing a
 * consumer could have used.
 */
export function valuePresence(
    registry: Registry, entity: string, field: string,
    value: unknown): Presence {
  if (value === null || value === undefined || value === "") return "seen";
  const def = registry.entities.get(entity)?.fields
    .find((f) => f.name === field);
  return def?.optionPresence?.[String(value)] ?? "seen";
}

/** Each linked subject's presence at a scene, by row id. */
export interface ScenePresence {
  character: Map<number, Presence>;
  prop: Map<number, Presence>;
}

/**
 * Presence at a scene, §2.4.1: every subject its links name, with the
 * presence the link's vocabulary gives. A subject linked twice keeps its
 * first link's presence, in row order (§12.1.6); the duplicate is a
 * finding of its own.
 */
export async function presenceAtScene(
    ctx: ScfContext, sceneId: number): Promise<ScenePresence> {
  const out: ScenePresence = { character: new Map(), prop: new Map() };
  for (const kind of KINDS) {
    if (!ctx.registry.entities.has(kind.sceneLink)) continue;
    for (const link of await linkRows(ctx, kind.sceneLink,
                                      "scene_id = ?", [sceneId])) {
      const id = Number(link[`${kind.subject}_id`]);
      if (!Number.isFinite(id) || out[kind.subject].has(id)) continue;
      out[kind.subject].set(id, valuePresence(
        ctx.registry, kind.sceneLink, kind.sceneField, link[kind.sceneField]));
    }
  }
  return out;
}

/** One subject at a shot. */
export interface ShotSubject {
  subjectType: PresenceSubject;
  id: number;
  presence: Presence;
  framing: string | null;
  /** Characters only; always null for a prop. */
  facing: string | null;
  focus: string | null;
  /**
   * `recorded`: a shot row puts it here. `inherited`: no row names it and
   * the shot's frame is not complete, so it comes from the scene with its
   * scene presence, and framing, facing and focus unknown.
   */
  source: "recorded" | "inherited";
}

export interface ShotPresence {
  shotId: number;
  sceneId: number | null;
  /** `shot.presence_complete`: the recorded rows are the whole frame. */
  complete: boolean;
  /** Recorded first, then inherited; characters before props. */
  subjects: ShotSubject[];
}

/**
 * `rows`, reading a table the file does not have as empty. A file written
 * before 2.17 has no shot presence tables, and §9.2 wants an answer from
 * it, not an exception: every shot in it is unrecorded.
 */
async function linkRows(
    ctx: ScfContext, table: string, where: string,
    params: Array<number | string>): Promise<Record<string, unknown>[]> {
  try {
    return await rows(ctx.exec, table, where, params);
  } catch {
    return [];
  }
}

const text = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/**
 * Presence at a shot, §4.6.
 *
 * A subject a shot row names is there, with the presence its framing
 * gives. If the frame is complete, that is everyone. Otherwise every
 * subject the scene links and no row names is inherited, with its scene
 * presence: a shot with no rows answers exactly as its scene does.
 *
 * A row naming a subject its scene does not link is kept, not dropped
 * (§9.2); `presenceProblems` reports it.
 */
export async function presenceAtShot(
    ctx: ScfContext, shotId: number): Promise<ShotPresence | null> {
  const shot = (await rows(ctx.exec, "shot", "id = ?", [shotId]))[0];
  if (shot === undefined) return null;
  const sceneIdRaw = Number(shot["scene_id"]);
  const sceneId = Number.isFinite(sceneIdRaw) ? sceneIdRaw : null;
  const complete = Number(shot["presence_complete"]) === 1
    || shot["presence_complete"] === true;
  const atScene = sceneId === null
    ? { character: new Map(), prop: new Map() } as ScenePresence
    : await presenceAtScene(ctx, sceneId);

  const subjects: ShotSubject[] = [];
  for (const kind of KINDS) {
    const named = new Set<number>();
    if (ctx.registry.entities.has(kind.shotLink)) {
      for (const row of await linkRows(ctx, kind.shotLink,
                                       "shot_id = ?", [shotId])) {
        const id = Number(row[`${kind.subject}_id`]);
        if (!Number.isFinite(id) || named.has(id)) continue;
        // A cut subject is not at any position (§6.6.1).
        if ((await rows(ctx.exec, kind.subject, "id = ?", [id])).length
            === 0) continue;
        named.add(id);
        subjects.push({
          subjectType: kind.subject, id,
          presence: valuePresence(ctx.registry, kind.shotLink, "framing",
                                  row["framing"]),
          framing: text(row["framing"]),
          facing: kind.subject === "character" ? text(row["facing"]) : null,
          focus: text(row["focus"]),
          source: "recorded",
        });
      }
    }
    if (complete) continue;
    for (const [id, presence] of atScene[kind.subject]) {
      if (named.has(id)) continue;
      if ((await rows(ctx.exec, kind.subject, "id = ?", [id])).length
          === 0) continue;
      subjects.push({
        subjectType: kind.subject, id, presence,
        framing: null, facing: null, focus: null, source: "inherited",
      });
    }
  }
  // Recorded before inherited, keeping each group's kind order.
  subjects.sort((a, b) => a.source === b.source ? 0
    : a.source === "recorded" ? -1 : 1);
  return { shotId, sceneId, complete, subjects };
}

/** A presence problem, for the finding catalog (§4.6). */
export interface PresenceProblem {
  code:
    | "presence.shot_subject_not_in_scene"
    | "presence.named_but_on_screen"
    | "presence.off_screen_described"
    | "presence.complete_but_empty";
  table: string;
  rowId: number;
  message: string;
}

/**
 * Everything §4.6 says to report rather than refuse, across every
 * shot in the file.
 */
export async function presenceProblems(
    ctx: ScfContext): Promise<PresenceProblem[]> {
  const out: PresenceProblem[] = [];
  if (!ctx.registry.entities.has("shot")) return out;
  for (const shot of await rows(ctx.exec, "shot")) {
    const shotId = Number(shot["id"]);
    const label = text(shot["shot_number"]) ?? text(shot["name"])
      ?? String(shotId);
    const sceneId = Number(shot["scene_id"]);
    const atScene = Number.isFinite(sceneId)
      ? await presenceAtScene(ctx, sceneId)
      : { character: new Map(), prop: new Map() } as ScenePresence;

    let rowCount = 0;
    for (const kind of KINDS) {
      if (!ctx.registry.entities.has(kind.shotLink)) continue;
      for (const row of await linkRows(ctx, kind.shotLink,
                                       "shot_id = ?", [shotId])) {
        rowCount += 1;
        const rowId = Number(row["id"]);
        const id = Number(row[`${kind.subject}_id`]);
        const scenePresence = atScene[kind.subject].get(id);
        const presence = valuePresence(ctx.registry, kind.shotLink,
                                       "framing", row["framing"]);
        if (scenePresence === undefined) {
          out.push({ code: "presence.shot_subject_not_in_scene",
            table: kind.shotLink, rowId,
            message: `Shot ${label} names a ${kind.subject} its scene ` +
              `does not link.` });
        } else if (scenePresence === "named" && presence === "seen") {
          out.push({ code: "presence.named_but_on_screen",
            table: kind.shotLink, rowId,
            message: `Shot ${label} puts on screen a ${kind.subject} its ` +
              `scene only names.` });
        }
        const described = (kind.subject === "character"
          && text(row["facing"]) !== null) || text(row["focus"]) !== null;
        if (text(row["framing"]) === "off_screen" && described) {
          out.push({ code: "presence.off_screen_described",
            table: kind.shotLink, rowId,
            message: `Shot ${label}: an off-screen ${kind.subject} has ` +
              `facing or focus set, which only describe what is on ` +
              `screen.` });
        }
      }
    }
    const complete = Number(shot["presence_complete"]) === 1
      || shot["presence_complete"] === true;
    if (complete && rowCount === 0) {
      out.push({ code: "presence.complete_but_empty", table: "shot",
        rowId: shotId,
        message: `Shot ${label} is marked presence_complete and records ` +
          `nobody and nothing: an empty frame, or a flag set by mistake.` });
    }
  }
  return out;
}
