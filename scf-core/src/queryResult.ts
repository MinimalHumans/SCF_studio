/**
 * queryResult.ts — the canonical queries' normative answers. Spec §12.
 *
 * The sixteen canonical queries are part of the format: they are the
 * questions SCF exists to answer, and shipping them is the guidance the
 * format is for. What is normative is the RESULT STRUCTURE, not any
 * rendering of it — markdown is a convenience, and an implementation
 * that produces the right answer in a different presentation is
 * conforming.
 *
 * This module lives in scf-core rather than beside the runners in the
 * app for that reason. The app renders; the core answers.
 *
 * THREE RULES MAKE A RESULT PORTABLE, and all three exist because an
 * independent implementation tripped over their absence:
 *
 *   Rows are referenced by `uuid`, never by row id. Row ids are local to
 *   a file (§6.2) and a writer may renumber them; a uuid survives export
 *   and re-import (§6.1). An expectation carrying `character #1` — as
 *   one blessed artifact did — is pinned to one file's accidents.
 *
 *   Volatile and framework columns are dropped: `id`, `created_at`,
 *   `updated_at`. They differ between two files that say the same thing,
 *   so including them would fail a comparison for reasons unrelated to
 *   correctness.
 *
 *   Reference columns are RESOLVED to uuids: `scene_id` becomes
 *   `scene_uuid`. A result that carried the number would be describing
 *   the file rather than the story.
 *
 * Field names are the registry's own column names. A result is made of
 * registry fields, so inventing a second vocabulary for them would
 * create exactly the drift this format keeps designing against.
 */

import type { Row, SqlExec } from "./db.ts";
import type { Registry } from "./registry.ts";
import { q } from "./db.ts";

/** Columns that never appear in a result. See the header. */
const DROPPED = new Set(["id", "created_at", "updated_at"]);

export interface ProjectedRow {
  /** The row's identity (§6.1). Null only if the row carries none. */
  uuid: string | null;
  /** Authored fields, registry names, nulls and empties omitted. */
  fields: Record<string, unknown>;
}

/**
 * Resolves a row id in some table to that row's uuid. Built once per
 * query rather than per row: a cascade of eight layers pointing at the
 * same scene should not be eight queries.
 */
export interface UuidLookup {
  (entity: string, rowId: number | null): string | null;
}

export async function uuidLookupFor(
    exec: SqlExec, entities: readonly string[]): Promise<UuidLookup> {
  const byEntity = new Map<string, Map<number, string>>();
  for (const entity of entities) {
    const map = new Map<number, string>();
    try {
      for (const r of await exec(`SELECT id, uuid FROM ${q(entity)}`)) {
        const id = Number(r["id"]);
        const uuid = r["uuid"];
        if (Number.isFinite(id) && typeof uuid === "string" && uuid !== "") {
          map.set(id, uuid);
        }
      }
    } catch {
      // Table absent. Total, per §9.2 — a missing table is a finding,
      // not a reason for a query to fail.
    }
    byEntity.set(entity, map);
  }
  return (entity, rowId) =>
    rowId === null ? null : byEntity.get(entity)?.get(rowId) ?? null;
}

const empty = (v: unknown): boolean =>
  v === null || v === undefined || v === "";

/**
 * Project a row into its portable form (§12.1.2).
 *
 * `references` maps a column to the entity it points at, so `scene_id`
 * can become `scene_uuid`. Anything ending `_id` with no mapping is
 * DROPPED rather than emitted raw: a bare row id in a result is the
 * defect this module exists to prevent, and emitting it silently would
 * be worse than losing the field.
 */
export function projectRow(
    row: Row,
    references: Readonly<Record<string, string>> = {},
    lookup: UuidLookup = () => null): ProjectedRow {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    if (DROPPED.has(key) || key === "uuid") continue;
    const value = row[key];

    if (key.endsWith("_id")) {
      const entity = references[key];
      if (entity === undefined) continue;
      const target = empty(value) ? null : Number(value);
      const uuid = lookup(entity, Number.isFinite(target) ? target : null);
      if (uuid !== null) fields[`${key.slice(0, -3)}_uuid`] = uuid;
      continue;
    }

    if (empty(value)) continue;
    fields[key] = value;
  }
  const uuid = row["uuid"];
  return {
    uuid: typeof uuid === "string" && uuid !== "" ? uuid : null,
    fields,
  };
}

/**
 * The envelope every canonical query result carries (§12.1.1).
 *
 * `parameters` records what was ASKED, resolved to uuids, so a result
 * is self-describing: a reader handed one can tell which question it
 * answers without being told.
 */
export interface QueryResult<T> {
  query: string;
  resultFormat: string;
  schemaVersion: string;
  parameters: Record<string, string | null>;
  result: T;
}

/** Bumped when the envelope changes, not when SCF does. */
export const QUERY_RESULT_FORMAT = "1.0";

export function envelope<T>(
    query: string, registry: Registry,
    parameters: Record<string, string | null>, result: T): QueryResult<T> {
  return {
    query,
    resultFormat: QUERY_RESULT_FORMAT,
    schemaVersion: registry.schemaVersion,
    parameters,
    result,
  };
}
