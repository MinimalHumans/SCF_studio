// SPDX-License-Identifier: Apache-2.0
/**
 * readiness.ts — Q14: readiness reports. Q14 semantics; see docs/conventions.md.
 *
 * Given a target canonical query and a position/subject scope, walk the
 * query's path (queryPaths.ts) using resolution.ts and report what's
 * missing, ranked by how much it blocks. This is the anti-form-filling
 * layer: authoring becomes gap-closing against declared intent.
 *
 * Severities:
 *   blocker    — the query's consumer cannot run
 *   warning    — it runs, but the answer is impoverished
 *   suggestion — judgment call surfaced to the author (never auto-resolved)
 *   ok         — present; listed so green is visible too
 *
 * Design rules honored:
 *   - well-defined absence is NOT a gap: no performance_state means the
 *     baseline holds (ok), never a warning — but a persisting physical
 *     injury with no vocal state gets a *suggestion*, because that absence
 *     is a judgment call, not a default.
 *   - readiness never writes anything.
 *
 * Finding message strings are part of the conformance surface (both test
 * suites match on substrings) and are ported verbatim.
 */

import { q, type Row, type SqlValue } from "./db.ts";
import {
  latestState, resolveDirection, resolveMedia, rows, sceneOfPosition,
  sceneOrder, statesInForce,
  type SceneOrder, type ScfContext,
} from "./resolution.ts";
import { QUERY_PATHS, type QueryPath } from "./queryPaths.ts";
import { presenceAtScene, presenceAtShot } from "./presence.ts";

/**
 * Readiness severity is NOT the finding-vocabulary severity of
 * findings.ts, and the two must not be conflated. That vocabulary
 * answers "is this file well-formed"; readiness answers "can this query
 * be answered well from it". A file can be flawless and still not have
 * enough authored for Q05 to say anything useful.
 */
export type Severity = "blocker" | "warning" | "suggestion" | "ok";

export const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0, warning: 1, suggestion: 2, ok: 3,
};

export interface ReadinessFinding {
  severity: Severity;
  entity: string;
  message: string;
}

export interface ReadinessReport {
  query: string;
  meta: QueryPath;
  params: Record<string, unknown>;
  findings: ReadinessFinding[];
  counts: Record<Severity, number>;
}

const f = (severity: Severity, entity: string,
           message: string): ReadinessFinding =>
  ({ severity, entity, message });

async function name(
    ctx: ScfContext, table: string, rowId: number): Promise<string> {
  const r = await ctx.exec(
    `SELECT name FROM ${q(table)} WHERE id=?`, [rowId]);
  const n = r[0]?.["name"];
  return (n !== null && n !== undefined && n !== "")
    ? String(n) : `${table} #${rowId}`;
}

/**
 * Fraction of a row's authored columns that are empty (excluding framework
 * columns). 1.0 = nothing but a name.
 */
function thinness(row: Row): number {
  const skip = new Set([
    "id", "name", "created_at", "updated_at", "lifecycle_status",
    "external_id", "external_id_namespace", "parent_id", "version_label",
    "superseded_at", "superseded_by_id",
  ]);
  const fields: Array<[string, SqlValue]> = Object.entries(row)
    .filter(([k]) => !skip.has(k) && !k.endsWith("_id"));
  if (fields.length === 0) return 0.0;
  const empty = fields.filter(([, v]) => v === null || v === "").length;
  return empty / fields.length;
}

// ---------------------------------------------------------------------------
// Per-query walkers
// ---------------------------------------------------------------------------

async function readinessQ05(
    ctx: ScfContext, characterId: number, sceneId: number,
    order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const who = await name(ctx, "character", characterId);
  const profiles = await rows(ctx.exec, "vocal_profile", "character_id=?",
                              [characterId]);
  const profile = profiles[0];
  if (profile === undefined) {
    out.push(f("blocker", "vocal_profile",
               `${who} has no vocal profile — no voice baseline.`));
  } else {
    const thin = thinness(profile);
    if (thin > 0.7) {
      out.push(f("warning", "vocal_profile",
                 `${who}'s vocal profile is thin ` +
                 `(${Math.trunc((1 - thin) * 100)}% populated) — enough to ` +
                 `identify, not enough to direct.`));
    } else {
      out.push(f("ok", "vocal_profile", `${who}: voice baseline present.`));
    }
  }

  const media = await resolveMedia(ctx, "character", characterId,
                                   "voice_identity", sceneId);
  if (media.assets_most_specific_first.length === 0) {
    out.push(f("blocker", "bundle",
               `${who} has no voice_identity bundle — nothing for a ` +
               `voice tool to condition on.`));
  } else {
    out.push(f("ok", "bundle",
               `${who}: ${media.assets_most_specific_first.length} ` +
               `voice asset(s) in force.`));
  }

  const voc = await statesInForce(ctx, characterId, sceneId, "vocal", order);
  const phys = await statesInForce(ctx, characterId, sceneId, "physical",
                                   order);
  if (voc.length > 0) {
    out.push(f("ok", "performance_state",
               `Vocal state in force: ` +
               `${voc.map((s) => s["name"]).join(", ")}.`));
  } else {
    out.push(f("ok", "performance_state",
               "No vocal state in force — baseline holds (by design)."));
    const persisting = phys.filter(
      (s) => (s["persistence"] ?? "") === "until_resolved");
    if (persisting.length > 0) {
      const names = persisting.map((s) => s["name"]).join(", ");
      out.push(f("suggestion", "performance_state",
                 `Physical state persists here (${names}) with no ` +
                 `vocal state — does it color the voice?`));
    }
  }

  const beats = await rows(
    ctx.exec, "performance_beat",
    "character_id=? AND scene_id=? AND modality='vocal'",
    [characterId, sceneId]);
  if (beats.length > 0) {
    out.push(f("ok", "performance_beat",
               `${beats.length} vocal beat(s) authored.`));
  } else {
    // `recommended`, so an absence is a warning (§12.9.1); it was a
    // suggestion, outside the range the step permits.
    out.push(f("warning", "performance_beat",
               `No vocal beats for ${who} in this scene — lines ` +
               `render on baseline+state alone.`));
  }

  const sceneTables: Array<[string, string]> = [
    ["dialogue_rhythm", "scene speech rhythm"],
    ["sound_perspective", "sound perspective"],
  ];
  for (const [table, label] of sceneTables) {
    const present = await rows(ctx.exec, table, "scene_id=?", [sceneId]);
    if (present.length > 0) {
      out.push(f("ok", table, `${label} present.`));
    } else {
      const sev: Severity =
        table === "dialogue_rhythm" ? "warning" : "suggestion";
      out.push(f(sev, table, `No ${label} for this scene.`));
    }
  }
  return out;
}

async function readinessQ06(
    ctx: ScfContext, characterId: number, sceneId: number,
    order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const who = await name(ctx, "character", characterId);
  const profiles = await rows(ctx.exec, "physical_character_profile",
                              "character_id=?", [characterId]);
  if (profiles.length === 0) {
    out.push(f("blocker", "physical_character_profile",
               `${who} has no physical profile — no movement baseline.`));
  } else {
    out.push(f("ok", "physical_character_profile",
               `${who}: movement baseline present.`));
  }

  const blocking = await rows(ctx.exec, "scene_blocking", "scene_id=?",
                              [sceneId]);
  const action = await rows(ctx.exec, "action_sequence", "scene_id=?",
                            [sceneId]);
  if (blocking.length > 0 || action.length > 0) {
    out.push(f("ok", "scene_blocking",
               "Staging container present " +
               `(${blocking.length > 0 ? "blocking" : "action sequence"}).`));
  } else {
    out.push(f("warning", "scene_blocking",
               "No scene_blocking or action_sequence — physical " +
               "direction has no staging container."));
  }

  const states = await statesInForce(ctx, characterId, sceneId, "physical",
                                     order);
  out.push(f("ok", "performance_state",
             `Physical states in force: ` +
             `${states.map((s) => s["name"]).join(", ") ||
               "none (baseline)"}.`));

  // Physical only, as Q06 reads them (§12.6): a facial beat is not in
  // its answer, so it cannot make the answer ready.
  const beats = await rows(
    ctx.exec, "performance_beat",
    "character_id=? AND scene_id=? AND modality='physical'",
    [characterId, sceneId]);
  out.push(f("ok", "performance_beat", beats.length > 0
    ? `${beats.length} physical beat(s) authored.`
    : "No physical beats — the states and baseline carry it."));

  const sceneRow = await rows(ctx.exec, "scene", "id=?", [sceneId]);
  const loc = sceneRow[0]?.["location_id"];
  if (loc !== null && loc !== undefined && loc !== "" && loc !== 0) {
    const env = await rows(
      ctx.exec, "character_environment_physicality",
      "character_id=? AND location_id=?", [characterId, loc]);
    if (env.length === 0) {
      out.push(f("suggestion", "character_environment_physicality",
                 `No environment physicality for ${who} at this ` +
                 `location — how do they relate to this place?`));
    } else {
      out.push(f("ok", "character_environment_physicality",
                 `${who}: how they relate to this place is authored.`));
    }
  } else {
    out.push(f("ok", "character_environment_physicality",
               "The scene has no location to relate to."));
  }

  const motion = await mediaStep(ctx, "character", characterId, "motion",
                                 sceneId, null, "ok");
  out.push(motion.finding);
  return out;
}

async function readinessQ07(
    ctx: ScfContext, sceneId: number | null, shotId: number | null,
    _order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  // §12.9.1: each step's rows narrowed as §7.3 reads them. The shot
  // cascade's chain holds every color and lighting entity the rubric
  // names, and `fetchLayer` is §7.3's step 2: at a shot, the shot's own
  // row, else the scene's row with no shot — so a shot with no lighting
  // of its own is ready on the scene's, as Q07 answers there. Narrowing
  // by `shot_id` equality instead warned about a layer Q07 returns.
  const layers = new Map(await resolveDirection(ctx, "shot_design",
                                                sceneId, shotId));
  // Each absence within the range its step permits (§12.9.1): a
  // `required` step's is a blocker, a `recommended` one's a warning, an
  // `optional` one's `ok`, or a suggestion where the position makes it
  // notable — and a shot with no design of its own is.
  const requirement: Record<string, [Severity, string]> = {
    project_color_palette: ["blocker",
      "no project color root — the cascade has nothing to resolve against"],
    color_script: ["ok", "no color script summary above the entries"],
    color_script_entry: ["warning",
      "no position-keyed color intent in force at this scene"],
    scene_color_palette: ["warning", "no scene color opinion"],
    look_development: ["ok", "no look development root"],
    lighting_design: ["warning", "no lighting design"],
    shot_design: ["suggestion",
      "no shot design for the given shot — it takes the scene's look"],
  };
  for (const entity of Object.keys(requirement)) {
    if (entity === "shot_design" && shotId === null) {
      // Keyed by shot alone: with no shot asked, nothing to narrow to.
      out.push(f("ok", entity,
                 "No shot asked about — shot design does not apply."));
      continue;
    }
    const row = layers.get(entity);
    if (row !== undefined) {
      const label = (row["name"] !== null && row["name"] !== undefined &&
                     row["name"] !== "")
        ? String(row["name"]) : `#${row["id"]}`;
      out.push(f("ok", entity, `${entity} in force: ${label}.`));
    } else {
      const [sev, msg] = requirement[entity] ??
        ["suggestion" as Severity, "missing"];
      out.push(f(sev, entity,
                 msg.charAt(0).toUpperCase() + msg.slice(1) + "."));
    }
  }

  // visual_identity root (not on the color chain but a Q07 requirement)
  const vi = await rows(ctx.exec, "visual_identity");
  if (vi.length > 0) {
    out.push(f("ok", "visual_identity", "Visual identity root present."));
  } else {
    out.push(f("blocker", "visual_identity",
               "No visual identity — no material/aesthetic root."));
  }

  // Cast appearance, for characters SEEN at the position (§2.4.1,
  // §4.6). A character who is only named or only heard has no look to
  // design, so asking for one is a warning nobody can act on.
  // A recorded character IS on screen in the shot; an inherited one is
  // only in its scene (§4.6), and the message must not claim more.
  const seen: Array<{ cid: number; where: string }> = [];
  // No one is seen at an empty position (§12.9), a shot of a cut scene
  // included, so the loops below run only where there is a scene.
  const atShot = shotId === null || sceneId === null
    ? null : await presenceAtShot(ctx, shotId);
  if (atShot !== null) {
    for (const s of atShot.subjects) {
      if (s.subjectType === "character" && s.presence === "seen") {
        seen.push({ cid: s.id, where: s.source === "recorded"
          ? "on screen in this shot" : "in this scene" });
      }
    }
  } else if (sceneId !== null) {
    for (const [cid, presence] of
         (await presenceAtScene(ctx, sceneId)).character) {
      if (presence === "seen") seen.push({ cid, where: "in this scene" });
    }
  }
  let unprofiled = 0;
  for (const { cid, where } of seen) {
    const profiles = await rows(ctx.exec, "character_appearance_profile",
                                "character_id=?", [cid]);
    if (profiles.length === 0) {
      unprofiled += 1;
      out.push(f("warning", "character_appearance_profile",
                 `${await name(ctx, "character", cid)} is ${where} ` +
                 `with no appearance profile.`));
    }
  }
  if (unprofiled === 0) {
    out.push(f("ok", "character_appearance_profile", seen.length > 0
      ? "Every character seen here has an appearance profile."
      : "No character is seen here."));
  }
  return out;
}

async function readinessQ08(
    ctx: ScfContext, sceneId: number,
    _order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const sonic = await rows(ctx.exec, "sonic_identity");
  if (sonic.length > 0) {
    out.push(f("ok", "sonic_identity", "Sound world root present."));
  } else {
    out.push(f("blocker", "sonic_identity",
               "No sonic identity — the sound world has no root."));
  }
  const music = await rows(ctx.exec, "scene_music_design", "scene_id=?",
                           [sceneId]);
  if (music.length > 0) {
    out.push(f("ok", "scene_music_design",
               "Music design authored (silence counts)."));
  } else {
    out.push(f("warning", "scene_music_design",
               "No music design for this scene — authored silence " +
               "beats accidental silence."));
  }
  const sceneRow = await rows(ctx.exec, "scene", "id=?", [sceneId]);
  const loc = sceneRow[0]?.["location_id"];
  if (loc !== null && loc !== undefined && loc !== "" && loc !== 0) {
    const profile = await rows(ctx.exec, "location_sound_profile",
                               "location_id=?", [loc]);
    if (profile.length > 0) {
      out.push(f("ok", "location_sound_profile",
                 "The room has a sound profile."));
    } else {
      out.push(f("warning", "location_sound_profile",
                 "This location has no sound profile."));
    }
  } else {
    // Reported either way: coverage is every step (§12.9.1).
    out.push(f("ok", "location_sound_profile",
               "The scene has no location — a room profile does not " +
               "apply."));
  }
  const dialogue = await rows(ctx.exec, "dialogue_sound_design",
                              "scene_id=?", [sceneId]);
  out.push(f("ok", "dialogue_sound_design", dialogue.length > 0
    ? "Dialogue sound design authored."
    : "No dialogue sound design — the scene's defaults hold."));
  const cues = [
    ...await rows(ctx.exec, "sound_cue", "scene_id=?", [sceneId]),
    ...await rows(ctx.exec, "music_cue", "scene_id=?", [sceneId]),
  ];
  out.push(f(cues.length > 0 ? "ok" : "suggestion", "sound_cue",
             cues.length > 0 ? `${cues.length} cue(s) authored.`
                             : "No cues authored for this scene."));
  return out;
}

/**
 * The media step (§12.9.1): the subject asked about has at least one
 * reference of the intent in force — its own Q13 answer at the position.
 */
async function mediaStep(
    ctx: ScfContext, subject: string, subjectId: number, intent: string,
    sceneId: number | null, shotId: number | null,
    absent: Severity): Promise<{ finding: ReadinessFinding;
                                 media: Awaited<ReturnType<typeof resolveMedia>> }> {
  const who = await name(ctx, subject, subjectId);
  const media = await resolveMedia(ctx, subject, subjectId, intent, sceneId,
                                   shotId);
  const finding = media.assets_most_specific_first.length === 0
    ? f(absent, "bundle",
        `${who}: no ${intent} assets in force here — none bound, ` +
        `or every binding excluded at this position.`)
    : f("ok", "bundle",
        `${who}: ${media.assets_most_specific_first.length} ` +
        `${intent} asset(s) in force ` +
        `(${media.override_assets.length} from overrides).`);
  return { finding, media };
}

async function readinessQ13(
    ctx: ScfContext, subject: string, subjectId: number, intent: string,
    sceneId: number | null, shotId: number | null,
    _order: SceneOrder): Promise<ReadinessFinding[]> {
  const who = await name(ctx, subject, subjectId);
  const { finding, media } = await mediaStep(
    ctx, subject, subjectId, intent, sceneId, shotId, "blocker");
  const out: ReadinessFinding[] = [finding];
  // A step none of whose entities can be narrowed to the subject's kind
  // does not apply to it (§12.9.1). `entity_anchor.subject_type` offers
  // no `costume`, and the registry declares no costume shot override.
  if (!anchorable(ctx, subject)) {
    out.push(f("ok", "entity_anchor",
               `Does not apply to a ${subject} — an anchor's subject is ` +
               `a character, prop or location.`));
  } else if (media.anchors.length > 0) {
    out.push(f("ok", "entity_anchor",
               `${media.anchors.length} verified anchor(s).`));
  } else {
    out.push(f("warning", "entity_anchor",
               `No verified anchors for ${who} — identity is unpinned.`));
  }
  // Optional: an override is a shot-specific swap, and none is the
  // ordinary case — the bindings hold.
  const override = `${subject}_shot_override`;
  if (!ctx.registry.entities.has(override)) {
    out.push(f("ok", "character_shot_override",
               `Does not apply to a ${subject} — no shot override ` +
               `names one.`));
  } else if (shotId === null) {
    out.push(f("ok", override,
               "No shot asked about — shot overrides do not apply."));
  } else if (media.override_assets.length > 0) {
    out.push(f("ok", override,
               `${media.override_assets.length} asset(s) from a shot ` +
               `override.`));
  } else {
    out.push(f("ok", override,
               "No shot override here — the bindings hold."));
  }
  return out;
}

/** Whether `entity_anchor` can name this kind of subject. */
function anchorable(ctx: ScfContext, subject: string): boolean {
  const field = ctx.registry.entities.get("entity_anchor")?.fields
    .find((x) => x.name === "subject_type");
  return field?.options?.includes(subject) ?? false;
}

/** Q02's steps keyed by `character_id`, which a prop or location lacks. */
const Q02_CHARACTER_STEPS = [
  "character_appearance_profile", "physical_character_profile",
  "vocal_profile", "costume", "relationship_state",
  "performance_state",
];

/**
 * Q02's media intent for a kind of subject, from the rubric's
 * `intentBySubjectType` — the intent the Q13 answer Q02 nests asks
 * (§12.16). Read from the rubric so the two cannot disagree again.
 */
function q02MediaIntent(subject: string): string {
  const media = QUERY_PATHS["Q02"]?.steps
    .find((s) => s.intentBySubjectType !== undefined);
  return media?.intentBySubjectType?.[subject] ?? "visual_identity";
}

/**
 * A character's presence at the position (§2.4.1 at a scene, §4.6 at a
 * shot), or "absent" where it is not there at all — an empty position
 * (§12.1.7) included.
 */
async function presenceAt(
    ctx: ScfContext, characterId: number, sceneId: number | null,
    shotId: number | null): Promise<string> {
  // A shot of a cut scene is at that empty position too (§12.1.7).
  if (sceneId === null) return "absent";
  if (shotId !== null) {
    const atShot = await presenceAtShot(ctx, shotId);
    const s = atShot?.subjects.find((x) =>
      x.subjectType === "character" && x.id === characterId);
    return s?.presence ?? "absent";
  }
  return (await presenceAtScene(ctx, sceneId)).character.get(characterId)
    ?? "absent";
}

async function readinessQ02(
    ctx: ScfContext, subject: string, subjectId: number, sceneId: number,
    shotId: number | null,
    order: SceneOrder): Promise<ReadinessFinding[]> {
  if (subject !== "character") {
    // §12.9.1: a step none of whose entities can be narrowed to the
    // subject's kind does not apply to it, and says so.
    const out = Q02_CHARACTER_STEPS.map((entity) =>
      f("ok", entity, `Does not apply to a ${subject}.`));
    // Q02's nested Q13 (§12.16) asks a location for its environment.
    out.push((await mediaStep(ctx, subject, subjectId,
                              q02MediaIntent(subject),
                              sceneId, shotId, "blocker")).finding);
    return out;
  }
  const characterId = subjectId;
  const out: ReadinessFinding[] = [];
  const who = await name(ctx, "character", characterId);
  // §12.9: the steps marked `appliesTo: "seen"` are about how a
  // character looks, and one who is only heard or named here has no
  // look to design. They are reported, as not applying, and say why.
  const presence = await presenceAt(ctx, characterId, sceneId, shotId);
  const seen = presence === "seen";
  const unseen = (entity: string): ReadinessFinding =>
    f("ok", entity, presence === "absent"
      ? `Does not apply: ${who} is not at this position — no look to ` +
        `design.`
      : `Does not apply: ${who} is ${presence} here, not seen — no look ` +
        `to design.`);
  const baselines: Array<[string, Severity, string, boolean]> = [
    ["character_appearance_profile", "warning", "appearance baseline", true],
    ["physical_character_profile", "warning", "physical baseline", true],
    // Optional: an absent voice baseline is `ok` (§12.9.1) — nothing
    // about a character at a position makes it notable by itself.
    ["vocal_profile", "ok", "voice baseline", false],
  ];
  for (const [table, sev, what, look] of baselines) {
    if (look && !seen) {
      out.push(unseen(table));
      continue;
    }
    const present = await rows(ctx.exec, table, "character_id=?",
                               [characterId]);
    if (present.length > 0) {
      out.push(f("ok", table, `${who}: ${what} present.`));
    } else {
      out.push(f(sev, table, `${who} has no ${what}.`));
    }
  }
  // Satisfied by a `costume_scene` for this character here and by
  // nothing else (the step's `satisfiedBy`): `costume` names the finding
  // where there are none at all, and cannot satisfy it.
  const costumes = await rows(ctx.exec, "costume", "character_id=?",
                              [characterId]);
  const inForce: Row[] = [];
  for (const c of costumes) {
    inForce.push(...await rows(
      ctx.exec, "costume_scene", "costume_id=? AND scene_id=?",
      [c["id"] ?? null, sceneId]));
  }
  if (!seen) {
    out.push(unseen("costume_scene"));
  } else if (inForce.length > 0) {
    out.push(f("ok", "costume_scene",
               `${inForce.length} costume assignment(s) for this scene.`));
  } else if (costumes.length > 0) {
    out.push(f("warning", "costume_scene",
               `${who} has costumes but none assigned to this scene ` +
               `(pattern 1 requires explicit rows).`));
  } else {
    out.push(f("warning", "costume", `${who} has no costumes.`));
  }
  // Optional, and absence is ordinary: no state means none has changed.
  // Narrowed to the character one reference away (§12.9.1), through
  // either of `character_relationship`'s character columns.
  const relationships = await ctx.exec(
    "SELECT id FROM character_relationship " +
    "WHERE character_a_id = ? OR character_b_id = ?",
    [characterId, characterId]);
  let standing = 0;
  for (const r of relationships) {
    const s = await latestState(ctx, "relationship_state",
                                "character_relationship_id",
                                Number(r["id"]), sceneId, order);
    if (s !== null) standing += 1;
  }
  out.push(f("ok", "relationship_state", standing > 0
    ? `${standing} relationship state(s) in force.`
    : "No relationship state in force — none has changed."));
  const states = [
    ...await statesInForce(ctx, characterId, sceneId, "physical", order),
    ...await statesInForce(ctx, characterId, sceneId, "vocal", order),
  ];
  out.push(f("ok", "performance_state", states.length > 0
    ? `Performance state(s) in force: ` +
      `${states.map((s) => s["name"]).join(", ")}.`
    : "No performance state in force — baseline holds (by design)."));
  out.push((await mediaStep(ctx, "character", characterId,
                            q02MediaIntent("character"), sceneId, shotId,
                            "blocker")).finding);
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ReadinessParams {
  scene_id?: number;
  character_id?: number;
  shot_id?: number;
  subject?: string;
  subject_id?: number;
  intent?: string;
}

/** Q14. Returns {query, meta, params, findings (ranked), counts}. */
export async function readinessReport(
    ctx: ScfContext, queryId: string,
    params: ReadinessParams = {}): Promise<ReadinessReport> {
  const meta = QUERY_PATHS[queryId];
  if (meta === undefined) {
    throw new Error(
      `no readiness path for '${queryId}' ` +
      `(walkable: ${Object.keys(QUERY_PATHS).sort().join(", ")})`);
  }
  // §12.9: Q14 takes the target's own parameters. Without them there
  // is no position or subject to narrow a step to.
  const subjectGiven = params.subject_id !== undefined ||
    params.character_id !== undefined;
  if ((queryId === "Q02" || queryId === "Q13") && !subjectGiven) {
    throw new Error(`Q14 for ${queryId} needs a subject`);
  }
  if (queryId === "Q13" && params.intent === undefined) {
    throw new Error("Q14 for Q13 needs an intent");
  }
  const order = await sceneOrder(ctx);
  // §12.1.7, for Q14 as for its target: a shot fixes the position at
  // its own scene, and one outside the scene asked is not answered.
  const sceneId = await sceneOfPosition(ctx, params.scene_id ?? null,
                                        params.shot_id ?? null);
  const characterId = params.character_id ?? null;
  let findings: ReadinessFinding[];
  if (queryId === "Q05") {
    findings = await readinessQ05(ctx, characterId as number,
                                  sceneId as number, order);
  } else if (queryId === "Q06") {
    findings = await readinessQ06(ctx, characterId as number,
                                  sceneId as number, order);
  } else if (queryId === "Q07") {
    findings = await readinessQ07(ctx, sceneId as number,
                                  params.shot_id ?? null, order);
  } else if (queryId === "Q08") {
    findings = await readinessQ08(ctx, sceneId as number, order);
  } else if (queryId === "Q13") {
    findings = await readinessQ13(ctx, params.subject ?? "character",
                                  (params.subject_id ?? characterId) as number,
                                  params.intent as string,
                                  sceneId, params.shot_id ?? null, order);
  } else if (queryId === "Q02") {
    findings = await readinessQ02(
      ctx, params.subject ?? "character",
      (params.subject_id ?? characterId) as number, sceneId as number,
      params.shot_id ?? null, order);
  } else { // declared in QUERY_PATHS but not yet walkable
    findings = [];
  }
  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const counts = Object.fromEntries(
    (Object.keys(SEVERITY_ORDER) as Severity[]).map((s) =>
      [s, findings.filter((x) => x.severity === s).length]),
  ) as Record<Severity, number>;
  return { query: queryId, meta, params: { ...params }, findings, counts };
}
