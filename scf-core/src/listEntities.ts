// SPDX-License-Identifier: Apache-2.0
/**
 * listEntities.ts — every row of one entity type, optionally filtered
 * to the rows one reference field points at.
 *
 * `find` and `shot_context` both need a uuid or a label already in
 * hand. "How many shots are in this film" needs neither — an agent
 * with nothing to start from has to discover the film's shape before
 * it can answer, and none of the sixteen canonical queries enumerate
 * rows (each is scoped to a scene, character or shot already
 * identified). Without this, "every shot in scene 12" costs one
 * guessed `find` call per candidate label — the failure mode that
 * motivated this module.
 */

import { q, type SqlValue } from "./db.ts";
import { rows, type ScfContext } from "./resolution.ts";
import {
  projectRow, referencesOf, uuidLookupForAll, POLYMORPHIC,
} from "./queryResult.ts";
import { labelFieldOf } from "./naturalKey.ts";

export interface ListedRow {
  uuid: string;
  /** This entity's natural-key label value (§3), e.g. "12", "12-04 push-in". */
  label: string;
  /** The row, portably projected — same rule every canonical query uses. */
  fields: Record<string, unknown>;
}

export interface ListFilter {
  /** A reference field entityType declares, e.g. "scene_id" on "shot". */
  field: string;
  /** The uuid of the row that field must point at. */
  uuid: string;
}

/**
 * List every (non-cut) row of `entityType`, optionally narrowed to rows
 * whose `filter.field` points at `filter.uuid`.
 *
 * `filter.field` must be one of the reference columns the registry
 * declares for this entity — derived via `referencesOf`, never a
 * hand-typed map, for the same reason every other reference resolution
 * in this module reads from the registry.
 */
export async function listEntities(
    ctx: ScfContext, entityType: string, filter?: ListFilter,
): Promise<ListedRow[]> {
  if (!ctx.registry.entities.has(entityType)) {
    throw new Error(`listEntities: unknown entity type "${entityType}"`);
  }
  const labelField = labelFieldOf(ctx, entityType);
  const refs = referencesOf(ctx.registry, entityType);

  let where = "";
  let params: SqlValue[] = [];
  if (filter !== undefined) {
    const targetEntity = refs[filter.field];
    if (targetEntity === undefined || targetEntity === POLYMORPHIC) {
      const valid = Object.keys(refs).filter((f) => refs[f] !== POLYMORPHIC);
      throw new Error(
        `listEntities: "${entityType}" has no reference field ` +
        `"${filter.field}" — has ${valid.sort().join(", ") || "none"}`);
    }
    const targetRow = (await rows(ctx.exec, targetEntity,
      "uuid = ?", [filter.uuid]))[0];
    if (targetRow === undefined) {
      throw new Error(
        `listEntities: no ${targetEntity} with uuid ${filter.uuid}`);
    }
    where = `${q(filter.field)} = ?`;
    params = [Number(targetRow["id"])];
  }

  const found = await rows(ctx.exec, entityType, where, params);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);

  return found.map((r) => {
    const projected = projectRow(r, refs, lookup);
    return {
      uuid: projected.uuid ?? "",
      label: String(r[labelField] ?? ""),
      fields: projected.fields,
    };
  });
}
