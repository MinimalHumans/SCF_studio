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
  resolveDirection, resolveMedia, rows, sceneOrder, statesInForce,
  type SceneOrder, type ScfContext,
} from "./resolution.ts";
import { QUERY_PATHS, type QueryPath } from "./queryPaths.ts";

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
               `voice asset(s) resolve.`));
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
    out.push(f("suggestion", "performance_beat",
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
    }
  }
  return out;
}

async function readinessQ07(
    ctx: ScfContext, sceneId: number, shotId: number | null,
    _order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const leaf = shotId !== null ? "shot_design" : "scene_color_palette";
  const layers = new Map(await resolveDirection(ctx, leaf, sceneId, shotId));
  const requirement: Record<string, [Severity, string]> = {
    project_color_palette: ["blocker",
      "no project color root — the cascade has nothing to resolve against"],
    color_script_entry: ["suggestion",
      "no position-keyed color intent in force at this scene"],
    scene_color_palette: ["warning", "no scene color opinion"],
    lighting_design: ["warning", "no lighting design"],
    shot_design: ["warning", "no shot design for the given shot"],
    color_script: ["suggestion", "no color script summary"],
    look_development: ["suggestion", "no look development root"],
  };
  let chain = ["project_color_palette", "color_script", "color_script_entry",
               "scene_color_palette"];
  if (shotId !== null) {
    chain = [...chain, "look_development", "lighting_design", "shot_design"];
  }
  for (const entity of chain) {
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

  // cast appearance
  const cast = await rows(ctx.exec, "scene_character", "scene_id=?",
                          [sceneId]);
  for (const row of cast) {
    const cid = row["character_id"] as number;
    const profiles = await rows(ctx.exec, "character_appearance_profile",
                                "character_id=?", [cid]);
    if (profiles.length === 0) {
      out.push(f("warning", "character_appearance_profile",
                 `${await name(ctx, "character", cid)} is in this scene ` +
                 `with no appearance profile.`));
    }
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
  }
  const cues = [
    ...await rows(ctx.exec, "sound_cue", "scene_id=?", [sceneId]),
    ...await rows(ctx.exec, "music_cue", "scene_id=?", [sceneId]),
  ];
  out.push(f(cues.length > 0 ? "ok" : "suggestion", "sound_cue",
             cues.length > 0 ? `${cues.length} cue(s) authored.`
                             : "No cues authored for this scene."));
  return out;
}

async function readinessQ13(
    ctx: ScfContext, subject: string, subjectId: number, intent: string,
    sceneId: number | null, shotId: number | null,
    _order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const who = await name(ctx, subject, subjectId);
  const media = await resolveMedia(ctx, subject, subjectId, intent, sceneId,
                                   shotId);
  if (media.assets_most_specific_first.length === 0) {
    out.push(f("blocker", "bundle",
               `${who}: no ${intent} assets resolve — no bundle/` +
               `binding for this intent.`));
  } else {
    out.push(f("ok", "bundle",
               `${who}: ${media.assets_most_specific_first.length} ` +
               `${intent} asset(s) resolve ` +
               `(${media.override_assets.length} from overrides).`));
  }
  if (media.anchors.length > 0) {
    out.push(f("ok", "entity_anchor",
               `${media.anchors.length} verified anchor(s).`));
  } else {
    out.push(f("suggestion", "entity_anchor",
               `No verified anchors for ${who} — identity is unpinned.`));
  }
  return out;
}

async function readinessQ02(
    ctx: ScfContext, characterId: number, sceneId: number,
    order: SceneOrder): Promise<ReadinessFinding[]> {
  const out: ReadinessFinding[] = [];
  const who = await name(ctx, "character", characterId);
  const baselines: Array<[string, Severity, string]> = [
    ["character_appearance_profile", "warning", "appearance baseline"],
    ["physical_character_profile", "warning", "physical baseline"],
    ["vocal_profile", "suggestion", "voice baseline"],
  ];
  for (const [table, sev, what] of baselines) {
    const present = await rows(ctx.exec, table, "character_id=?",
                               [characterId]);
    if (present.length > 0) {
      out.push(f("ok", table, `${who}: ${what} present.`));
    } else {
      out.push(f(sev, table, `${who} has no ${what}.`));
    }
  }
  const costumes = await rows(ctx.exec, "costume", "character_id=?",
                              [characterId]);
  const inForce: Row[] = [];
  for (const c of costumes) {
    inForce.push(...await rows(
      ctx.exec, "costume_scene", "costume_id=? AND scene_id=?",
      [c["id"] ?? null, sceneId]));
  }
  if (inForce.length > 0) {
    out.push(f("ok", "costume_scene",
               `${inForce.length} costume assignment(s) for this scene.`));
  } else if (costumes.length > 0) {
    out.push(f("warning", "costume_scene",
               `${who} has costumes but none assigned to this scene ` +
               `(pattern 1 requires explicit rows).`));
  } else {
    out.push(f("warning", "costume", `${who} has no costumes.`));
  }
  out.push(...await readinessQ13(ctx, "character", characterId,
                                 "visual_identity", sceneId, null, order));
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
  const order = await sceneOrder(ctx);
  const sceneId = params.scene_id ?? null;
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
                                  params.subject_id as number,
                                  params.intent ?? "visual_identity",
                                  sceneId, params.shot_id ?? null, order);
  } else if (queryId === "Q02") {
    findings = await readinessQ02(ctx, characterId as number,
                                  sceneId as number, order);
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
