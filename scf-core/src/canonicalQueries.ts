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
import {
  resolveDescription, resolveDirection, resolveMedia,
} from "./resolution.ts";
import { mediaReferences } from "./mediaReferences.ts";
import { readinessReport } from "./readiness.ts";
import type { FileLocator } from "./assets.ts";
import {
  envelope, projectRow, referencesOf, uuidLookupForAll,
  type ProjectedRow, type QueryResult, type UuidLookup,
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

// No hand-written reference maps. `referencesOf(registry, entity)`
// derives them from the registry's own `referenceEntity` declarations,
// and `uuidLookupForAll` indexes every entity any of them can point at.
// The previous version maintained both by hand per query, and the maps
// disagreed — see referencesOf's comment.
const refs = (ctx: ScfContext, entity: string): Record<string, string> =>
  referencesOf(ctx.registry, entity);

export async function q05Result(
    ctx: ScfContext, characterUuid: string, sceneUuid: string,
    characterId: number, sceneId: number,
): Promise<QueryResult<Q05Result>> {
  return descriptionResult("Q05", "vocal", ctx, characterUuid, sceneUuid,
                           characterId, sceneId);
}

/**
 * Q06 — Physical direction (§12.6).
 *
 * The same query as Q05 with a different modality, and it is worth
 * saying so in one function rather than two: the shape of the answer is
 * identical, and two copies would be two places for it to change.
 */
export async function q06Result(
    ctx: ScfContext, characterUuid: string, sceneUuid: string,
    characterId: number, sceneId: number,
): Promise<QueryResult<Q05Result>> {
  return descriptionResult("Q06", "physical", ctx, characterUuid,
                           sceneUuid, characterId, sceneId);
}

async function descriptionResult(
    query: string, modality: string,
    ctx: ScfContext, characterUuid: string, sceneUuid: string,
    characterId: number, sceneId: number,
): Promise<QueryResult<Q05Result>> {
  const resolved = await resolveDescription(ctx, characterId, sceneId,
                                            modality);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  return envelope(query, ctx.registry,
    { character: characterUuid, scene: sceneUuid },
    {
      modality: resolved.modality,
      baseline: resolved.profile === null
        ? null : projectRow(resolved.profile, refs(ctx, "vocal_profile"), lookup),
      states: resolved.states.map(
        (s) => projectRow(s, refs(ctx, "performance_state"), lookup)),
      modulations: resolved.modulations,
      beats: resolved.beats.map((b) => projectRow(b, refs(ctx, "performance_beat"), lookup)),
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
  return directionResult(
    "Q07", shotId === null ? Q07_SCENE_LEAF : Q07_SHOT_LEAF,
    ctx, sceneUuid, sceneId, shotUuid, shotId);
}

/** Q08 — Soundscape (§12.7). */
export const Q08_LEAF = "scene_music_design";

/**
 * Q08 takes no shot: sound is authored at the scene, and there is no
 * shot-level sound entity to be a leaf. §12.7 says so rather than
 * leaving an implementer to discover it by finding nothing.
 */
export async function q08Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
): Promise<QueryResult<Q07Result>> {
  return directionResult("Q08", Q08_LEAF, ctx, sceneUuid, sceneId,
                         null, null);
}

async function directionResult(
    query: string, leaf: string,
    ctx: ScfContext, sceneUuid: string, sceneId: number,
    shotUuid: string | null, shotId: number | null,
): Promise<QueryResult<Q07Result>> {
  const layers = await resolveDirection(ctx, leaf, sceneId, shotId);

  // Every entity in the chain, so a layer's own references resolve.
  const entities = [...new Set(layers.map(([entity]) => entity))];
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  const refs: Record<string, string> = {
    scene_id: "scene", shot_id: "shot",
    project_id: "project", sequence_id: "sequence",
  };

  return envelope(query, ctx.registry,
    { scene: sceneUuid, shot: shotUuid },
    {
      leaf,
      layers: layers.map(([entity, row]) => ({
        entity, row: projectRow(row, refs, lookup),
      })),
    });
}

// ---------------------------------------------------------------------------
// Composition — Q03 and Q12
//
// Q05 and Q07 could wrap `resolveDescription` and `resolveDirection`
// because the composing already lived in the core. Q03 and Q12 composed
// in the app's runner, which meant a normative result would have had to
// re-derive "who is present at a position and what is true of them" a
// second time. That is the failure this project keeps designing against,
// so the composition moved here instead: the core composes ROWS, the
// runner renders them, and the result projects them. One derivation,
// two consumers.
// ---------------------------------------------------------------------------

import { q } from "./db.ts";
import type { Row, SqlValue } from "./db.ts";
import {
  motifStateAt, propStateAt, relationshipStateAt, rows, sceneOrder,
  selectLocationVariant, statesInForce,
} from "./resolution.ts";

const asId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface Q03Composition {
  scene: Row | null;
  characters: Array<{ character: Row; states: Row[]; costumes: Row[] }>;
  props: Array<{ prop: Row; state: Row | null }>;
  motifs: Row[];
}

/** Everything true at one position. Rows, not a result. */
export async function composeQ03(
    ctx: ScfContext, sceneId: number): Promise<Q03Composition> {
  const order = await sceneOrder(ctx);
  const scene = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0]
    ?? null;

  const characters: Q03Composition["characters"] = [];
  for (const link of await rows(ctx.exec, "scene_character",
                                "scene_id = ?", [sceneId])) {
    const cid = asId(link["character_id"]);
    if (cid === null) continue;
    const character = (await rows(ctx.exec, "character", "id = ?",
                                  [cid]))[0];
    if (character === undefined) continue;
    characters.push({
      character,
      states: await statesInForce(ctx, cid, sceneId, null, order),
      costumes: await ctx.exec(
        "SELECT c.* FROM costume_scene cs JOIN costume c " +
        "ON c.id = cs.costume_id WHERE cs.scene_id = ? " +
        "AND c.character_id = ?", [sceneId, cid]),
    });
  }

  const props: Q03Composition["props"] = [];
  for (const link of await rows(ctx.exec, "scene_prop", "scene_id = ?",
                                [sceneId])) {
    const pid = asId(link["prop_id"]);
    if (pid === null) continue;
    const prop = (await rows(ctx.exec, "prop", "id = ?", [pid]))[0];
    if (prop === undefined) continue;
    props.push({ prop, state: await propStateAt(ctx, pid, sceneId, order) });
  }

  const motifs = await ctx.exec(
    "SELECT m.name, a.domain, a.id FROM motif_appearance a " +
    "JOIN motif m ON m.id = a.motif_id WHERE a.scene_id = ?", [sceneId]);

  return { scene, characters, props, motifs };
}

export interface Q12Composition {
  a: Row | null;
  b: Row | null;
  characters: Array<{ character: Row; statesA: string[]; statesB: string[] }>;
  relationships: Array<{
    relationship: Row; stageA: string | null; stageB: string | null;
  }>;
  props: Array<{ prop: Row; whereA: string | null; whereB: string | null }>;
}

/** The state diff between two positions. Rows, not a result. */
export async function composeQ12(
    ctx: ScfContext, a: number, b: number): Promise<Q12Composition> {
  const order = await sceneOrder(ctx);
  const sceneA = (await rows(ctx.exec, "scene", "id = ?", [a]))[0] ?? null;
  const sceneB = (await rows(ctx.exec, "scene", "id = ?", [b]))[0] ?? null;

  const characters: Q12Composition["characters"] = [];
  for (const c of await ctx.exec(
      "SELECT DISTINCT character_id FROM scene_character " +
      "WHERE scene_id IN (?, ?)", [a, b])) {
    const cid = asId(c["character_id"]);
    if (cid === null) continue;
    const character = (await rows(ctx.exec, "character", "id = ?",
                                  [cid]))[0];
    if (character === undefined) continue;
    characters.push({
      character,
      statesA: (await statesInForce(ctx, cid, a, null, order))
        .map((s) => String(s["name"])),
      statesB: (await statesInForce(ctx, cid, b, null, order))
        .map((s) => String(s["name"])),
    });
  }

  const relationships: Q12Composition["relationships"] = [];
  for (const rel of await rows(ctx.exec, "character_relationship")) {
    const rid = asId(rel["id"]);
    if (rid === null) continue;
    const sa = await relationshipStateAt(ctx, rid, a, order);
    const sb = await relationshipStateAt(ctx, rid, b, order);
    if (sa === null && sb === null) continue;
    relationships.push({
      relationship: rel,
      stageA: sa === null ? null : String(sa["stage_label"] ?? ""),
      stageB: sb === null ? null : String(sb["stage_label"] ?? ""),
    });
  }

  const props: Q12Composition["props"] = [];
  for (const prop of await rows(ctx.exec, "prop")) {
    const pid = asId(prop["id"]);
    if (pid === null) continue;
    const pa = await propStateAt(ctx, pid, a, order);
    const pb = await propStateAt(ctx, pid, b, order);
    if (pa === null && pb === null) continue;
    props.push({
      prop,
      whereA: pa === null ? null : String(pa["whereabouts"] ?? ""),
      whereB: pb === null ? null : String(pb["whereabouts"] ?? ""),
    });
  }

  return { a: sceneA, b: sceneB, characters, relationships, props };
}

// ---------------------------------------------------------------------------
// Q03 — World state (§12.4)
// ---------------------------------------------------------------------------

export interface Q03Result {
  scene: ProjectedRow | null;
  characters: Array<{
    character: ProjectedRow;
    states: ProjectedRow[];
    costumes: ProjectedRow[];
  }>;
  props: Array<{ prop: ProjectedRow; state: ProjectedRow | null }>;
  motifs: Array<{ name: string; domain: string | null }>;
}


export async function q03Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
): Promise<QueryResult<Q03Result>> {
  const c = await composeQ03(ctx, sceneId);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  return envelope("Q03", ctx.registry, { scene: sceneUuid }, {
    scene: c.scene === null ? null : projectRow(c.scene, refs(ctx, "scene"), lookup),
    characters: c.characters.map((x) => ({
      character: projectRow(x.character, refs(ctx, "character"), lookup),
      states: x.states.map((s) => projectRow(s, refs(ctx, "performance_state"), lookup)),
      costumes: x.costumes.map((s) => projectRow(s, refs(ctx, "costume"), lookup)),
    })),
    props: c.props.map((x) => ({
      prop: projectRow(x.prop, refs(ctx, "prop"), lookup),
      state: x.state === null
        ? null : projectRow(x.state, refs(ctx, "prop_state"), lookup),
    })),
    // Motifs arrive from a join, not a table, so they carry no identity
    // of their own here — name and domain are the whole fact.
    motifs: c.motifs.map((m) => ({
      name: String(m["name"]),
      domain: m["domain"] === null || m["domain"] === undefined
        ? null : String(m["domain"]),
    })),
  });
}

// ---------------------------------------------------------------------------
// Q12 — Continuity (§12.5)
// ---------------------------------------------------------------------------

export interface Q12Result {
  from: ProjectedRow | null;
  to: ProjectedRow | null;
  characters: Array<{
    character: ProjectedRow; statesFrom: string[]; statesTo: string[];
  }>;
  relationships: Array<{
    relationship: ProjectedRow;
    stageFrom: string | null; stageTo: string | null;
  }>;
  props: Array<{
    prop: ProjectedRow; whereFrom: string | null; whereTo: string | null;
  }>;
}


export async function q12Result(
    ctx: ScfContext, fromUuid: string, toUuid: string,
    fromId: number, toId: number,
): Promise<QueryResult<Q12Result>> {
  const c = await composeQ12(ctx, fromId, toId);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  return envelope("Q12", ctx.registry, { from: fromUuid, to: toUuid }, {
    from: c.a === null ? null : projectRow(c.a, refs(ctx, "scene"), lookup),
    to: c.b === null ? null : projectRow(c.b, refs(ctx, "scene"), lookup),
    characters: c.characters.map((x) => ({
      character: projectRow(x.character, refs(ctx, "character"), lookup),
      statesFrom: x.statesA, statesTo: x.statesB,
    })),
    relationships: c.relationships.map((x) => ({
      relationship: projectRow(x.relationship, refs(ctx, "character_relationship"), lookup),
      stageFrom: x.stageA, stageTo: x.stageB,
    })),
    props: c.props.map((x) => ({
      prop: projectRow(x.prop, refs(ctx, "prop"), lookup),
      whereFrom: x.whereA, whereTo: x.whereB,
    })),
  });
}

// ---------------------------------------------------------------------------
// Q13 — Media resolution (§12.8)
// ---------------------------------------------------------------------------

export interface Q13Reference {
  /** The asset's identity. Never its row id — §12.1.2. */
  uuid: string | null;
  name: string | null;
  /** For an anchor, the anchor's own name. Null otherwise. */
  anchorName: string | null;
  identifier: string | null;
  format: string | null;
  role: string | null;
  intent: string;
  provenance: string;
  state: string;
  /** Why, for anything not `resolved`. */
  detail: string | null;
  sizeBytes: number | null;
}

export interface Q13Result {
  subject: string;
  intent: string;
  /** The cascade trail, most specific first. */
  trail: string[];
  references: Q13Reference[];
  /** How many references landed in each resolution state (§8.3). */
  counts: Record<string, number>;
  /**
   * Whether the answering session had a root mapping at all. Without
   * one every reference is `unaddressed` (§0.3, §8.3), and that is a
   * fact about the session, not about the file.
   */
  rootMapped: boolean;
}

/** Resolves nothing. The state of a `.scf` opened on its own (§0.3). */
const NO_ROOT: FileLocator = async () => undefined;

export async function q13Result(
    ctx: ScfContext, subject: string, subjectUuid: string,
    subjectId: number, intent: string,
    sceneUuid: string | null, sceneId: number | null,
    shotUuid: string | null, shotId: number | null,
    locate: FileLocator = NO_ROOT, rootMapped = false,
): Promise<QueryResult<Q13Result>> {
  const media = await resolveMedia(ctx, subject, subjectId, intent,
                                   sceneId, shotId);
  const refs = await mediaReferences(media, locate);

  return envelope("Q13", ctx.registry, {
    subject: subjectUuid, scene: sceneUuid, shot: shotUuid,
  }, {
    subject,
    intent,
    trail: media.trail,
    references: refs.references.map((r) => ({
      // The uuid comes from the reference itself, never from looking its
      // row id up in a table. That lookup was the defect: an anchor's
      // row id resolved against `asset` returned an unrelated asset that
      // happened to share it, and produced a well-formed uuid, so every
      // portability test passed.
      uuid: r.uuid,
      anchorName: r.anchorName,
      name: r.name,
      identifier: r.identifier,
      format: r.format,
      role: r.role,
      intent: r.intent,
      provenance: r.provenance,
      state: r.state,
      detail: r.detail,
      sizeBytes: r.sizeBytes,
    })),
    counts: { ...refs.summary.counts },
    rootMapped,
  });
}

// ---------------------------------------------------------------------------
// Q14 — Readiness (§12.9)
// ---------------------------------------------------------------------------

export interface Q14Result {
  /** The query this report is about, e.g. "Q05". */
  target: string;
  targetName: string;
  findings: Array<{ severity: string; entity: string; message: string }>;
  counts: Record<string, number>;
}

export async function q14Result(
    ctx: ScfContext, target: string,
    characterUuid: string | null, characterId: number | null,
    sceneUuid: string | null, sceneId: number | null,
    shotUuid: string | null, shotId: number | null,
): Promise<QueryResult<Q14Result>> {
  const report = await readinessReport(ctx, target, {
    character_id: characterId ?? undefined,
    scene_id: sceneId ?? undefined,
    shot_id: shotId ?? undefined,
  });

  // `report.params` carries the row ids it was called with. They do not
  // travel (§6.2), so the envelope carries the uuids instead and the
  // raw params are dropped rather than passed through.
  return envelope("Q14", ctx.registry, {
    target, character: characterUuid, scene: sceneUuid, shot: shotUuid,
  }, {
    target: report.query,
    targetName: report.meta.name,
    findings: report.findings.map((f) => ({
      severity: f.severity, entity: f.entity, message: f.message,
    })),
    counts: { ...report.counts },
  });
}

// ---------------------------------------------------------------------------
// Q09 — Motif manifest (§12.10)
// ---------------------------------------------------------------------------

/**
 * Above this many motifs in one scene, a manifest reports density.
 *
 * It is a HEURISTIC and the result says so: it is not a finding, not a
 * constraint, and not a claim that the scene is wrong. §9.1 — SCF
 * describes. The number lives here rather than in the app because the
 * flag is part of the answer, and two thresholds would be two answers.
 */
export const MOTIF_DENSITY_THRESHOLD = 3;

export interface Q09Result {
  scene: ProjectedRow | null;
  manifest: Array<{
    motif: ProjectedRow | null;
    appearance: ProjectedRow;
    /** The motif's evolved state at this position, by pattern 3. */
    state: ProjectedRow | null;
  }>;
  /** Related motifs NOT placed here — candidates, never obligations. */
  candidates: ProjectedRow[];
  dense: boolean;
  densityThreshold: number;
}


export async function q09Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
): Promise<QueryResult<Q09Result>> {
  const order = await sceneOrder(ctx);
  const scene = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0]
    ?? null;
  const appearances = await rows(ctx.exec, "motif_appearance",
                                 "scene_id = ?", [sceneId]);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  const manifest: Array<{ motif: Row | null; appearance: Row;
                          state: Row | null }> = [];
  const present = new Set<number>();
  for (const appearance of appearances) {
    const mid = asId(appearance["motif_id"]);
    const motif = mid === null
      ? null : (await rows(ctx.exec, "motif", "id = ?", [mid]))[0] ?? null;
    if (mid !== null) present.add(mid);
    manifest.push({
      motif, appearance,
      state: mid === null
        ? null : await motifStateAt(ctx, mid, sceneId, order),
    });
  }

  // If the door is in frame, the chime is a candidate. A related motif
  // already placed here is not a candidate — it is present.
  const candidates: Row[] = [];
  for (const { motif } of manifest) {
    const related = asId(motif?.["related_motif_id"]);
    if (related === null || present.has(related)) continue;
    const r = (await rows(ctx.exec, "motif", "id = ?", [related]))[0];
    if (r !== undefined && !candidates.some((c) => c["id"] === r["id"])) {
      candidates.push(r);
    }
  }

  return envelope("Q09", ctx.registry, { scene: sceneUuid }, {
    scene: scene === null ? null : projectRow(scene, refs(ctx, "scene"), lookup),
    manifest: manifest.map((m) => ({
      motif: m.motif === null
        ? null : projectRow(m.motif, refs(ctx, "motif"), lookup),
      appearance: projectRow(m.appearance, refs(ctx, "motif_appearance"), lookup),
      state: m.state === null
        ? null : projectRow(m.state, refs(ctx, "motif_state"), lookup),
    })),
    candidates: candidates.map((c) => projectRow(c, refs(ctx, "motif"), lookup)),
    dense: manifest.length > MOTIF_DENSITY_THRESHOLD,
    densityThreshold: MOTIF_DENSITY_THRESHOLD,
  });
}

// ---------------------------------------------------------------------------
// Q10 — Thematic accounting (§12.11)
// ---------------------------------------------------------------------------

export interface Q10Result {
  theme: ProjectedRow | null;
  carriers: Array<{
    connection: ProjectedRow;
    /** What carries the theme: an entity kind and that row's uuid. */
    targetEntity: string;
    targetUuid: string | null;
    targetName: string | null;
    /** Scenes this carrier reaches, in story order, as uuids. */
    sceneUuids: string[];
  }>;
  /**
   * Every scene in story order with how many carriers reach it. The
   * zeroes are the point: this query answers "where is this theme NOT",
   * and a spine that only listed the hits could not say.
   */
  spine: Array<{ sceneUuid: string; sceneNumber: string | null;
                 carriers: number }>;
}


export async function q10Result(
    ctx: ScfContext, themeUuid: string, themeId: number,
): Promise<QueryResult<Q10Result>> {
  const order = await sceneOrder(ctx);
  const theme = (await rows(ctx.exec, "theme", "id = ?", [themeId]))[0]
    ?? null;

  const scenes = (await rows(ctx.exec, "scene"))
    .filter((s) => order.has(asId(s["id"]) ?? -1))
    .sort((a, b) => (order.get(asId(a["id"]) ?? -1) ?? 0) -
                    (order.get(asId(b["id"]) ?? -1) ?? 0));

  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  const counts = new Map<number, number>();
  const carriers: Q10Result["carriers"] = [];

  for (const connection of await rows(ctx.exec, "thematic_connection",
                                      "theme_id = ?", [themeId])) {
    const targetEntity = String(connection["entity_type"] ?? "");
    const targetId = asId(connection["entity_id"]);
    let targetName: string | null = null;
    const sceneIds: number[] = [];

    if (targetId !== null && ctx.registry.entities.has(targetEntity)) {
      const target = (await rows(ctx.exec, targetEntity, "id = ?",
                                 [targetId]))[0];
      targetName = target?.["name"] === undefined || target["name"] === null
        ? null : String(target["name"]);

      if (targetEntity === "scene") {
        sceneIds.push(targetId);
      } else if (targetEntity === "motif") {
        for (const a of await rows(ctx.exec, "motif_appearance",
                                   "motif_id = ?", [targetId])) {
          const sid = asId(a["scene_id"]);
          if (sid !== null) sceneIds.push(sid);
        }
      } else if (targetEntity === "character") {
        for (const link of await rows(ctx.exec, "scene_character",
                                      "character_id = ?", [targetId])) {
          const sid = asId(link["scene_id"]);
          if (sid !== null) sceneIds.push(sid);
        }
      }
    }

    // A carrier reaching a cut scene reaches nowhere (§6.6.1), so the
    // spine and the count agree.
    const reached = sceneIds.filter((sid) => order.has(sid));
    for (const sid of reached) counts.set(sid, (counts.get(sid) ?? 0) + 1);

    carriers.push({
      connection: projectRow(connection, refs(ctx, "thematic_connection"), lookup),
      targetEntity,
      targetUuid: lookup(targetEntity, targetId),
      targetName,
      sceneUuids: [...reached]
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
        .map((sid) => lookup("scene", sid) ?? "")
        .filter((u) => u !== ""),
    });
  }

  return envelope("Q10", ctx.registry, { theme: themeUuid }, {
    theme: theme === null ? null : projectRow(theme, refs(ctx, "theme"), lookup),
    carriers,
    spine: scenes.map((s) => {
      const sid = asId(s["id"]) ?? -1;
      return {
        sceneUuid: String(s["uuid"] ?? ""),
        sceneNumber: s["scene_number"] === null ||
                     s["scene_number"] === undefined
          ? null : String(s["scene_number"]),
        carriers: counts.get(sid) ?? 0,
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// Q00 — Brief (§12.12)
// ---------------------------------------------------------------------------

/**
 * The project-level layers a brief reports, in the order it reports
 * them. Broadest first, matching §7.4 — a brief reads as an
 * explanation, not as a ranked answer.
 *
 * A fixed list rather than a derived one, and deliberately so: this is
 * an editorial choice about what a brief IS, not a fact the registry
 * knows. Adding an entity here is a change to §12.12.
 */
export const Q00_LAYERS = [
  "project", "project_vision", "project_tone", "visual_identity",
  "project_color_palette", "cinematographic_philosophy", "sonic_identity",
  "look_development", "costume_design_philosophy", "technical_specs",
] as const;

export interface Q00Result {
  layers: Array<{ entity: string; row: ProjectedRow }>;
  themes: ProjectedRow[];
}

export async function q00Result(
    ctx: ScfContext): Promise<QueryResult<Q00Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const layers: Q00Result["layers"] = [];
  for (const entity of Q00_LAYERS) {
    const row = (await rows(ctx.exec, entity))[0];
    // An unauthored layer is absent, not present and empty (§12.3.2's
    // rule, applied here for the same reason).
    if (row === undefined) continue;
    layers.push({ entity, row: projectRow(row, refs(ctx, entity), lookup) });
  }
  return envelope("Q00", ctx.registry, {}, {
    layers,
    themes: (await rows(ctx.exec, "theme"))
      .map((t) => projectRow(t, refs(ctx, "theme"), lookup)),
  });
}

// ---------------------------------------------------------------------------
// Q11 — Audience state (§12.13)
// ---------------------------------------------------------------------------

export interface Q11Result {
  scene: ProjectedRow | null;
  /** What the audience knows here, if authored. */
  information: ProjectedRow | null;
  identification: {
    row: ProjectedRow;
    primary: ProjectedRow | null;
    secondary: ProjectedRow | null;
  } | null;
  emotionalBeats: Array<{ beat: ProjectedRow; arc: ProjectedRow | null }>;
  toneMarkers: ProjectedRow[];
  /** The emotional-design cascade, root first (§7.4). */
  emotionalCascade: Array<{ entity: string; row: ProjectedRow }>;
}

export async function q11Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
): Promise<QueryResult<Q11Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const one = async (entity: string, id: number | null): Promise<Row | null> =>
    id === null ? null
      : (await rows(ctx.exec, entity, "id = ?", [id]))[0] ?? null;

  /**
   * A table a file does not contain yields nothing, rather than
   * throwing. §9.2 — resolvers stay total, and an older file that
   * predates an entity is not an error.
   */
  const maybe = async (entity: string, where: string,
                       params: SqlValue[]): Promise<Row[]> => {
    try { return await rows(ctx.exec, entity, where, params); }
    catch { return []; }
  };

  const scene = await one("scene", sceneId);
  const information = (await maybe("information_strategy",
                                   "scene_id = ?", [sceneId]))[0] ?? null;

  const identRow = (await maybe("identification_strategy",
                                "scene_id = ?", [sceneId]))[0] ?? null;
  let identification: Q11Result["identification"] = null;
  if (identRow !== null) {
    const primary = await one("character", asId(identRow["primary_character_id"]));
    const secondary = await one("character",
                                asId(identRow["secondary_character_id"]));
    identification = {
      row: projectRow(identRow, refs(ctx, "identification_strategy"), lookup),
      primary: primary === null
        ? null : projectRow(primary, refs(ctx, "character"), lookup),
      secondary: secondary === null
        ? null : projectRow(secondary, refs(ctx, "character"), lookup),
    };
  }

  const emotionalBeats: Q11Result["emotionalBeats"] = [];
  for (const beat of await maybe("emotional_beat", "scene_id = ?",
                                 [sceneId])) {
    const arc = await one("emotional_arc", asId(beat["emotional_arc_id"]));
    emotionalBeats.push({
      beat: projectRow(beat, refs(ctx, "emotional_beat"), lookup),
      arc: arc === null
        ? null : projectRow(arc, refs(ctx, "emotional_arc"), lookup),
    });
  }

  const cascade = await resolveDirection(ctx, Q11_LEAF, sceneId, null);

  return envelope("Q11", ctx.registry, { scene: sceneUuid }, {
    scene: scene === null
      ? null : projectRow(scene, refs(ctx, "scene"), lookup),
    information: information === null
      ? null : projectRow(information, refs(ctx, "information_strategy"),
                          lookup),
    identification,
    emotionalBeats,
    toneMarkers: (await maybe("tone_marker", "scene_id = ?", [sceneId]))
      .map((t) => projectRow(t, refs(ctx, "tone_marker"), lookup)),
    emotionalCascade: cascade.map(([entity, row]) => ({
      entity, row: projectRow(row, refs(ctx, entity), lookup),
    })),
  });
}

/** Q11's cascade leaf (§7.1). */
export const Q11_LEAF = "scene_emotional_design";

// ---------------------------------------------------------------------------
// Q15 — Provenance (§12.14)
// ---------------------------------------------------------------------------

/**
 * Does an `affected_entities` value mention this row?
 *
 * Deliberately permissive, because the column is free-form: it may hold
 * a JSON array, a JSON object, or prose. A note that mentions the right
 * entity in a shape nobody anticipated should still surface — §9.1, SCF
 * describes, and a provenance trail that silently omitted a note would
 * be worse than one that included a doubtful one.
 *
 * Moved into the core in 0.27: Q15 is normative, so its matcher is too.
 * It had lived in the app, which meant an independent implementation had
 * no way to know which conventions counted.
 */
export function mentionsRow(affected: unknown,
                            entityType: string, id: number): boolean {
  if (affected === null || affected === undefined || affected === "") {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(String(affected));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.some((item) => {
      if (typeof item === "string") {
        return item === `${entityType}:${String(id)}` ||
               item === `${entityType}#${String(id)}` || item === entityType;
      }
      if (item !== null && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const t = o["entity"] ?? o["type"] ?? o["entity_type"];
        const i = o["id"] ?? o["entity_id"];
        return t === entityType && (i === undefined || Number(i) === id);
      }
      return false;
    });
  } catch {
    const text = String(affected);
    return text.includes(`${entityType}:${String(id)}`) ||
           text.includes(entityType);
  }
}

export interface Q15Result {
  entityType: string;
  row: ProjectedRow | null;
  /** Oldest first: the row's version chain (§6.1). */
  versionChain: ProjectedRow[];
  attached: { decisions: ProjectedRow[]; notes: ProjectedRow[] };
}

export async function q15Result(
    ctx: ScfContext, entityType: string, rowUuid: string, rowId: number,
    mentions: (affected: unknown, entityType: string, id: number) => boolean,
): Promise<QueryResult<Q15Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const row = (await rows(ctx.exec, entityType, "id = ?", [rowId]))[0]
    ?? null;

  const chain: Row[] = [];
  if (row !== null && ctx.registry.entities.get(entityType)?.versionable) {
    const seen = new Set<number>([rowId]);
    let cursor: Row | undefined = row;
    // Backwards to the root, then forwards, so the chain reads oldest
    // first. A cycle stops the walk rather than hanging it (§9.2).
    const back: Row[] = [];
    while (cursor !== undefined) {
      const pid = asId(cursor["parent_id"]);
      if (pid === null || seen.has(pid)) break;
      seen.add(pid);
      cursor = (await rows(ctx.exec, entityType, "id = ?", [pid]))[0];
      if (cursor !== undefined) back.unshift(cursor);
    }
    chain.push(...back, row);
    cursor = row;
    while (cursor !== undefined) {
      const sid = asId(cursor["superseded_by_id"]);
      if (sid === null || seen.has(sid)) break;
      seen.add(sid);
      cursor = (await rows(ctx.exec, entityType, "id = ?", [sid]))[0];
      if (cursor !== undefined) chain.push(cursor);
    }
  }

  const attach = async (table: string): Promise<Row[]> =>
    (await rows(ctx.exec, table))
      .filter((r) => mentions(r["affected_entities"], entityType, rowId));

  return envelope("Q15", ctx.registry,
    { entityType, row: rowUuid }, {
      entityType,
      row: row === null
        ? null : projectRow(row, refs(ctx, entityType), lookup),
      versionChain: chain.map(
        (r) => projectRow(r, refs(ctx, entityType), lookup)),
      attached: {
        decisions: (await attach("creative_decision"))
          .map((r) => projectRow(r, refs(ctx, "creative_decision"), lookup)),
        notes: (await attach("collaboration_note"))
          .map((r) => projectRow(r, refs(ctx, "collaboration_note"), lookup)),
      },
    });
}

// ---------------------------------------------------------------------------
// The dossier — shared by Q01 and Q02 (§12.15, §12.16)
// ---------------------------------------------------------------------------

export interface DossierGroup { entity: string; rows: Row[] }

export interface DossierComposition {
  subjectType: string;
  subject: Row | null;
  groups: DossierGroup[];
  motifCarriage: Array<{ appearance: Row; motif: Row | null }>;
  thematicConnections: Row[];
}

/**
 * Everything authored about a subject before any scene bends it.
 *
 * The group walk is DERIVED, not listed: every entity whose registry
 * `subject` is this kind, at global scope, carrying a reference back to
 * it. Adding a new entity about characters puts it in every character's
 * dossier with no code change — which is the whole argument for the
 * registry carrying `subject` and `scope` at all.
 *
 * Shared by Q01 and Q02. It lives here rather than in the app for the
 * reason Q03's and Q12's compositions did: a normative result must not
 * re-derive what a renderer already derives.
 */
export async function composeDossier(
    ctx: ScfContext, subjectType: string,
    subjectId: number): Promise<DossierComposition> {
  const subject = (await rows(ctx.exec, subjectType, "id = ?",
                              [subjectId]))[0] ?? null;
  const idField = `${subjectType}_id`;
  const groups: DossierGroup[] = [];

  for (const name of ctx.registry.order) {
    const e = ctx.registry.entities.get(name);
    if (e === undefined || e.subject !== subjectType ||
        e.scope !== "global" || name === subjectType) {
      continue;
    }
    if (!e.fields.some((f) => f.name === idField &&
                              f.fieldType === "reference")) {
      continue;
    }
    const found = await rows(ctx.exec, name, `${q(idField)} = ?`,
                             [subjectId]);
    if (found.length > 0) groups.push({ entity: name, rows: found });
  }

  const motifCarriage: DossierComposition["motifCarriage"] = [];
  for (const appearance of await rows(
      ctx.exec, "motif_appearance", "entity_type = ? AND entity_id = ?",
      [subjectType, subjectId])) {
    const motifId = asId(appearance["motif_id"]);
    motifCarriage.push({
      appearance,
      motif: motifId === null
        ? null : (await rows(ctx.exec, "motif", "id = ?", [motifId]))[0]
          ?? null,
    });
  }

  return {
    subjectType, subject, groups, motifCarriage,
    thematicConnections: await rows(
      ctx.exec, "thematic_connection", "entity_type = ? AND entity_id = ?",
      [subjectType, subjectId]),
  };
}

// ---------------------------------------------------------------------------
// Q01 — Subject dossier (§12.15)
// ---------------------------------------------------------------------------

export interface Q01Result {
  subjectType: string;
  subject: ProjectedRow | null;
  groups: Array<{ entity: string; rows: ProjectedRow[] }>;
  motifCarriage: Array<{
    appearance: ProjectedRow; motif: ProjectedRow | null;
  }>;
  thematicConnections: ProjectedRow[];
}

function projectDossier(
    ctx: ScfContext, d: DossierComposition,
    lookup: UuidLookup): Q01Result {
  return {
    subjectType: d.subjectType,
    subject: d.subject === null
      ? null : projectRow(d.subject, refs(ctx, d.subjectType), lookup),
    groups: d.groups.map((g) => ({
      entity: g.entity,
      rows: g.rows.map((r) => projectRow(r, refs(ctx, g.entity), lookup)),
    })),
    motifCarriage: d.motifCarriage.map((m) => ({
      appearance: projectRow(m.appearance, refs(ctx, "motif_appearance"),
                             lookup),
      motif: m.motif === null
        ? null : projectRow(m.motif, refs(ctx, "motif"), lookup),
    })),
    thematicConnections: d.thematicConnections.map(
      (t) => projectRow(t, refs(ctx, "thematic_connection"), lookup)),
  };
}

export async function q01Result(
    ctx: ScfContext, subjectType: string, subjectUuid: string,
    subjectId: number): Promise<QueryResult<Q01Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  return envelope("Q01", ctx.registry,
    { subjectType, subject: subjectUuid },
    projectDossier(ctx, await composeDossier(ctx, subjectType, subjectId),
                   lookup));
}

// ---------------------------------------------------------------------------
// Q02 — Subject in context (§12.16)
// ---------------------------------------------------------------------------

/**
 * The one place a canonical query genuinely builds on another.
 *
 * §12.1.3 withdrew the assumption that composites nest, because none of
 * them did. Q02's media layer is the exception: it IS Q13's answer at a
 * position, so it carries Q13's result BODY without its envelope, and
 * names the query it came from. Everything else Q02 assembles itself.
 */
export interface Q02Result {
  subjectType: string;
  subject: ProjectedRow | null;
  scene: ProjectedRow | null;
  /** The subject's standing description — Q01's result body. */
  dossier: Q01Result;
  /** Present for a character subject; empty otherwise. */
  costumes: ProjectedRow[];
  relationshipStates: ProjectedRow[];
  performanceStates: ProjectedRow[];
  beats: ProjectedRow[];
  /** Present for a location subject. */
  locationVariant:
    { variant: ProjectedRow | null; mismatches: string[] } | null;
  /** Present for a prop subject. */
  propState: ProjectedRow | null;
  /**
   * Q13's result body, unwrapped, with the query it came from named.
   * `intent` is already part of that body — restating it here would be
   * two places for one fact.
   */
  media: { fromQuery: string } & Q13Result;
}

export async function q02Result(
    ctx: ScfContext, subjectType: string, subjectUuid: string,
    subjectId: number, sceneUuid: string, sceneId: number,
    shotUuid: string | null, shotId: number | null,
): Promise<QueryResult<Q02Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const order = await sceneOrder(ctx);
  const scene = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0]
    ?? null;
  const dossier = await composeDossier(ctx, subjectType, subjectId);

  let costumes: Row[] = [];
  const relationshipStates: Row[] = [];
  let performanceStates: Row[] = [];
  let beats: Row[] = [];
  let locationVariant: Q02Result["locationVariant"] = null;
  let propState: Row | null = null;

  if (subjectType === "character") {
    costumes = await ctx.exec(
      "SELECT c.* FROM costume_scene cs JOIN costume c " +
      "ON c.id = cs.costume_id WHERE cs.scene_id = ? AND c.character_id = ?",
      [sceneId, subjectId]);
    for (const rel of await rows(
        ctx.exec, "character_relationship",
        "character_a_id = ? OR character_b_id = ?",
        [subjectId, subjectId])) {
      const relId = asId(rel["id"]);
      if (relId === null) continue;
      const state = await relationshipStateAt(ctx, relId, sceneId, order);
      if (state !== null) relationshipStates.push(state);
    }
    performanceStates = await statesInForce(ctx, subjectId, sceneId, null,
                                            order);
    beats = await rows(ctx.exec, "performance_beat",
                       "character_id = ? AND scene_id = ?",
                       [subjectId, sceneId]);
  }

  if (subjectType === "location") {
    const [variant, mismatches] = await selectLocationVariant(ctx, sceneId);
    locationVariant = {
      variant: variant === null
        ? null : projectRow(variant, refs(ctx, "location_variant"), lookup),
      mismatches,
    };
  }

  if (subjectType === "prop") {
    propState = await propStateAt(ctx, subjectId, sceneId, order);
  }

  // Nesting, in the one place it is honest.
  const intent = subjectType === "location"
    ? "environment" : "visual_identity";
  const media = await q13Result(ctx, subjectType, subjectUuid, subjectId,
                                intent, sceneUuid, sceneId, shotUuid,
                                shotId);

  return envelope("Q02", ctx.registry, {
    subjectType, subject: subjectUuid, scene: sceneUuid, shot: shotUuid,
  }, {
    subjectType,
    subject: dossier.subject === null
      ? null : projectRow(dossier.subject, refs(ctx, subjectType), lookup),
    scene: scene === null
      ? null : projectRow(scene, refs(ctx, "scene"), lookup),
    dossier: projectDossier(ctx, dossier, lookup),
    costumes: costumes.map((c) => projectRow(c, refs(ctx, "costume"),
                                             lookup)),
    relationshipStates: relationshipStates.map(
      (r) => projectRow(r, refs(ctx, "relationship_state"), lookup)),
    performanceStates: performanceStates.map(
      (r) => projectRow(r, refs(ctx, "performance_state"), lookup)),
    beats: beats.map((b) => projectRow(b, refs(ctx, "performance_beat"),
                                       lookup)),
    locationVariant,
    propState: propState === null
      ? null : projectRow(propState, refs(ctx, "prop_state"), lookup),
    media: { fromQuery: "Q13", ...media.result },
  });
}

// ---------------------------------------------------------------------------
// Q04 — Scene package (§12.17)
// ---------------------------------------------------------------------------

/**
 * The scene-level entities a package reports. Fixed by §12.17 rather
 * than derived, for the reason Q00's layer list is: what belongs in a
 * scene package is an editorial choice, not a fact the registry knows.
 */
export const Q04_DETAIL = [
  "scene_emotional_target", "scene_color_palette", "lighting_design",
  "scene_music_design", "dialogue_sound_design", "set_dressing",
  "tone_marker",
] as const;

export interface Q04Result {
  scene: ProjectedRow | null;
  /** Act and sequence, broadest first. */
  lineage: Array<{ entity: string; row: ProjectedRow }>;
  storyBeats: ProjectedRow[];
  cast: ProjectedRow[];
  props: ProjectedRow[];
  location: ProjectedRow | null;
  locationVariant:
    { variant: ProjectedRow | null; mismatches: string[] };
  detail: Array<{ entity: string; rows: ProjectedRow[] }>;
  blocking: ProjectedRow[];
  stagingBeats: ProjectedRow[];
}

export async function q04Result(
    ctx: ScfContext, sceneUuid: string, sceneId: number,
): Promise<QueryResult<Q04Result>> {
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const scene = (await rows(ctx.exec, "scene", "id = ?", [sceneId]))[0]
    ?? null;

  const lineage: Array<{ entity: string; row: Row }> = [];
  for (const link of await rows(ctx.exec, "scene_sequence", "scene_id = ?",
                                [sceneId])) {
    const seq = (await rows(ctx.exec, "sequence", "id = ?",
                            [asId(link["sequence_id"])]))[0];
    if (seq === undefined) continue;
    const act = (await rows(ctx.exec, "act", "id = ?",
                            [asId(seq["act_id"])]))[0];
    if (act !== undefined) lineage.push({ entity: "act", row: act });
    lineage.push({ entity: "sequence", row: seq });
  }

  const byBeatOrder = (a: Row, b: Row): number =>
    (Number(a["beat_order"]) || 0) - (Number(b["beat_order"]) || 0);

  const storyBeats = (await rows(ctx.exec, "story_beat", "scene_id = ?",
                                 [sceneId])).sort(byBeatOrder);
  const cast = await ctx.exec(
    "SELECT c.* FROM scene_character sc JOIN character c " +
    "ON c.id = sc.character_id WHERE sc.scene_id = ?", [sceneId]);
  const props = await ctx.exec(
    "SELECT p.* FROM scene_prop sp JOIN prop p " +
    "ON p.id = sp.prop_id WHERE sp.scene_id = ?", [sceneId]);

  const locationId = asId(scene?.["location_id"]);
  const location = locationId === null
    ? null
    : (await rows(ctx.exec, "location", "id = ?", [locationId]))[0] ?? null;
  const [variant, mismatches] = await selectLocationVariant(ctx, sceneId);

  const detail: Array<{ entity: string; rows: Row[] }> = [];
  for (const entity of Q04_DETAIL) {
    if (!ctx.registry.entities.has(entity)) continue;
    const found = await rows(ctx.exec, entity, "scene_id = ?", [sceneId]);
    if (found.length > 0) detail.push({ entity, rows: found });
  }

  const blocking = await rows(ctx.exec, "scene_blocking", "scene_id = ?",
                              [sceneId]);
  const stagingBeats: Row[] = [];
  for (const b of blocking) {
    stagingBeats.push(...await rows(ctx.exec, "staging_beat",
                                    "scene_blocking_id = ?",
                                    [asId(b["id"])]));
  }
  stagingBeats.sort(byBeatOrder);

  return envelope("Q04", ctx.registry, { scene: sceneUuid }, {
    scene: scene === null
      ? null : projectRow(scene, refs(ctx, "scene"), lookup),
    lineage: lineage.map((l) => ({
      entity: l.entity, row: projectRow(l.row, refs(ctx, l.entity), lookup),
    })),
    storyBeats: storyBeats.map(
      (b) => projectRow(b, refs(ctx, "story_beat"), lookup)),
    cast: cast.map((c) => projectRow(c, refs(ctx, "character"), lookup)),
    props: props.map((p) => projectRow(p, refs(ctx, "prop"), lookup)),
    location: location === null
      ? null : projectRow(location, refs(ctx, "location"), lookup),
    locationVariant: {
      variant: variant === null
        ? null : projectRow(variant, refs(ctx, "location_variant"), lookup),
      mismatches,
    },
    detail: detail.map((d) => ({
      entity: d.entity,
      rows: d.rows.map((r) => projectRow(r, refs(ctx, d.entity), lookup)),
    })),
    blocking: blocking.map(
      (b) => projectRow(b, refs(ctx, "scene_blocking"), lookup)),
    stagingBeats: stagingBeats.map(
      (b) => projectRow(b, refs(ctx, "staging_beat"), lookup)),
  });
}
