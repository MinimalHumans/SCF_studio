// SPDX-License-Identifier: Apache-2.0
/**
 * structure.ts — acts and sequences as contiguous spans over the scene
 * order, derived from a single anchor each.
 *
 * An act BEGINS at a scene and runs until the next act begins. Nothing
 * stores an end, which is what makes the model safe: overlaps and gaps
 * are inexpressible, a scene inserted mid-act joins it automatically,
 * and there is no end anchor to drift. The boundary is the stored fact;
 * membership is a view over it, so `act.start_scene_id` plus the scene
 * order is a complete description — nothing here writes back.
 *
 * Accepted limitation: a span cannot be non-contiguous, so an
 * interleaved cross-cut sequence is inexpressible. Supporting one needs
 * enumerated membership, which means replacing this model rather than
 * patching it.
 *
 * Everything here is pure: rows in, structure out, no SQL.
 */

import type { Row } from "./db.ts";
import {
  compareSceneNumbers, sceneNumberOrderJoin, sceneNumberOrderTerms,
} from "./sceneNumbers.ts";

export interface ScenePosition {
  id: number;
  /** 0-based index in story order. */
  index: number;
  /**
   * The authored scene number, as written. A LABEL (spec §4.2), so
   * `12A` and `A12` arrive intact rather than as NaN.
   */
  number: string | null;
  name: string;
}

export interface Span {
  /** Row id of the act or sequence. */
  id: number;
  name: string;
  /** Authored label (act_number / sequence_number), not the order. */
  number: number | null;
  /** Scene the span is anchored to. */
  startSceneId: number;
  /** 0-based scene index the span starts at. */
  startIndex: number;
  /** 0-based scene index it ends at, inclusive. */
  endIndex: number;
  /** Scene ids in the span, in story order. */
  sceneIds: number[];
}

export interface Structure {
  scenes: ScenePosition[];
  acts: Span[];
  sequences: Span[];
  /** sceneId -> act row id. */
  actOfScene: Map<number, number>;
  /** sceneId -> sequence row id. */
  sequenceOfScene: Map<number, number>;
  /**
   * Scenes before the first act boundary. Legal — a cold open — but the
   * outline has to put them somewhere and validation names them.
   */
  unassignedSceneIds: number[];
}

export type FindingLevel = "warning" | "info";

export interface StructureFinding {
  level: FindingLevel;
  /** Stable code for tests and UI grouping. */
  code: string;
  entity: "act" | "sequence" | "scene";
  rowId: number | null;
  message: string;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/**
 * A scene number is a LABEL (spec §4.2), carried as written. Not
 * coerced with Number(): `12A` is a valid label and would become NaN.
 */
const label = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === ""
    ? null : String(v).trim();

/**
 * Story order.
 *
 * When a screenplay exists, the SCRIPT is the order — `orderHint` maps a
 * scene id to the position of the heading that carries it. The
 * scene_number-then-id fallback is only correct for a project not yet
 * written: a blank-written project numbers nothing, so that path
 * degrades to insertion order, and moving a scene changes no derived
 * view because nothing it reads has moved.
 *
 * Scenes with no heading (outlined, not yet written) keep the fallback
 * and sort after everything the script places, which is where an
 * unwritten scene belongs in a story order.
 */
export function scenePositions(
    scenes: Row[],
    orderHint?: ReadonlyMap<number, number>): ScenePosition[] {
  const placed = (id: number): number | null =>
    orderHint?.get(id) ?? null;
  return [...scenes]
    .map((s) => ({
      id: Number(s["id"]),
      number: label(s["scene_number"]),
      name: String(s["name"] ?? ""),
    }))
    .sort((a, b) => {
      const pa = placed(a.id);
      const pb = placed(b.id);
      if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      const byNumber = compareSceneNumbers(a.number, b.number);
      if (byNumber !== 0) return byNumber;
      return a.id - b.id;
    })
    .map((s, index) => ({ ...s, index }));
}

/**
 * The SQL twin of `scenePositions`, for the places that list scenes
 * straight from a query rather than through the derivation.
 *
 * Same precedence, deliberately: script position first, then stored
 * number, then id. `scene_number` alone is wrong in both directions — a
 * blank-written project has no numbers, and under
 * `numbering_policy = 'fixed'` the numbers stop tracking the page, so a
 * picker sorted by them shows a different film from the editor.
 *
 * Use as: `SELECT s.* FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`.
 * `storyOrder` below is the general form: anything holding a scene
 * reference — an act's start scene, a beat's scene — can be put in story
 * order the same way, so no view has to invent its own ordering.
 */
export function storyOrder(opts: {
  /** Alias of the table being ordered, e.g. "a" for `FROM act a`. */
  alias: string;
  /** Column on that alias holding a scene id ("id" for scene itself). */
  sceneRef: string;
  /**
   * Order by the scene's number (spec §4.2.2) after script position.
   * Adds a second join, because the label has to be parsed before it
   * can be ordered — see sceneNumbers.ts.
   */
  bySceneNumber?: boolean;
  /** Further tie-breakers, in order, already qualified. */
  fallbacks?: readonly string[];
}): { join: string; orderBy: string } {
  const nulls = (expr: string): string => `(${expr} IS NULL), ${expr}`;
  const ref = `${opts.alias}.${opts.sceneRef}`;
  const terms = [
    nulls("sp.story_pos"),
    ...(opts.bySceneNumber === true ? [sceneNumberOrderTerms("sn")] : []),
    ...(opts.fallbacks ?? []).map(nulls),
    `${opts.alias}.id`,
  ];
  const joins = [
    "LEFT JOIN (SELECT scene_id, MIN(line_order) AS story_pos " +
    "FROM screenplay_lines WHERE line_type = 'heading' " +
    `GROUP BY scene_id) sp ON sp.scene_id = ${ref}`,
    ...(opts.bySceneNumber === true
      ? [sceneNumberOrderJoin(ref, "sn")] : []),
  ];
  return { join: joins.join(" "), orderBy: `ORDER BY ${terms.join(", ")}` };
}

const SCENE_ORDER = storyOrder({
  alias: "s", sceneRef: "id", bySceneNumber: true,
});

export const SCENE_ORDER_JOIN = SCENE_ORDER.join;

export const SCENE_ORDER_BY = SCENE_ORDER.orderBy;

/**
 * Build the hint from screenplay heading rows (`scene_id`, `line_order`).
 * First heading wins: commit enforces one scene per heading, but a
 * half-committed document can briefly show two.
 */
export function sceneOrderHint(headings: Row[]): Map<number, number> {
  const byScene = new Map<number, number>();
  const ordered = [...headings].sort((a, b) =>
    Number(a["line_order"] ?? 0) - Number(b["line_order"] ?? 0));
  let position = 0;
  for (const row of ordered) {
    const sceneId = num(row["scene_id"]);
    if (sceneId === null || byScene.has(sceneId)) continue;
    byScene.set(sceneId, position);
    position += 1;
  }
  return byScene;
}

/**
 * Spans from anchor rows. Rows with no anchor, or an anchor pointing at
 * a scene that is not in the list, produce no span — they exist but
 * appear nowhere, which validation reports rather than the derivation
 * guessing a position for them.
 */
function spansFrom(rows: Row[], numberField: string,
                   positions: ScenePosition[]): Span[] {
  const indexById = new Map(positions.map((s) => [s.id, s.index]));
  const anchored = rows
    .map((r) => {
      const startSceneId = num(r["start_scene_id"]);
      const startIndex = startSceneId === null
        ? undefined : indexById.get(startSceneId);
      return startSceneId === null || startIndex === undefined ? null : {
        id: Number(r["id"]),
        name: String(r["name"] ?? ""),
        number: num(r[numberField]),
        startSceneId,
        startIndex,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // Two spans on the same scene: the lower row id wins the boundary
    // and the other collapses to an empty span. Validation reports it;
    // the derivation stays total rather than throwing.
    .sort((a, b) => a.startIndex - b.startIndex || a.id - b.id);

  return anchored.map((span, i) => {
    const next = anchored[i + 1];
    const endIndex = next === undefined
      ? positions.length - 1 : next.startIndex - 1;
    return {
      ...span,
      endIndex,
      sceneIds: positions
        .slice(span.startIndex, Math.max(span.startIndex, endIndex + 1))
        .map((s) => s.id),
    };
  });
}

export function deriveStructure(
    scenes: Row[], acts: Row[], sequences: Row[],
    orderHint?: ReadonlyMap<number, number>): Structure {
  const positions = scenePositions(scenes, orderHint);
  const actSpans = spansFrom(acts, "act_number", positions);
  const sequenceSpans = spansFrom(sequences, "sequence_number", positions);

  const actOfScene = new Map<number, number>();
  for (const span of actSpans) {
    for (const sceneId of span.sceneIds) actOfScene.set(sceneId, span.id);
  }
  const sequenceOfScene = new Map<number, number>();
  for (const span of sequenceSpans) {
    for (const sceneId of span.sceneIds) {
      sequenceOfScene.set(sceneId, span.id);
    }
  }

  return {
    scenes: positions,
    acts: actSpans,
    sequences: sequenceSpans,
    actOfScene,
    sequenceOfScene,
    unassignedSceneIds: positions
      .filter((s) => !actOfScene.has(s.id)).map((s) => s.id),
  };
}

export interface OutlineGroup {
  /** The sequence covering this run, or null for scenes in none. */
  sequence: Span | null;
  sceneIds: number[];
  /** The sequence began before this act. */
  continuesFrom: boolean;
  /** It carries on past this act. */
  continuesInto: boolean;
}

/**
 * An act's scenes, grouped into the runs of sequence that cover them.
 *
 * Acts and sequences are INDEPENDENT spans, not a hierarchy: a sequence
 * may begin in one act and end in another, which is legal and
 * deliberately unrestricted. Rendering them as nested therefore needs
 * care — grouping by "sequences whose start falls in this act" draws a
 * crossing sequence's later scenes under the wrong act AND again under
 * the right one, so a scene appears twice.
 *
 * Grouping by run instead means a crossing sequence appears in both
 * acts, as the part of it that belongs there, flagged so a renderer can
 * say so.
 */
export function actOutline(structure: Structure, act: Span): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  for (const sceneId of act.sceneIds) {
    const seqId = structure.sequenceOfScene.get(sceneId);
    const sequence = seqId === undefined
      ? null : structure.sequences.find((s) => s.id === seqId) ?? null;
    const last = groups[groups.length - 1];
    if (last !== undefined && (last.sequence?.id ?? null) ===
        (sequence?.id ?? null)) {
      last.sceneIds.push(sceneId);
      continue;
    }
    groups.push({
      sequence, sceneIds: [sceneId],
      continuesFrom: sequence !== null && sequence.sceneIds[0] !== sceneId,
      continuesInto: false,
    });
  }
  for (const group of groups) {
    const seq = group.sequence;
    if (seq === null) continue;
    group.continuesInto =
      seq.sceneIds[seq.sceneIds.length - 1] !==
      group.sceneIds[group.sceneIds.length - 1];
  }
  return groups;
}

/** The act a scene belongs to, or null before the first boundary. */
export function actOf(structure: Structure, sceneId: number): Span | null {
  const id = structure.actOfScene.get(sceneId);
  return structure.acts.find((a) => a.id === id) ?? null;
}

export function sequenceOf(structure: Structure,
                           sceneId: number): Span | null {
  const id = structure.sequenceOfScene.get(sceneId);
  return structure.sequences.find((s) => s.id === id) ?? null;
}

/**
 * What is worth telling the writer. None of it blocks: a half-placed
 * structure is a normal state during an outline pass, not an error.
 */
/**
 * Scenes the screenplay does not contain.
 *
 * The entity survives being cut from the script by design, but then
 * holds no position — no number, no act, no place in any outline. That
 * is a state worth SEEING rather than writing: `status` is authored
 * (outline / draft / revised / locked / cut), and stamping "cut" over it
 * on commit would destroy what the author put there. So orphanhood is
 * derived here and badged; marking a scene `cut` stays the author's act.
 *
 * Only meaningful once a screenplay exists: in a project being outlined,
 * every scene is "not in the script" and saying so is noise. An empty
 * hint means no screenplay, and nothing is reported.
 */
export function orphanedScenes(
    scenes: Row[], orderHint: ReadonlyMap<number, number>): number[] {
  if (orderHint.size === 0) return [];
  return scenes
    .map((s) => Number(s["id"]))
    .filter((id) => !orderHint.has(id));
}

export function structureFindings(
    structure: Structure, acts: Row[], sequences: Row[],
    orderHint?: ReadonlyMap<number, number>): StructureFinding[] {
  const out: StructureFinding[] = [];
  const positioned = new Set(structure.scenes.map((s) => s.id));

  if (orderHint !== undefined && orderHint.size > 0) {
    const nameById = new Map(structure.scenes.map((s) => [s.id, s.name]));
    for (const id of structure.scenes.map((s) => s.id)) {
      if (orderHint.has(id)) continue;
      out.push({ level: "info", code: "not-in-script", entity: "scene",
        rowId: id,
        // A scene absent from the script can still carry a scene_number
        // — the fixture's scene 17 does. What it lacks is a STORY
        // POSITION, which is what §4.1's fallback exists for.
        message: `${nameById.get(id) ?? "scene"} has no heading in the ` +
                 "screenplay, so it has no story position and belongs " +
                 "to no act. It sorts after every scene that does " +
                 "(§4.1). Its record and everything linked to it are " +
                 "untouched." });
    }
  }

  const unanchored = (rows: Row[], entity: "act" | "sequence"): void => {
    for (const r of rows) {
      const start = num(r["start_scene_id"]);
      const label = String(r["name"] ?? entity);
      if (start === null) {
        out.push({ level: "warning", code: "no-boundary", entity,
          rowId: Number(r["id"]),
          message: `${label} has no start scene, so it appears nowhere ` +
                   "in the structure." });
      } else if (!positioned.has(start)) {
        out.push({ level: "warning", code: "dangling-boundary", entity,
          rowId: Number(r["id"]),
          message: `${label} starts at a scene that no longer exists.` });
      }
    }
  };
  unanchored(acts, "act");
  unanchored(sequences, "sequence");

  // Two spans of the same kind on one scene: one of them is empty.
  const collide = (spans: Span[], entity: "act" | "sequence"): void => {
    const seen = new Map<number, Span>();
    for (const span of spans) {
      const first = seen.get(span.startIndex);
      if (first !== undefined) {
        out.push({ level: "warning", code: "shared-boundary", entity,
          rowId: span.id,
          message: `${span.name} and ${first.name} both start at the ` +
                   "same scene, so one of them contains nothing." });
      } else seen.set(span.startIndex, span);
    }
  };
  collide(structure.acts, "act");
  collide(structure.sequences, "sequence");

  // A sequence whose SPAN crosses an act boundary.
  //
  // Membership is derived per §5.1 and every scene in the span tested.
  // Testing the START SCENE alone — whether the stored `act_id` matches
  // the act derived for the sequence's first scene — is a different
  // condition, and is the comparison §5.3 explicitly calls incorrect:
  // "Grouping by 'sequences whose start falls in this act' is
  // incorrect." It also misses the fixture's own crossing, which is
  // filed under act 2, starts in act 2, and runs on into act 3.
  //
  // §5.3 says a crossing is LEGAL and MUST NOT be rejected, which is
  // why the catalog rates it `info`: it is a note to whoever presents
  // acts and sequences as nested, who has to split the sequence into
  // per-act runs.
  const actByRow = new Map(structure.acts.map((a) => [a.id, a]));
  for (const span of structure.sequences) {
    const acts = new Set<number>();
    for (const sceneId of span.sceneIds) {
      const act = structure.actOfScene.get(sceneId);
      if (act !== undefined) acts.add(act);
    }
    if (acts.size <= 1) continue;
    const names = [...acts]
      .map((id) => actByRow.get(id)?.name ?? `act ${String(id)}`)
      .join(" and ");
    out.push({ level: "info", code: "act-mismatch", entity: "sequence",
      rowId: span.id,
      message: `${span.name} spans ${names}. That is legal (§5.3); a ` +
               "presenter showing acts and sequences as nested must " +
               "split it into the part belonging to each." });
  }

  // A boundary on an unnumbered scene sorts after every numbered one.
  const unnumbered = new Set(structure.scenes
    .filter((s) => s.number === null).map((s) => s.id));
  for (const span of [...structure.acts, ...structure.sequences]) {
    if (unnumbered.has(span.startSceneId)) {
      out.push({ level: "info", code: "unnumbered-boundary",
        entity: "act", rowId: span.id,
        message: `${span.name} starts at an unnumbered scene, which ` +
                 "sorts after every numbered one." });
    }
  }

  if (structure.unassignedSceneIds.length > 0 && structure.acts.length > 0) {
    out.push({ level: "info", code: "scenes-before-first-act",
      entity: "scene", rowId: null,
      message: `${String(structure.unassignedSceneIds.length)} scene(s) ` +
               "come before the first act begins." });
  }
  return out;
}
