// SPDX-License-Identifier: Apache-2.0
/**
 * ops/recordOps.ts — create, update and delete one registry row.
 *
 * The generic write path behind the record editor and every "make me a
 * row" shortcut in the workspaces. It lives here rather than in a view
 * so that every writer — the app, the MCP — gets the same rules:
 * identity stamped at insert, only registry fields written, a shot
 * renumbered when it changes scene, and a scene's act and sequence
 * boundaries handed on before it goes.
 *
 * Each exported function is one transaction. Do not call one from inside
 * `withTransaction`: the queue is per connection and would wait on
 * itself.
 */

import { newUuid, q, withTransaction, type SqlExec, type SqlValue }
  from "../db.ts";
import { rowLabel } from "../displayName.ts";
import type { Registry } from "../registry.ts";
import { renumberForScene } from "./shootOps.ts";
import { reanchorSpansForMove } from "./structureCommit.ts";
import { captureForUndo, type UndoEntry } from "./undoDelete.ts";

function entityDef(registry: Registry, entity: string) {
  const edef = registry.entities.get(entity);
  if (edef === undefined) throw new Error(`unknown entity: ${entity}`);
  return edef;
}

/**
 * Insert a row and return its id. Values for names that are not
 * registry fields are ignored, and null or empty values are left to the
 * column default, so a half-filled form does not store empty strings.
 */
export async function createRecord(
    exec: SqlExec, registry: Registry, entity: string,
    values: Record<string, SqlValue | undefined>): Promise<number> {
  const edef = entityDef(registry, entity);
  const fieldNames = edef.fields.map((f) => f.name);
  const filtered = Object.entries(values).filter(
    (e): e is [string, SqlValue] =>
      fieldNames.includes(e[0]) && e[1] !== undefined &&
      e[1] !== null && e[1] !== "");
  const cols = [...filtered.map(([k]) => k), "uuid"];
  const vals: SqlValue[] = [...filtered.map(([, v]) => v), newUuid()];
  return withTransaction(exec, async () => {
    await exec(
      `INSERT INTO ${q(entity)} (${cols.map(q).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")})`, vals);
    const idRow = await exec("SELECT last_insert_rowid() AS id");
    return Number(idRow[0]?.["id"]);
  });
}

/**
 * Write every registry field of a row from `values` (a missing value is
 * written as null), and stamp `updated_at`.
 *
 * A shot moved to another scene is renumbered first, so the form does
 * not save "5A" onto scene 66. The scene renumbering case is the
 * opposite and leaves the number alone — see `renumberForScene`.
 */
export async function updateRecord(
    exec: SqlExec, registry: Registry, entity: string, id: number,
    values: Record<string, SqlValue | undefined>): Promise<void> {
  const edef = entityDef(registry, entity);
  const fieldNames = edef.fields.map((f) => f.name);
  await withTransaction(exec, async () => {
    const written = { ...values };
    if (entity === "shot") {
      const target = written["scene_id"];
      if (target !== null && target !== undefined && target !== "") {
        const renumbered = await renumberForScene(exec, id, Number(target));
        if (renumbered !== null) written["shot_number"] = renumbered;
      }
    }
    const sets = fieldNames.map((f) => `${q(f)} = ?`).join(", ");
    const vals: SqlValue[] = fieldNames.map((f) => written[f] ?? null);
    await exec(
      `UPDATE ${q(entity)} SET ${sets}, updated_at = datetime('now') ` +
      "WHERE id = ?", [...vals, id]);
  });
}

/**
 * Delete a row and return what is needed to put it back (null when the
 * row did not exist).
 *
 * An act or sequence is anchored to a START SCENE, so deleting that
 * scene would leave the span pointing at nothing: the row is not
 * deleted, it just stops appearing in the structure, and every scene it
 * held falls out of any act. Same answer as moving the anchor scene —
 * hand the boundary to whatever now sits where the old one did.
 */
export async function deleteRecord(
    exec: SqlExec, registry: Registry, entity: string,
    id: number): Promise<UndoEntry | null> {
  return withTransaction(exec, async () => {
    const existing = await exec(
      `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
    const undo = await captureForUndo(
      exec, registry, entity, id,
      existing[0] === undefined
        ? entity : rowLabel(registry.entities.get(entity), entity,
                            existing[0]));
    if (entity === "scene") {
      const headings = await exec(
        "SELECT scene_id FROM screenplay_lines " +
        "WHERE line_type = 'heading' AND scene_id IS NOT NULL " +
        "ORDER BY line_order");
      const order: number[] = [];
      for (const row of headings) {
        const sceneId = Number(row["scene_id"]);
        if (!order.includes(sceneId)) order.push(sceneId);
      }
      await reanchorSpansForMove(exec, id, order);
    }
    await exec(`DELETE FROM ${q(entity)} WHERE id = ?`, [id]);
    return undo;
  });
}
