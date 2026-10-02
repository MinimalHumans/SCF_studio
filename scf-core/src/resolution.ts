// SPDX-License-Identifier: Apache-2.0
/**
 * resolution.ts — SCF resolution semantics, executable.
 *
 * The rules are stated in docs/conventions.md and pinned by the
 * conformance suites against the Hollow Creek fixture.
 *
 * Implements the walks the canonical queries are built from:
 *   - the DESCRIPTION cascade: profile -> states-in-force -> beats, per
 *     modality, with the 2.1 persistence semantics and key-wise modulation
 *     stacking
 *   - the DIRECTION cascade: registry `refines` graph walked root-first,
 *     most specific last (Q07 / Q08 / Q11)
 *   - the MEDIA cascade: bundle -> binding -> anchor -> shot override ->
 *     assets (Q13)
 *   - location-variant selection for a scene (resolver-first)
 *
 * Conventions honoured throughout:
 *   - story position order is derived from the SCRIPT (spec §4.1), via
 *     sceneOrder() below — never from scene_number alone
 *   - most-specific-wins; everything above the winner is returned as
 *     context, ordered root-first
 *   - absence is well-defined: a missing layer is skipped, never an error
 *
 * pyTruthy() treats null, undefined, "", 0 and false as absent in the
 * predicates that need it. The conformance fixture pins those edge
 * values, so the behaviour cannot be relaxed silently.
 */

import { q, type Row, type SqlExec, type SqlValue } from "./db.ts";
import { cascadeChain, type Registry } from "./registry.ts";
import { scenePositions, sceneOrderHint } from "./structure.ts";

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

/**
 * Fetch rows for RESOLUTION, excluding anything cut (spec §6.6).
 *
 * A cut row is not in the film. Marking something cut rather than
 * deleting it means it stops being considered while staying
 * inspectable, so every resolver — and therefore every canonical query
 * — must not see it. Cut rows are read back through `rowsIncludingCut`.
 *
 * The filter is applied in JS rather than in SQL on purpose: 88 of 99
 * entities declare `lifecycle_status` and eleven do not, so a SQL
 * predicate would have to probe for the column on every table it
 * touched. A missing column reads as undefined and keeps the row, which
 * is the correct answer for an entity that has no notion of being cut.
 */
export async function rows(
    exec: SqlExec, table: string, where = "",
    params: SqlValue[] = []): Promise<Row[]> {
  return excludeCut(await rowsIncludingCut(exec, table, where, params));
}

/**
 * §6.6.1's predicate, exported so a JOIN can apply it too.
 *
 * `rows()` covers everything fetched a table at a time. It does not
 * cover a query that reaches an entity THROUGH a junction in one SQL
 * statement — Q04's cast and props, Q03's costumes and motifs, Q02's
 * costumes each join a junction that cannot be cut to an entity that
 * can.
 *
 * §6.6.1 states its test as "adding a cut row changes no answer". That
 * has a mirror: **cutting an existing row MUST change the answer.** A
 * join filtering neither side passes the test as stated and fails the
 * mirror — marking a character cut would not remove them from Q04's
 * cast.
 *
 * One predicate, two call shapes. A second definition of "cut" would
 * eventually disagree with this one.
 */
export function excludeCut(rows: Row[]): Row[] {
  return rows.filter((r) => r["lifecycle_status"] !== "cut");
}

/**
 * Fetch rows without the §6.6 filter — everything, cut included.
 *
 * For tools that show what was removed: a cut list, an audit view, a
 * history panel. NOT for answering a question about the film, which is
 * what `rows` is for.
 */
export async function rowsIncludingCut(
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
 * Story-position index per scene: scene id → 0-based position.
 *
 * Derived from the SCREENPLAY (spec §4.1), by delegating to
 * `scenePositions`. It must not be derived any other way: sorting by
 * `scene_number` then row id is what §4.1 forbids in as many words. The
 * conformance fixture is built so screenplay order, scene-number order
 * and row-id order differ, which is what makes the wrong derivation
 * visible.
 *
 * Every position-dependent answer runs through here: states in force,
 * latest-wins lookups, the continuity diff. Deriving it twice is how
 * the two would drift, so it is derived once, there.
 */
export async function sceneOrder(ctx: ScfContext): Promise<SceneOrder> {
  const scenes = await rows(ctx.exec, "scene");
  const headings = await ctx.exec(
    "SELECT scene_id, line_order FROM screenplay_lines " +
    "WHERE line_type = 'heading'");
  const order: SceneOrder = new Map();
  scenePositions(scenes, sceneOrderHint(headings))
    .forEach((p, i) => order.set(p.id, i));
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

export function characterArcStateAt(
    ctx: ScfContext, arcId: number, sceneId: number,
    order: SceneOrder | null = null): Promise<Row | null> {
  return latestState(ctx, "character_arc_state", "character_arc_id",
                     arcId, sceneId, order);
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
  /**
   * `varies` on a variant's time_of_day is a WILDCARD, not a time: it
   * says the dressing holds at any hour (§12.17). Scored as an ordinary
   * value it could never agree with a scene, which made the one value
   * meaning "always applies" the one value that never won.
   */
  const agrees = (sceneAxis: string, variantAxis: string, v: Row): boolean => {
    const sv = scene[sceneAxis];
    const vv = v[variantAxis];
    if (!pyTruthy(sv) || !pyTruthy(vv)) return false;
    if (variantAxis === "time_of_day" && norm(vv) === "varies") return true;
    return norm(sv) === norm(vv);
  };
  const score = (v: Row): number => {
    let s = 0;
    for (const [sceneAxis, variantAxis] of VARIANT_AXES) {
      if (agrees(sceneAxis, variantAxis, v)) s += 1;
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
    if (pyTruthy(sv) && pyTruthy(vv) &&
        !agrees(sceneAxis, variantAxis, best)) {
      mismatches.push(
        `${sceneAxis}: scene=${JSON.stringify(sv)} ` +
        `variant=${JSON.stringify(vv)}`);
    }
  }
  return [best, mismatches];
}

// ---------------------------------------------------------------------------
// The variant in force (spec §4.8, proposal 0033)
// ---------------------------------------------------------------------------

/** The variant table for each subject kind that has one. */
export const VARIANT_ENTITY: Record<string, string> = {
  character: "character_variant",
  prop: "prop_variant",
  location: "location_variant",
};

/** The presence link that names a character's or prop's variant. */
const PRESENCE_LINK: Record<string, string> = {
  character: "scene_character",
  prop: "scene_prop",
};

/**
 * The variant of a subject in force at a scene (spec §4.8), or null.
 *
 * ONE definition, used by the binding filter, the anchor layer and Q02 —
 * a second reading of "in force" would be free to disagree with this one.
 *
 * - **location**: the variant §12.17 selects for the scene, and only if
 *   it is a variant of THIS location. A scene set somewhere else puts no
 *   variant of this one in force.
 * - **character, prop**: the variant the subject's presence link at the
 *   scene names. No link, a null `variant_id`, a cut variant, or a
 *   variant of another subject (`presence.variant_foreign`) → null.
 * - Any other kind, or no position → null.
 */
export async function variantInForce(
    ctx: ScfContext, subject: string, subjectId: number,
    sceneId: number | null): Promise<Row | null> {
  if (sceneId === null) return null;
  if (subject === "location") {
    const [v] = await selectLocationVariant(ctx, sceneId);
    return v !== null && asNum(v["location_id"]) === subjectId ? v : null;
  }
  const link = PRESENCE_LINK[subject];
  const table = VARIANT_ENTITY[subject];
  if (link === undefined || table === undefined) return null;
  const links = await rows(ctx.exec, link,
                           `scene_id = ? AND ${subject}_id = ?`,
                           [sceneId, subjectId]);
  links.sort((a, b) => (asNum(a["id"]) ?? 0) - (asNum(b["id"]) ?? 0));
  const wanted = asNum(links[0]?.["variant_id"]);
  if (wanted === null) return null;
  const variant = (await rows(ctx.exec, table, "id = ?", [wanted]))[0];
  if (variant === undefined) return null;
  return asNum(variant[`${subject}_id`]) === subjectId ? variant : null;
}

// ---------------------------------------------------------------------------
// Media cascade (Q13)
// ---------------------------------------------------------------------------

/**
 * Which anchor kind an intent is answered by (§12.8). Exported because
 * a second copy of this map is a second answer: `shotContext` reads it
 * to know what a subject's anchors could satisfy.
 */
export const ANCHOR_TYPE_FOR_INTENT: Record<string, string> = {
  visual_identity: "visual", surface: "visual", environment: "visual",
  voice_identity: "audio", acoustic: "audio", motion: "motion",
  performance: "motion",
};

const sameText = (a: SqlValue | undefined, b: SqlValue | undefined): boolean =>
  String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Whether a binding is in force at a position, and when it is not, WHY
 * (spec §12.8).
 *
 * Every filter the binding declares must be satisfied — they compose as
 * AND — and a filter the file leaves null is no condition at all. This
 * used to test the scene range alone while four other declared columns
 * were read by nothing, so a binding scoped to a variant, a time of day
 * or a physical state applied everywhere and its `trail` line said it
 * fired. A cascade that cannot explain an absence is worse than one
 * that resolves less.
 *
 * With no position asked about, only baselines apply and no positional
 * filter is evaluated: there is nothing to evaluate it against, and a
 * baseline that declares one is answering a question nobody asked.
 */
async function bindingApplies(
    ctx: ScfContext, subject: string, subjectId: number, binding: Row,
    sceneId: number | null, order: SceneOrder,
): Promise<{ applies: boolean; reason?: string }> {
  if (sceneId === null) {
    return pyTruthy(binding["is_baseline"])
      ? { applies: true } : { applies: false, reason: "not a baseline" };
  }
  const here = order.get(sceneId);
  const start = order.get(asNum(binding["scene_range_start_id"]) ?? -1);
  const end = order.get(asNum(binding["scene_range_end_id"]) ?? -1);
  if (start !== undefined && (here === undefined || here < start)) {
    return { applies: false, reason: "before its scene range" };
  }
  if (end !== undefined && (here === undefined || here > end)) {
    return { applies: false, reason: "after its scene range" };
  }

  // time_of_day_filter (location): equal to the scene's, on §12.17's
  // axis and 0012's closed vocabulary.
  if (pyTruthy(binding["time_of_day_filter"])) {
    const scene = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0];
    if (scene === undefined || !pyTruthy(scene["time_of_day"])) {
      return { applies: false,
               reason: `time_of_day_filter ` +
                 `"${String(binding["time_of_day_filter"])}", scene says nothing` };
    }
    if (!sameText(scene["time_of_day"], binding["time_of_day_filter"])) {
      return { applies: false,
               reason: `time_of_day_filter ` +
                 `"${String(binding["time_of_day_filter"])}" vs scene ` +
                 `"${String(scene["time_of_day"])}"` };
    }
  }

  // variant_id (character, prop, location): the variant §4.8 puts in
  // force here. Until 0033 only the location column existed, because
  // nothing said which character or prop variant was in force.
  if (pyTruthy(binding["variant_id"])) {
    const inForce = await variantInForce(ctx, subject, subjectId, sceneId);
    const wanted = asNum(binding["variant_id"]);
    if (inForce === null || asNum(inForce["id"]) !== wanted) {
      return { applies: false,
               reason: inForce === null
                 ? "variant filter, no variant in force here"
                 : `variant filter vs "${String(inForce["name"])}" in force` };
    }
  }

  // The state filters (character): a state of that modality in force at
  // this position (§4.5), whose description matches.
  for (const [column, modality] of [
    ["physical_state_filter", "physical"],
    ["vocal_state_filter", "vocal"],
  ] as const) {
    if (!pyTruthy(binding[column])) continue;
    if (subject !== "character") continue;
    const states = await statesInForce(ctx, subjectId, sceneId, modality,
                                       order);
    // Matched against the state's NAME — its natural-key label (§12.5),
    // which is what an author writing a filter has in hand. The
    // description is a sentence and nobody will retype one.
    const hit = states.some((st) => sameText(st["name"], binding[column]));
    if (!hit) {
      return { applies: false,
               reason: `${column} "${String(binding[column])}", no such ` +
                 `${modality} state in force` };
    }
  }

  return { applies: true };
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
  /**
   * The asset each anchor points at, aligned with `anchors` by index.
   *
   * An anchor NAMES a place in an asset; it is not an asset itself and
   * has no identifier. Consumers asking which assets are in force want
   * these. Resolve `anchors[i].asset_id` here and nowhere else —
   * resolved outside, a row id gets looked up in the wrong table and the
   * anchor is reported as an unrelated asset.
   */
  anchor_assets: Array<Row | null>;
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

  // Base bundles via bindings, filtered to intent, in §12.8.2's order:
  // precedence highest first, equal precedence by row id, lower first.
  const bindings = await rows(ctx.exec, `${subject}_asset_binding`,
                              `${idField} = ?`, [subjectId]);
  bindings.sort((a, b) =>
    ((asNum(b["precedence"]) ?? 0) - (asNum(a["precedence"]) ?? 0)) ||
    ((asNum(a["id"]) ?? 0) - (asNum(b["id"]) ?? 0)));
  const baseAssets: Row[] = [];
  // Built highest precedence first, and reversed into `trail`, which runs
  // broadest first (§12.8).
  const bindingLines: string[] = [];
  // The first `replace` binding in force: everything below its precedence
  // is excluded. Equal precedence is ordered, never replaced.
  let replacer: { name: string; precedence: number } | null = null;
  for (const b of bindings) {
    const bundles = await rows(ctx.exec, "bundle", "id = ?",
                               [b["bundle_id"] ?? null]);
    const bundle = bundles[0];
    if (bundle === undefined || bundle["intent"] !== intent) continue;
    const name = String(pyTruthy(b["name"]) ? b["name"] : b["id"]);
    const line = `binding ${name} -> bundle ${String(bundle["name"])}`;
    const verdict = await bindingApplies(ctx, subject, subjectId, b,
                                         sceneId, order);
    if (!verdict.applies) {
      // An absence with a reason. A binding excluded silently is how a
      // filter nothing read went unnoticed for two schema versions.
      bindingLines.push(`${line}: EXCLUDED, ${verdict.reason ?? "filtered"}`);
      continue;
    }
    const precedence = asNum(b["precedence"]) ?? 0;
    if (replacer !== null && precedence < replacer.precedence) {
      bindingLines.push(`${line}: EXCLUDED, replaced by ${replacer.name}`);
      continue;
    }
    bindingLines.push(line);
    baseAssets.push(
      ...await bundleAssets(ctx, asNum(b["bundle_id"]) ?? -1));
    if (replacer === null && sameText(b["combine"], "replace")) {
      replacer = { name, precedence };
    }
  }
  trail.push(...bindingLines.reverse());

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

  // Variant anchors (§12.8, proposal 0033). An anchor naming a variant
  // contributes only where that variant is in force; where it does and
  // the variant has an anchor of this type, the subject's own anchors of
  // the type step aside — an anchor is identity, and two faces at one
  // position contradict rather than combine. Every anchor left out says
  // why: until 0033 `subject_variant_id` was read by nothing, and a
  // variant's face came back as the subject's in every scene.
  const variant = await variantInForce(ctx, subject, subjectId, sceneId);
  const variantId = variant === null ? null : asNum(variant["id"]);
  const anchorName = (a: Row): string =>
    String(pyTruthy(a["name"]) ? a["name"] : a["id"]);
  const ofVariant = anchors.filter((a) =>
    variantId !== null && asNum(a["subject_variant_id"]) === variantId);
  const own = anchors.filter((a) => !pyTruthy(a["subject_variant_id"]));
  const kept = ofVariant.length > 0 ? ofVariant : own;
  for (const a of anchors) {
    if (kept.includes(a)) continue;
    if (pyTruthy(a["subject_variant_id"])) {
      trail.push(`anchor ${anchorName(a)}: EXCLUDED, ` +
        (variant === null
          ? "its variant is not in force here"
          : `its variant is not "${String(variant["name"])}"`));
    } else {
      trail.push(`anchor ${anchorName(a)}: EXCLUDED, ` +
        `displaced by variant "${String(variant?.["name"])}"`);
    }
  }
  anchors = kept;
  const anchorAssets: Array<Row | null> = [];
  for (const a of anchors) {
    trail.push(`anchor ${pyTruthy(a["name"]) ? a["name"] : a["id"]}`);
    const assetId = Number(a["asset_id"]);
    anchorAssets.push(Number.isFinite(assetId)
      ? (await rows(ctx.exec, "asset", "id = ?", [assetId]))[0] ?? null
      : null);
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
    anchor_assets: anchorAssets,
    base_assets: baseAssets,
    assets_most_specific_first: [
      ...overrideAssets,
      ...baseAssets.filter((a) => !overrideIds.has(a["id"])),
    ],
    trail,
  };
}
