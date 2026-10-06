// SPDX-License-Identifier: Apache-2.0
/**
 * undoChange.ts — one undo step for a write that touched several rows.
 *
 * A workspace intent is often four rows: "use this file as her look" can
 * be an asset, a bundle, a binding and a membership. The writer did one
 * thing, so it undoes as one thing. undoDelete.ts covers deletes from
 * the record editor; this covers everything a workspace operation does,
 * and it is what the same toast offers when the last action was one.
 *
 * A change is recorded explicitly by the operation that made it, not
 * inferred by watching SQL go past: the operation knows which rows it
 * meant to create and which it changed, and that is the list worth
 * trusting.
 *
 * Session only, one level, like undoDelete — stated in the same toast.
 */

import { q, type Row, type SqlExec, type SqlValue } from "@scf-core/db.ts";

export interface ChangeUndo {
  /** What the toast says: "Added 2 files to Eleanor's look". */
  label: string;
  /** Rows this change created, in creation order. Undo deletes them. */
  created: Array<{ entity: string; id: number }>;
  /** Rows as they were before this change altered or deleted them. Undo
   *  writes them back with their original ids. */
  before: Array<{ entity: string; row: Row }>;
}

/** Accumulates one change while an operation runs. */
export class ChangeRecorder {
  private readonly change: ChangeUndo;
  constructor(label: string) {
    this.change = { label, created: [], before: [] };
  }
  set label(text: string) { this.change.label = text; }
  created(entity: string, id: number): void {
    this.change.created.push({ entity, id });
  }
  /** Snapshot a row before altering or deleting it. Once per row: the
   *  first snapshot is the state to return to. */
  async snapshot(exec: SqlExec, entity: string, id: number): Promise<void> {
    if (this.change.before.some((b) => b.entity === entity &&
                                       Number(b.row["id"]) === id)) return;
    if (this.change.created.some((c) => c.entity === entity && c.id === id)) {
      return;   // made by this change: undo removes it anyway
    }
    const row = (await exec(`SELECT * FROM ${q(entity)} WHERE id = ?`,
                            [id]))[0];
    if (row !== undefined) this.change.before.push({ entity, row });
  }
  get result(): ChangeUndo { return this.change; }
  get empty(): boolean {
    return this.change.created.length === 0 &&
           this.change.before.length === 0;
  }
}

/**
 * Put the database back. Created rows go first, newest first, so a
 * membership is removed before the bundle it belongs to; then every
 * snapshot is written back over whatever is there now.
 */
export async function applyUndoChange(exec: SqlExec,
                                      change: ChangeUndo): Promise<void> {
  for (const c of [...change.created].reverse()) {
    await exec(`DELETE FROM ${q(c.entity)} WHERE id = ?`, [c.id]);
  }
  for (const { entity, row } of change.before) {
    const cols = Object.keys(row);
    await exec(
      `INSERT OR REPLACE INTO ${q(entity)} (${cols.map(q).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => row[k] as SqlValue));
  }
}
