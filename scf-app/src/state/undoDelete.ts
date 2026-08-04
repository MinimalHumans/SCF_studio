/**
 * undoDelete.ts — make a delete recoverable.
 *
 * Deleting a sequence used to be final and silent, and it takes its
 * scene_sequence rows with it. So a delete first captures the row AND
 * the rows that point at it, and the toast puts them back with their
 * original ids and uuids — the ids matter, because anything else
 * pointing at the row would otherwise be restored into a dangling
 * reference.
 *
 * Two limits, stated in the UI rather than hidden:
 *  - one level of dependants. A sequence's scene_sequence rows come
 *    back; a hypothetical row pointing at THOSE does not.
 *  - session only. A reload clears it. Persisting an undo stack across
 *    sessions is a different feature (and a versioning one).
 */

import { q, type Row, type SqlExec, type SqlValue } from "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";

export interface UndoEntry {
  entity: string;
  id: number;
  label: string;
  row: Row;
  /** Rows that referenced the deleted one, by table. */
  dependants: Array<{ entity: string; rows: Row[] }>;
}

/** Tables with a reference field pointing at `entity`. */
function referrers(registry: Registry, entity: string):
    Array<{ entity: string; field: string }> {
  const out: Array<{ entity: string; field: string }> = [];
  for (const edef of registry.entities.values()) {
    for (const f of edef.fields) {
      if (f.fieldType === "reference" && f.referenceEntity === entity) {
        out.push({ entity: edef.name, field: f.name });
      }
    }
  }
  return out;
}

export async function captureForUndo(
    exec: SqlExec, registry: Registry, entity: string, id: number,
    label: string): Promise<UndoEntry | null> {
  const rows = await exec(
    `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
  const row = rows[0];
  if (row === undefined) return null;

  const dependants: Array<{ entity: string; rows: Row[] }> = [];
  for (const ref of referrers(registry, entity)) {
    const found = await exec(
      `SELECT * FROM ${q(ref.entity)} WHERE ${q(ref.field)} = ?`, [id]);
    if (found.length > 0) dependants.push({ entity: ref.entity, rows: found });
  }
  return { entity, id, label, row, dependants };
}

async function insertRow(exec: SqlExec, entity: string,
                         row: Row): Promise<void> {
  const cols = Object.keys(row).filter((k) => row[k] !== null);
  if (cols.length === 0) return;
  const vals = cols.map((k) => row[k] as SqlValue);
  await exec(
    `INSERT OR REPLACE INTO ${q(entity)} (${cols.map(q).join(", ")}) ` +
    `VALUES (${cols.map(() => "?").join(", ")})`, vals);
}

export async function restoreFromUndo(exec: SqlExec,
                                      undo: UndoEntry): Promise<void> {
  // The parent first: its dependants reference its id.
  await insertRow(exec, undo.entity, undo.row);
  for (const group of undo.dependants) {
    for (const row of group.rows) {
      await insertRow(exec, group.entity, row);
    }
  }
}

/** "Act II, and 12 linked rows" — what the toast offers to put back. */
export function undoSummary(undo: UndoEntry): string {
  const count = undo.dependants.reduce((n, g) => n + g.rows.length, 0);
  if (count === 0) return `Deleted ${undo.label}`;
  return `Deleted ${undo.label} and ${String(count)} linked row` +
         `${count === 1 ? "" : "s"}`;
}
