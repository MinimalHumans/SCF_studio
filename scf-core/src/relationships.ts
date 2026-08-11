/**
 * relationships.ts — reading a relationship from both ends.
 *
 * `character_relationship` has no constraint on which character goes in
 * `character_a_id` and no convention about it either, so a consumer that
 * queries one column finds half of a character's relationships and does
 * not know it. conventions §5 has stated the rule — read both columns,
 * never assume a character sits in `character_a_id` — since 2.4, and
 * this is the helper that rule was written for. Every caller that
 * normalises the pair by hand is a place the bug can come back.
 *
 * Note that `character_relationship` is NOT one of the thirteen link
 * entities: its `subject` is `character`, not `link`, so
 * `junctionEntities()` skips it and `duplicateJunctions()` never sees
 * it. That is why §5 singles relationship pairs out as the case where
 * duplication bites, and why the findings below exist separately.
 *
 * `directionality` (2.4) is what makes any of this decidable. `mutual`
 * reads the same either way, so the same pair entered twice is one fact
 * recorded twice. `a_to_b` is directed, so the reverse pair is a
 * different fact and emphatically not a duplicate. Where the column is
 * empty neither judgement can be made, and this module says so rather
 * than picking one.
 *
 * Everything here reports. Nothing merges, rewrites, or deletes.
 */

import { q, type Row, type SqlExec } from "./db.ts";
import type { Registry } from "./registry.ts";

/** The relationship as it reads *from one character's side*. */
export type Direction = "mutual" | "outgoing" | "incoming" | "unspecified";

export interface RelationshipView {
  id: number;
  uuid: string | null;
  /** The row's own name field, where one was authored. */
  name: string | null;
  /** The character the view was requested for. */
  selfId: number;
  otherId: number;
  otherName: string | null;
  /** Raw column value: "mutual", "a_to_b", or null. */
  directionality: string | null;
  /** Resolved for `selfId`: an `a_to_b` row read from B is `incoming`. */
  direction: Direction;
  relationshipType: string | null;
  lifecycleStatus: string | null;
  /** True when this character sits in `character_b_id`. */
  reversed: boolean;
  /** The full authored row, for callers that want the rest of it. */
  row: Row;
}

function str(row: Row, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined || v === "" ? null : String(v);
}

function directionFor(
  directionality: string | null, reversed: boolean,
): Direction {
  if (directionality === "mutual") return "mutual";
  if (directionality === "a_to_b") return reversed ? "incoming" : "outgoing";
  return "unspecified";
}

/**
 * Every relationship a character is part of, from either column,
 * normalised so the caller never touches `character_a_id` directly.
 *
 * A row where both columns name the same character is returned rather
 * than filtered: it is almost certainly a mistake, and dropping it here
 * would hide it from the only code looking.
 */
export async function relationshipsFor(
  exec: SqlExec, _registry: Registry, characterId: number,
): Promise<RelationshipView[]> {
  const rows = await exec(
    `SELECT r.*, ` +
    `  a.name AS _a_name, b.name AS _b_name ` +
    `FROM ${q("character_relationship")} r ` +
    `LEFT JOIN ${q("character")} a ON a.id = r.character_a_id ` +
    `LEFT JOIN ${q("character")} b ON b.id = r.character_b_id ` +
    `WHERE r.character_a_id = ? OR r.character_b_id = ? ` +
    `ORDER BY r.id`,
    [characterId, characterId]);

  return rows.map((row) => {
    const aId = row["character_a_id"] === null ||
                row["character_a_id"] === undefined
      ? null : Number(row["character_a_id"]);
    const reversed = aId !== characterId;
    const otherRaw = reversed ? row["character_a_id"] : row["character_b_id"];
    const directionality = str(row, "directionality");

    const clean: Row = { ...row };
    delete clean["_a_name"];
    delete clean["_b_name"];

    return {
      id: Number(row["id"]),
      uuid: str(row, "uuid"),
      name: str(row, "name"),
      selfId: characterId,
      otherId: otherRaw === null || otherRaw === undefined
        ? -1 : Number(otherRaw),
      otherName: reversed ? str(row, "_a_name") : str(row, "_b_name"),
      directionality,
      direction: directionFor(directionality, reversed),
      relationshipType: str(row, "relationship_type"),
      lifecycleStatus: str(row, "lifecycle_status"),
      reversed,
      row: clean,
    };
  });
}

export type RelationshipFindingKind =
  | "duplicate-pair"
  | "contradictory-pair"
  | "self-pair"
  | "missing-directionality"
  | "missing-endpoint";

export interface RelationshipFinding {
  kind: RelationshipFindingKind;
  rowIds: number[];
  characterIds: number[];
  message: string;
}

/** Unordered key: the pair regardless of which column each sits in. */
function pairKey(a: number, b: number): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * What is wrong with the relationship table, said out loud.
 *
 * The judgement that matters is which repeats are duplicates. Two
 * `mutual` rows for one pair are one fact recorded twice, and a reader
 * taking the first finds half its authored content. Two `a_to_b` rows in
 * opposite directions are two different facts and are left alone. A pair
 * described once as mutual and once as directed contradicts itself and
 * no tool can pick the winner.
 *
 * Findings, never constraints: a unique index could not make any of
 * these calls, which is exactly why they live here.
 */
export async function relationshipFindings(
  exec: SqlExec, _registry: Registry,
): Promise<RelationshipFinding[]> {
  const rows = await exec(
    `SELECT id, character_a_id, character_b_id, directionality ` +
    `FROM ${q("character_relationship")} ORDER BY id`);
  const characters = await exec(`SELECT id FROM ${q("character")}`);
  const known = new Set(characters.map((c) => Number(c["id"])));

  const out: RelationshipFinding[] = [];
  const byPair = new Map<string, {
    id: number; a: number; b: number; directionality: string | null;
  }[]>();

  for (const row of rows) {
    const id = Number(row["id"]);
    const aRaw = row["character_a_id"];
    const bRaw = row["character_b_id"];
    const a = aRaw === null || aRaw === undefined ? -1 : Number(aRaw);
    const b = bRaw === null || bRaw === undefined ? -1 : Number(bRaw);
    const directionality = str(row, "directionality");

    const missing = [a, b].filter((c) => c === -1 || !known.has(c));
    if (missing.length > 0) {
      out.push({
        kind: "missing-endpoint", rowIds: [id], characterIds: missing,
        message: `relationship #${id} points at a character that is not ` +
                 `in this file`,
      });
      continue;
    }

    if (a === b) {
      out.push({
        kind: "self-pair", rowIds: [id], characterIds: [a],
        message: `relationship #${id} names the same character on both ` +
                 `sides`,
      });
      continue;
    }

    if (directionality === null) {
      out.push({
        kind: "missing-directionality", rowIds: [id], characterIds: [a, b],
        message: `relationship #${id} has no directionality, so nothing ` +
                 `can tell a duplicate of it from a directed fact`,
      });
    }

    const key = pairKey(a, b);
    byPair.set(key, [...(byPair.get(key) ?? []),
                     { id, a, b, directionality }]);
  }

  for (const [, group] of byPair) {
    if (group.length < 2) continue;
    const [first] = group;
    if (first === undefined) continue;

    const mutual = group.filter((g) => g.directionality === "mutual");
    const directed = group.filter((g) => g.directionality === "a_to_b");

    if (mutual.length > 1) {
      out.push({
        kind: "duplicate-pair",
        rowIds: mutual.map((g) => g.id),
        characterIds: [first.a, first.b],
        message: `${mutual.length} mutual rows describe the same pair; ` +
                 `their authored content is split between them`,
      });
    }

    // Same direction twice is a duplicate; opposite directions are two
    // legitimate facts (A mentors B, B confides in A).
    const seen = new Map<string, number[]>();
    for (const g of directed) {
      const ordered = `${g.a}->${g.b}`;
      seen.set(ordered, [...(seen.get(ordered) ?? []), g.id]);
    }
    for (const [ordered, ids] of seen) {
      if (ids.length > 1) {
        out.push({
          kind: "duplicate-pair", rowIds: ids,
          characterIds: [first.a, first.b],
          message: `${ids.length} directed rows describe ${ordered}; ` +
                   `their authored content is split between them`,
        });
      }
    }

    if (mutual.length > 0 && directed.length > 0) {
      out.push({
        kind: "contradictory-pair",
        rowIds: group.map((g) => g.id),
        characterIds: [first.a, first.b],
        message: `this pair is described as mutual on one row and ` +
                 `directed on another; the two cannot both be true`,
      });
    }
  }

  return out.sort((x, y) => (x.rowIds[0] ?? 0) - (y.rowIds[0] ?? 0));
}
