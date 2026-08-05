/**
 * structure.ts — acts and sequences as contiguous spans over the scene
 * order, derived from a single anchor each.
 *
 * An act BEGINS at a scene and runs until the next act begins. Nothing
 * stores an end. That one choice is what makes the model safe:
 * overlaps and gaps are impossible to express, a scene inserted mid-act
 * joins it automatically, and there is no end anchor to drift out of
 * sync when scenes move. The stored fact is the boundary; membership is
 * a view over it, so a file carrying `act.start_scene_id` plus the
 * scene order is complete — nothing here needs writing back.
 *
 * The price, accepted deliberately: a span cannot be non-contiguous, so
 * a cross-cut sequence interleaved with another cannot be expressed. If
 * that requirement ever arrives, enumerated membership is the only
 * model that supports it and this one has to be replaced rather than
 * patched.
 *
 * Everything here is pure: rows in, structure out, no SQL.
 */

import type { Row } from "./db.ts";

export interface ScenePosition {
  id: number;
  /** 0-based index in story order. */
  index: number;
  number: number | null;
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
 * Story order, matching the ordering used everywhere else in the app:
 * numbered scenes first by number, then unnumbered ones by id.
 */
export function scenePositions(scenes: Row[]): ScenePosition[] {
  return [...scenes]
    .map((s) => ({
      id: Number(s["id"]),
      number: num(s["scene_number"]),
      name: String(s["name"] ?? ""),
    }))
    .sort((a, b) => {
      if ((a.number === null) !== (b.number === null)) {
        return a.number === null ? 1 : -1;
      }
      if (a.number !== null && b.number !== null && a.number !== b.number) {
        return a.number - b.number;
      }
      return a.id - b.id;
    })
    .map((s, index) => ({ ...s, index }));
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

export function deriveStructure(scenes: Row[], acts: Row[],
                                sequences: Row[]): Structure {
  const positions = scenePositions(scenes);
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
 * care — a naive "sequences whose start falls in this act" grouping
 * draws a crossing sequence's later scenes under the wrong act AND
 * again under the right one, which is how the demo came to show scene
 * 19 twice.
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
export function structureFindings(
    structure: Structure, acts: Row[], sequences: Row[]): StructureFinding[] {
  const out: StructureFinding[] = [];
  const positioned = new Set(structure.scenes.map((s) => s.id));

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

  // A stored act_id that disagrees with where the boundary puts it.
  // The authored field wins; the finding reports the disagreement
  // rather than silently picking a side.
  const actByRow = new Map(structure.acts.map((a) => [a.id, a]));
  for (const r of sequences) {
    const storedAct = num(r["act_id"]);
    if (storedAct === null) continue;
    const span = structure.sequences.find((s) => s.id === Number(r["id"]));
    if (span === undefined) continue;
    const derived = structure.actOfScene.get(span.startSceneId);
    if (derived !== undefined && derived !== storedAct) {
      out.push({ level: "warning", code: "act-mismatch", entity: "sequence",
        rowId: span.id,
        message: `${span.name} is filed under ` +
                 `${actByRow.get(storedAct)?.name ?? "an act"} but starts ` +
                 `inside ${actByRow.get(derived)?.name ?? "another act"}.` });
    }
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
