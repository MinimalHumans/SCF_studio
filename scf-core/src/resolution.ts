/**
 * resolution.ts — SCF resolution semantics, executable. Mechanical port of
 * scf-editor/resolution.py; the Python module remains the reference until
 * conformance parity, then this implementation carries the contract forward
 * (the conformance fixture and suites outlive both implementations).
 *
 * Implements the walks the canonical queries are built from:
 *   - the DESCRIPTION cascade: profile -> states-in-force -> beats, per
 *     modality, with the 2.1 persistence semantics and key-wise modulation
 *     stacking
 *   - the DIRECTION cascade: registry `refines` graph walked root-first,
 *     most specific last (Q07 / Q08 / Q11)
 *   - the MEDIA cascade: bundle -> binding -> anchor -> shot override ->
 *     assets (Q13)
 *   - location-variant selection for a scene (G4, resolver-first)
 *
 * Conventions honored throughout (as in Python):
 *   - story position order = scene.scene_number (fallback: id order)
 *   - most-specific-wins; everything above the winner is returned as
 *     context, ordered root-first
 *   - absence is well-defined: a missing layer is skipped, never an error
 *
 * Python-truthiness note: the reference implementation leans on Python's
 * falsiness of None/""/0 in several predicates; pyTruthy() reproduces that
 * exactly so the two implementations cannot drift on edge values.
 */

import { q, type Row, type SqlExec, type SqlValue } from "./db.ts";
import { cascadeChain, type Registry } from "./registry.ts";

/** The context every semantics function operates in. */
export interface ScfContext {
  exec: SqlExec;
  registry: Registry;
}

/** Story-position index per scene id. */
export type SceneOrder = Map<number, number>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function pyTruthy(v: SqlValue | undefined): boolean {
  return !(v === null || v === undefined || v === "" || v === 0 ||
           v === false);
}

function asNum(v: SqlValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

export async function rows(
    exec: SqlExec, table: string, where = "",
    params: SqlValue[] = []): Promise<Row[]> {
  const sql = `SELECT * FROM ${q(table)}` + (where ? ` WHERE ${where}` : "");
  return exec(sql, params);
}

async function cols(exec: SqlExec, table: string): Promise<Set<string>> {
  const out = await exec(`PRAGMA table_info(${q(table)})`);
  return new Set(out.map((r) => String(r["name"])));
}

/**
 * Story-position index per scene. Screen order = scene_number when
 * populated, id order otherwise. (The reserved nonlinear-chronology seam
 * would swap this function's source; see conventions.md.)
 */
export async function sceneOrder(ctx: ScfContext): Promise<SceneOrder> {
  const scenes = await rows(ctx.exec, "scene");
  scenes.sort((a, b) => {
    const an = asNum(a["scene_number"]);
    const bn = asNum(b["scene_number"]);
    if ((an === null) !== (bn === null)) return an === null ? 1 : -1;
    if ((an ?? 0) !== (bn ?? 0)) return (an ?? 0) - (bn ?? 0);
    return (asNum(a["id"]) ?? 0) - (asNum(b["id"]) ?? 0);
  });
  const order: SceneOrder = new Map();
  scenes.forEach((r, i) => order.set(asNum(r["id"]) ?? -1, i));
  return order;
}

// ---------------------------------------------------------------------------
// Description cascade (Q02 / Q05 / Q06 spine)
// ---------------------------------------------------------------------------

const PROFILE_FOR_MODALITY: Record<string, string> = {
  vocal: "vocal_profile",
  physical: "physical_character_profile",
  facial: "physical_character_profile",
};

const STATE_MODALITY_FOR: Record<string, string> = {
  vocal: "vocal", physical: "physical", facial: "physical",
};

/**
 * Performance states in force at a scene, per the persistence rule:
 * scene_only states keyed exactly here, plus until_resolved states keyed
 * at-or-before here and not resolved at-or-before here. Ordered by keyed
 * position (oldest first) so stacking merges are deterministic.
 */
export async function statesInForce(
    ctx: ScfContext, characterId: number, sceneId: number,
    modality: string | null = null,
    order: SceneOrder | null = null): Promise<Row[]> {
  const ord = order ?? await sceneOrder(ctx);
  const here = ord.get(sceneId);
  if (here === undefined) return [];
  const out: Row[] = [];
  const all = await rows(ctx.exec, "performance_state",
                         "character_id = ?", [characterId]);
  for (const r of all) {
    if (modality !== null &&
        r["modality"] !== (STATE_MODALITY_FOR[modality] ?? modality)) {
      continue;
    }
    const persistence = pyTruthy(r["persistence"])
      ? String(r["persistence"]) : "scene_only";
    if (persistence === "scene_only") {
      if (r["scene_id"] === sceneId) out.push(r);
    } else { // until_resolved
      const keyed = ord.get(asNum(r["scene_id"]) ?? -1);
      if (keyed === undefined || keyed > here) continue;
      const resolved = ord.get(asNum(r["resolved_at_scene_id"]) ?? -1);
      if (resolved !== undefined && resolved <= here) continue;
      out.push(r);
    }
  }
  out.sort((a, b) =>
    (ord.get(asNum(a["scene_id"]) ?? -1) ?? -1) -
    (ord.get(asNum(b["scene_id"]) ?? -1) ?? -1));
  return out;
}

/**
 * Key-wise merge of stacked states' modulations, newest wins per key.
 * Input must already be ordered oldest-first (statesInForce does this).
 */
export function mergedModulations(states: Row[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const st of states) {
    try {
      const parsed = JSON.parse(
        pyTruthy(st["modulations"]) ? String(st["modulations"]) : "{}");
      if (parsed !== null && typeof parsed === "object") {
        Object.assign(merged, parsed);
      }
    } catch {
      continue;
    }
  }
  return merged;
}

export interface ResolvedDescription {
  modality: string;
  profile: Row | null;
  states: Row[];
  modulations: Record<string, unknown>;
  beats: Row[];
}

/**
 * The description cascade for one character/scene/modality: baseline
 * profile -> states in force (with merged modulations) -> moment beats.
 * Q05 and Q06 are this function with different modality constants.
 */
export async function resolveDescription(
    ctx: ScfContext, characterId: number, sceneId: number,
    modality: string): Promise<ResolvedDescription> {
  const order = await sceneOrder(ctx);
  const profileTable = PROFILE_FOR_MODALITY[modality];
  if (profileTable === undefined) {
    throw new Error(`unknown modality: ${modality}`);
  }
  const profiles = await rows(ctx.exec, profileTable,
                              "character_id = ?", [characterId]);
  const states = await statesInForce(ctx, characterId, sceneId, modality,
                                     order);
  const beats = await rows(
    ctx.exec, "performance_beat",
    "character_id = ? AND scene_id = ? AND modality = ?",
    [characterId, sceneId, modality]);
  beats.sort((a, b) => {
    const ao = asNum(a["beat_order"]);
    const bo = asNum(b["beat_order"]);
    if ((ao === null) !== (bo === null)) return ao === null ? 1 : -1;
    if ((ao ?? 0) !== (bo ?? 0)) return (ao ?? 0) - (bo ?? 0);
    return (asNum(a["id"]) ?? 0) - (asNum(b["id"]) ?? 0);
  });
  return {
    modality,
    profile: profiles[0] ?? null,
    states,
    modulations: mergedModulations(states),
    beats,
  };
}

// ---------------------------------------------------------------------------
// Latest-wins position keying (pattern 3, conventions.md) — G1 state tables
// ---------------------------------------------------------------------------

/**
 * Pattern-3 resolution: the row in force at a position is the latest row
 * keyed at-or-before it. Returns null when no row precedes the position
 * (state not yet established — well-defined absence).
 */
export async function latestState(
    ctx: ScfContext, table: string, keyField: string, keyId: number,
    sceneId: number, order: SceneOrder | null = null): Promise<Row | null> {
  const ord = order ?? await sceneOrder(ctx);
  const here = ord.get(sceneId);
  if (here === undefined) return null;
  let best: Row | null = null;
  let bestPos = -1;
  const all = await rows(ctx.exec, table, `${keyField} = ?`, [keyId]);
  for (const row of all) {
    const pos = ord.get(asNum(row["scene_id"]) ?? -1);
    if (pos === undefined || pos > here) continue;
    if (pos > bestPos ||
        (pos === bestPos &&
         (best === null ||
          (asNum(row["id"]) ?? 0) > (asNum(best["id"]) ?? 0)))) {
      best = row;
      bestPos = pos;
    }
  }
  return best;
}

export function relationshipStateAt(
    ctx: ScfContext, relationshipId: number, sceneId: number,
    order: SceneOrder | null = null): Promise<Row | null> {
  return latestState(ctx, "relationship_state", "character_relationship_id",
                     relationshipId, sceneId, order);
}

export function propStateAt(
    ctx: ScfContext, propId: number, sceneId: number,
    order: SceneOrder | null = null): Promise<Row | null> {
  return latestState(ctx, "prop_state", "prop_id", propId, sceneId, order);
}

export function motifStateAt(
    ctx: ScfContext, motifId: number, sceneId: number,
    order: SceneOrder | null = null): Promise<Row | null> {
  return latestState(ctx, "motif_state", "motif_id", motifId, sceneId,
                     order);
}

// ---------------------------------------------------------------------------
// Direction cascade (Q07 / Q08 / Q11 spine)
// ---------------------------------------------------------------------------

/**
 * Fetch the single most-appropriate row of a cascade layer for the given
 * position: shot-scoped row if the table has shot_id and one matches, else
 * scene-scoped row, else the singleton/global first row for position-free
 * layers. Layers whose registry positionPattern is latest_wins resolve per
 * pattern 3 (latest row at-or-before the scene) rather than by exact scene
 * match. Returns null when the layer is unpopulated.
 */
async function fetchLayer(
    ctx: ScfContext, entity: string, sceneId: number | null,
    shotId: number | null): Promise<Row | null> {
  const edef = ctx.registry.entities.get(entity);
  if (edef !== undefined && edef.positionPattern === "latest_wins" &&
      sceneId !== null) {
    // Position-keyed intent: sparse rows, latest-at-or-before wins.
    const order = await sceneOrder(ctx);
    const here = order.get(sceneId);
    let best: Row | null = null;
    let bestPos = -1;
    for (const row of await rows(ctx.exec, entity)) {
      const pos = order.get(asNum(row["scene_id"]) ?? -1);
      if (pos === undefined || here === undefined || pos > here) continue;
      if (pos > bestPos) {
        best = row;
        bestPos = pos;
      }
    }
    return best;
  }
  const tableCols = await cols(ctx.exec, entity);
  if (shotId !== null && tableCols.has("shot_id")) {
    const r = await rows(ctx.exec, entity, "shot_id = ?", [shotId]);
    if (r.length > 0) return r[0] ?? null;
  }
  if (sceneId !== null && tableCols.has("scene_id")) {
    const where = tableCols.has("shot_id")
      ? "scene_id = ? AND (shot_id IS NULL OR shot_id = '')"
      : "scene_id = ?";
    const r = await rows(ctx.exec, entity, where, [sceneId]);
    if (r.length > 0) return r[0] ?? null;
  }
  if (!tableCols.has("scene_id") && !tableCols.has("shot_id")) {
    const r = await rows(ctx.exec, entity);
    if (r.length > 0) return r[0] ?? null;
  }
  return null;
}

/**
 * Walk the direction cascade for `leaf` at a position. Returns
 * [entityName, row] layers ordered root-first; the last populated layer is
 * the most specific opinion, everything before it is context. Unpopulated
 * layers are skipped (absence is well-defined).
 */
export async function resolveDirection(
    ctx: ScfContext, leaf: string, sceneId: number | null = null,
    shotId: number | null = null): Promise<Array<[string, Row]>> {
  const layers: Array<[string, Row]> = [];
  for (const entity of cascadeChain(ctx.registry, leaf)) {
    const row = await fetchLayer(ctx, entity, sceneId, shotId);
    if (row !== null) layers.push([entity, row]);
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Location variant selection (G4, resolver-first)
// ---------------------------------------------------------------------------

const VARIANT_AXES: Array<[string, string]> = [
  ["time_of_day", "time_of_day"],
  ["weather_conditions", "weather"],
  ["season", "season"],
];

/**
 * Select the location_variant in force for a scene per the documented
 * convention: match the scene's narrative state axes against variant state
 * axes; best match wins; baseline is the fallback. Returns
 * [variant, mismatches] — mismatches list axes where the winning variant
 * disagrees with the scene, for tools to surface rather than hide.
 */
export async function selectLocationVariant(
    ctx: ScfContext,
    sceneId: number): Promise<[Row | null, string[]]> {
  const scenes = await rows(ctx.exec, "scene", "id = ?", [sceneId]);
  const scene = scenes[0];
  if (scene === undefined || scene["location_id"] === null ||
      scene["location_id"] === undefined) {
    return [null, []];
  }
  const variants = await rows(ctx.exec, "location_variant",
                              "location_id = ?", [scene["location_id"]]);
  if (variants.length === 0) return [null, []];

  const norm = (v: SqlValue | undefined): string =>
    String(v).trim().toLowerCase();
  const score = (v: Row): number => {
    let s = 0;
    for (const [sceneAxis, variantAxis] of VARIANT_AXES) {
      const sv = scene[sceneAxis];
      const vv = v[variantAxis];
      if (pyTruthy(sv) && pyTruthy(vv) && norm(sv) === norm(vv)) s += 1;
    }
    return s;
  };

  // max() with key (score, is_baseline): first maximal element wins ties,
  // as in Python.
  let best = variants[0] as Row;
  let bestKey: [number, number] = [score(best),
                                   pyTruthy(best["is_baseline"]) ? 1 : 0];
  for (const v of variants.slice(1)) {
    const key: [number, number] = [score(v),
                                   pyTruthy(v["is_baseline"]) ? 1 : 0];
    if (key[0] > bestKey[0] ||
        (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = v;
      bestKey = key;
    }
  }
  if (score(best) === 0) {
    const baselines = variants.filter((v) => pyTruthy(v["is_baseline"]));
    best = baselines[0] ?? best;
  }
  const mismatches: string[] = [];
  for (const [sceneAxis, variantAxis] of VARIANT_AXES) {
    const sv = scene[sceneAxis];
    const vv = best[variantAxis];
    if (pyTruthy(sv) && pyTruthy(vv) && norm(sv) !== norm(vv)) {
      mismatches.push(
        `${sceneAxis}: scene=${JSON.stringify(sv)} ` +
        `variant=${JSON.stringify(vv)}`);
    }
  }
  return [best, mismatches];
}

// ---------------------------------------------------------------------------
// Media cascade (Q13)
// ---------------------------------------------------------------------------

const ANCHOR_TYPE_FOR_INTENT: Record<string, string> = {
  visual_identity: "visual", surface: "visual", environment: "visual",
  voice_identity: "audio", acoustic: "audio", motion: "motion",
  performance: "motion",
};

function bindingApplies(
    binding: Row, sceneId: number | null, order: SceneOrder): boolean {
  if (sceneId === null) return pyTruthy(binding["is_baseline"]);
  const here = order.get(sceneId);
  const start = order.get(asNum(binding["scene_range_start_id"]) ?? -1);
  const end = order.get(asNum(binding["scene_range_end_id"]) ?? -1);
  if (start !== undefined && (here === undefined || here < start)) {
    return false;
  }
  if (end !== undefined && (here === undefined || here > end)) return false;
  return true;
}

async function bundleAssets(
    ctx: ScfContext, bundleId: number): Promise<Row[]> {
  const links = await rows(ctx.exec, "bundle_asset", "bundle_id = ?",
                           [bundleId]);
  links.sort((a, b) => {
    const ao = asNum(a["order"]);
    const bo = asNum(b["order"]);
    if ((ao === null) !== (bo === null)) return ao === null ? 1 : -1;
    if ((ao ?? 0) !== (bo ?? 0)) return (ao ?? 0) - (bo ?? 0);
    return (asNum(a["id"]) ?? 0) - (asNum(b["id"]) ?? 0);
  });
  const out: Row[] = [];
  for (const link of links) {
    const assets = await rows(ctx.exec, "asset", "id = ?",
                              [link["asset_id"] ?? null]);
    const asset = assets[0];
    if (asset !== undefined) {
      out.push({ ...asset, role_in_bundle: link["role_in_bundle"] ?? null });
    }
  }
  return out;
}

export interface ResolvedMedia {
  subject: string;
  subject_id: number;
  intent: string;
  override_assets: Row[];
  anchors: Row[];
  base_assets: Row[];
  assets_most_specific_first: Row[];
  trail: string[];
}

/**
 * The media cascade, as a function. subject is 'character', 'prop', or
 * 'location'. Returns override / anchor / base layers with assets
 * most-specific-first, plus the resolution trail.
 */
export async function resolveMedia(
    ctx: ScfContext, subject: string, subjectId: number, intent: string,
    sceneId: number | null = null,
    shotId: number | null = null): Promise<ResolvedMedia> {
  const order = await sceneOrder(ctx);
  const idField = `${subject}_id`;
  const trail: string[] = [];

  // Base bundles via bindings, precedence-ordered, filtered to intent.
  const bindings = await rows(ctx.exec, `${subject}_asset_binding`,
                              `${idField} = ?`, [subjectId]);
  bindings.sort((a, b) =>
    (asNum(b["precedence"]) ?? 0) - (asNum(a["precedence"]) ?? 0));
  const baseAssets: Row[] = [];
  for (const b of bindings) {
    if (!bindingApplies(b, sceneId, order)) continue;
    const bundles = await rows(ctx.exec, "bundle", "id = ?",
                               [b["bundle_id"] ?? null]);
    const bundle = bundles[0];
    if (bundle === undefined || bundle["intent"] !== intent) continue;
    trail.push(
      `binding ${pyTruthy(b["name"]) ? b["name"] : b["id"]} -> ` +
      `bundle ${bundle["name"]}`);
    baseAssets.push(
      ...await bundleAssets(ctx, asNum(b["bundle_id"]) ?? -1));
  }

  // Anchors for the subject, matching the intent's anchor type.
  const anchorType = ANCHOR_TYPE_FOR_INTENT[intent];
  let anchors = (await rows(
    ctx.exec, "entity_anchor", "subject_type = ? AND subject_id = ?",
    [subject, subjectId]))
    .filter((a) => anchorType === undefined ||
                   a["anchor_type"] === anchorType);
  anchors = anchors.filter((a) =>
    a["canonical_status"] === null || a["canonical_status"] === undefined ||
    a["canonical_status"] === "" || a["canonical_status"] === "verified");
  for (const a of anchors) {
    trail.push(`anchor ${pyTruthy(a["name"]) ? a["name"] : a["id"]}`);
  }

  // Shot overrides, most specific of all.
  const overrideAssets: Row[] = [];
  if (shotId !== null) {
    const overrides = await rows(
      ctx.exec, `${subject}_shot_override`,
      `shot_id = ? AND ${idField} = ?`, [shotId, subjectId]);
    for (const o of overrides) {
      if (pyTruthy(o["bundle_override_id"])) {
        trail.push(
          `shot override ${pyTruthy(o["name"]) ? o["name"] : o["id"]}`);
        overrideAssets.push(
          ...await bundleAssets(ctx, asNum(o["bundle_override_id"]) ?? -1));
      }
    }
  }

  const overrideIds = new Set(overrideAssets.map((x) => x["id"]));
  return {
    subject,
    subject_id: subjectId,
    intent,
    override_assets: overrideAssets,
    anchors,
    base_assets: baseAssets,
    assets_most_specific_first: [
      ...overrideAssets,
      ...baseAssets.filter((a) => !overrideIds.has(a["id"])),
    ],
    trail,
  };
}
