// SPDX-License-Identifier: Apache-2.0
/**
 * editor/sceneOps.ts — removing and duplicating a scene from the rail.
 *
 * Both are DATABASE operations that happen to move text. The rail is
 * where you work on the film's structure; the page is one projection of
 * it. Neither is undoable, and neither pretends to be: the warning does
 * the work that a soft delete would otherwise have to.
 *
 * WHAT COUNTS AS A CHILD is derived from the registry, not listed here.
 * Forty-three tables reference `scene`, and a hand-written list would be
 * stale the first time an entity is added. The rule is in the field
 * name:
 *
 *   `scene_id`          -> this row BELONGS to the scene. It goes.
 *   any other reference -> this row POINTS AT the scene. It is nulled.
 *
 * So a shot, a beat, a sound cue are the scene's own coverage and die
 * with it, while a motif's `first_appearance_scene_id` or an asset
 * binding's `scene_range_start_id` is a reference from something that
 * outlives the scene, and only loses the pointer.
 *
 * `act.start_scene_id` and `sequence.start_scene_id` are excluded from
 * both: a boundary is re-anchored before the delete (see
 * reanchorSpansForMove), because an act whose anchor scene is deleted
 * silently disappears from the derived structure and takes every scene
 * it held with it.
 */

import type { SqlExec } from "@scf-core/db.ts";
import { newUuid, q } from "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";

export interface SceneCascade {
  /** Table -> field, for rows that die with the scene. */
  owned: Array<{ table: string; field: string }>;
  /** Table -> field, for references that are nulled instead. */
  pointing: Array<{ table: string; field: string }>;
}

const BOUNDARY = new Set(["act", "sequence"]);

export function sceneCascade(registry: Registry): SceneCascade {
  const owned: SceneCascade["owned"] = [];
  const pointing: SceneCascade["pointing"] = [];
  for (const entity of registry.entities.values()) {
    for (const field of entity.fields) {
      if (field.referenceEntity !== "scene") continue;
      // Boundaries are re-anchored, never cascaded.
      if (BOUNDARY.has(entity.name) && field.name === "start_scene_id") {
        continue;
      }
      const target = field.name === "scene_id" ? owned : pointing;
      target.push({ table: entity.name, field: field.name });
    }
  }
  owned.sort((a, b) => a.table.localeCompare(b.table));
  pointing.sort((a, b) => a.table.localeCompare(b.table));
  return { owned, pointing };
}

export interface RemovalImpact {
  sceneName: string;
  lines: number;
  /** Owned rows by table, only where the count is non-zero. */
  children: Array<{ table: string; count: number }>;
  /** References that will be cleared rather than deleted. */
  references: number;
  /** Prop tags anchored to the lines that are going. */
  propTags: number;
}

/**
 * What removing this scene would destroy.
 *
 * A confirmation that says "are you sure" trains you to click through
 * it; one that says "8 shots and 3 beats" is the thing that makes an
 * irreversible action safe. So the counts are real, gathered before
 * anything is touched.
 */
export async function planSceneRemoval(
    exec: SqlExec, registry: Registry, sceneId: number,
    lineIds: readonly string[]): Promise<RemovalImpact> {
  const cascade = sceneCascade(registry);
  const scene = await exec(
    "SELECT name FROM scene WHERE id = ?", [sceneId]);

  const children: RemovalImpact["children"] = [];
  for (const { table, field } of cascade.owned) {
    const rows = await exec(
      `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(field)} = ?`,
      [sceneId]);
    const count = Number(rows[0]?.["n"] ?? 0);
    if (count > 0) children.push({ table, count });
  }

  let references = 0;
  for (const { table, field } of cascade.pointing) {
    const rows = await exec(
      `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q(field)} = ?`,
      [sceneId]);
    references += Number(rows[0]?.["n"] ?? 0);
  }

  let propTags = 0;
  if (lineIds.length > 0) {
    const rows = await exec(
      "SELECT COUNT(*) AS n FROM screenplay_prop_tags WHERE line_uuid IN " +
      `(${lineIds.map(() => "?").join(",")})`, [...lineIds]);
    propTags = Number(rows[0]?.["n"] ?? 0);
  }

  children.sort((a, b) => b.count - a.count);
  return {
    sceneName: String(scene[0]?.["name"] ?? ""),
    lines: lineIds.length,
    children, references, propTags,
  };
}

/**
 * Delete the scene and everything that belongs to it.
 *
 * The screenplay lines themselves are removed by the editor, which owns
 * the document — this handles the records. Prop tags anchored to those
 * lines are deleted here rather than left to become detached, because a
 * deliberate removal should not leave findings behind for the author to
 * clean up after.
 */
export async function removeSceneCascade(
    exec: SqlExec, registry: Registry, sceneId: number,
    lineIds: readonly string[]): Promise<void> {
  const cascade = sceneCascade(registry);
  if (lineIds.length > 0) {
    await exec(
      "DELETE FROM screenplay_prop_tags WHERE line_uuid IN " +
      `(${lineIds.map(() => "?").join(",")})`, [...lineIds]);
  }
  for (const { table, field } of cascade.owned) {
    await exec(
      `DELETE FROM ${q(table)} WHERE ${q(field)} = ?`, [sceneId]);
  }
  for (const { table, field } of cascade.pointing) {
    await exec(
      `UPDATE ${q(table)} SET ${q(field)} = NULL WHERE ${q(field)} = ?`,
      [sceneId]);
  }
  await exec("DELETE FROM scene WHERE id = ?", [sceneId]);
}

/** Columns a duplicate must NOT inherit. */
const NOT_COPIED = new Set([
  "id", "uuid", "created_at", "updated_at",
  // A position, not a property — the next commit derives it.
  "scene_number",
  // Identity in someone else's system. A duplicate is not that row.
  "external_id", "external_id_namespace",
]);

/**
 * Copy the scene RECORD, newly minted.
 *
 * Its own fields only. Shots, beats and story beats are coverage
 * authored against a specific scene and are not copied — silently
 * duplicating a shot list is how two scenes end up claiming 12A.
 * `scene_character` is not copied either, because the commit re-derives
 * it from the duplicated cue lines, which is the same answer arrived at
 * honestly.
 *
 * Returns the new scene's id. The caller inserts the duplicated LINES.
 */
export async function duplicateSceneRow(
    exec: SqlExec, sceneId: number): Promise<number> {
  const source = await exec(
    "SELECT * FROM scene WHERE id = ?", [sceneId]);
  const row = source[0];
  if (row === undefined) throw new Error("scene not found");

  const cols = Object.keys(row).filter((c) => !NOT_COPIED.has(c));
  const values: unknown[] = cols.map((c) => row[c] ?? null);
  // Mint identity here rather than leaving it to the open-time backfill.
  // A row that exists without a uuid is a row nothing can anchor to
  // until the file is next reopened — beats, tags and links all key off
  // it, and "works after a restart" is not an invariant.
  if (Object.hasOwn(row, "uuid")) {
    cols.push("uuid");
    values.push(newUuid());
  }
  await exec(
    `INSERT INTO scene (${cols.map(q).join(", ")}) ` +
    `VALUES (${cols.map(() => "?").join(", ")})`,
    values as never[]);
  const created = await exec(
    "SELECT id FROM scene ORDER BY id DESC LIMIT 1");
  return created[0]!["id"] as number;
}

/** Human wording for the confirmation, e.g. "8 shots, 3 beats". */
export function describeChildren(
    children: readonly { table: string; count: number }[]): string {
  return children
    .map(({ table, count }) => {
      const noun = table.replaceAll("_", " ");
      return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
    })
    .join(", ");
}
