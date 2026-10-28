// SPDX-License-Identifier: Apache-2.0
/**
 * auditTarget.ts — which row a write touched, and what changed in it.
 *
 * The audit trail wants "everything that happened to this character",
 * but a write names its row by a numeric id (and the window's calls by
 * position), never by uuid. So for the writes that address one row, the
 * host reads that row before and after and records its uuid and a
 * field-by-field before/after. Writes that address no single row
 * (importing a script, committing the screenplay) have no target; the
 * trail still records that they happened.
 *
 * Reads go through the host's read-only connection. Nothing here writes,
 * and a failure to read only costs the detail, never the write.
 */

import { q, rowLabel, type Registry, type Row, type SqlExec }
  from "@minimalhumans/scf-core";

/** The write, reduced to the row it addresses. */
export interface TargetPlan {
  kind: "create" | "update" | "delete" | "field";
  entity: string;
  /** Null for a create, whose row exists only after the write. */
  id: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);

/**
 * The row a write addresses, from how it was called: by name with an
 * argument object (`op`), or by position (`call`). Null when the write
 * addresses no single row.
 */
export function planTarget(
    registry: Registry, via: "op" | "call", name: string,
    args: unknown): TargetPlan | null {
  const known = (entity: unknown): entity is string =>
    typeof entity === "string" && registry.entities.has(entity);
  if (via === "op") {
    if (!isRecord(args)) return null;
    const { entity, id } = args;
    if (name === "record.create" && known(entity)) {
      return { kind: "create", entity, id: null };
    }
    if (name === "record.update" && known(entity) && isId(id)) {
      return { kind: "update", entity, id };
    }
    if (name === "record.delete" && known(entity) && isId(id)) {
      return { kind: "delete", entity, id };
    }
    return null;
  }
  if (!Array.isArray(args)) return null;
  const [entity, id] = args as unknown[];
  switch (name) {
    case "record.create":
      return known(entity) ? { kind: "create", entity, id: null } : null;
    case "record.update":
      return known(entity) && isId(id)
        ? { kind: "update", entity, id } : null;
    case "record.delete":
      return known(entity) && isId(id)
        ? { kind: "delete", entity, id } : null;
    case "element.setField":
    case "shoot.updateField":
      return known(entity) && isId(id) ? { kind: "field", entity, id } : null;
    default:
      return null;
  }
}

/** One row by id, or null when there is none (or no such column). */
export async function readRow(
    exec: SqlExec, registry: Registry, entity: string,
    id: number): Promise<Row | null> {
  if (!registry.entities.has(entity)) return null;
  try {
    const rows = await exec(
      `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

const VALUE_MAX = 80;

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "∅";
  const text = typeof v === "string" ? v
    : v instanceof Uint8Array ? `${String(v.length)} bytes` : String(v);
  const flat = text.replace(/\s+/g, " ");
  return JSON.stringify(
    flat.length > VALUE_MAX ? `${flat.slice(0, VALUE_MAX)}…` : flat);
}

const same = (a: unknown, b: unknown): boolean =>
  (a ?? null) === (b ?? null) || (a === "" && b === null) ||
  (a === null && b === "") || String(a) === String(b);

/** `field: "old" → "new"` for each authored field that differs. */
export function fieldChanges(
    registry: Registry, entity: string, before: Row, after: Row): string[] {
  const edef = registry.entities.get(entity);
  if (edef === undefined) return [];
  return edef.fields
    .filter((f) => !f.autoInjected && f.name in before && f.name in after &&
                   !same(before[f.name], after[f.name]))
    .map((f) => `${f.name}: ${show(before[f.name])} → ${show(after[f.name])}`);
}

export interface TargetFacts {
  entity: string;
  uuid: string | null;
  summary: string;
}

/**
 * What to record about the row once the write has settled. `before` was
 * read ahead of the write; `after` is read now (null for a delete, or if
 * the write failed and nothing is there to read).
 */
export function describeTarget(
    registry: Registry, plan: TargetPlan, before: Row | null,
    after: Row | null): TargetFacts {
  const edef = registry.entities.get(plan.entity);
  const row = after ?? before;
  const uuid = typeof row?.["uuid"] === "string" ? row["uuid"] : null;
  const label = row === null ? `#${String(plan.id)}`
    : JSON.stringify(rowLabel(edef, plan.entity, row));
  const what = `${plan.entity} ${label}`;
  switch (plan.kind) {
    case "create":
      return { entity: plan.entity, uuid,
               summary: after === null ? `create ${plan.entity}`
                 : `created ${what}` };
    case "delete":
      return { entity: plan.entity, uuid, summary: `deleted ${what}` };
    default: {
      if (before === null || after === null) {
        return { entity: plan.entity, uuid, summary: `changed ${what}` };
      }
      const changes = fieldChanges(registry, plan.entity, before, after);
      return {
        entity: plan.entity, uuid,
        summary: changes.length === 0 ? `${what}: no field changed`
          : `${what} — ${changes.join("; ")}`,
      };
    }
  }
}
