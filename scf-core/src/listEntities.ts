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
import { rows, sceneOrder, type ScfContext } from "./resolution.ts";
import {
  projectRow, columnRoles, uuidLookupForAll, POLYMORPHIC,
} from "./queryResult.ts";
import { labelFieldOf } from "./naturalKey.ts";

export interface ListedRow {
  uuid: string;
  /** This entity's natural-key label value (§3), e.g. "12", "12-04 push-in". */
  label: string;
  /** The row, portably projected — same rule every canonical query uses. */
  fields: Record<string, unknown>;
  /**
   * Position in story order (§4.1), zero-based, on a list that has one:
   * `scene` itself, and any entity whose rows belong to a scene. Absent
   * otherwise.
   *
   * Listed rows come back in this order when it exists. Row order is
   * meaningless to a reader (§12.1.6) and scene NUMBER order is the
   * derivation §4.1 forbids, so a list of scenes with neither invites
   * exactly the wrong reading — an agent took the row order of a
   * thirteen-scene film for the story and concluded a published spine
   * was misordered.
   */
  storyPosition?: number;
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
 * declares for this entity — derived via `columnRoles`, never a
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
  const refs = columnRoles(ctx.registry, entityType);

  let where = "";
  let params: SqlValue[] = [];
  if (filter !== undefined) {
    const field = storedName(filter.field, refs);
    const targetEntity = refs[field];
    if (targetEntity === undefined || targetEntity === POLYMORPHIC) {
      const valid = Object.keys(refs).filter((f) => refs[f] !== POLYMORPHIC);
      throw new Error(
        `listEntities: "${entityType}" has no reference field ` +
        `"${filter.field}" — has ${valid.sort().join(", ") || "none"}`);
    }
    filter = { ...filter, field };
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

  // Story position, where the rows have one: the entity IS a scene, or
  // it belongs to one (§2.3's ownership convention — `scene_id`).
  const owns = entityType === "scene"
    || refs["scene_id"] === "scene";
  const order = owns ? await sceneOrder(ctx) : null;
  const positionOf = (r: Record<string, unknown>): number | undefined => {
    if (order === null) return undefined;
    const sceneId = Number(entityType === "scene" ? r["id"] : r["scene_id"]);
    if (!Number.isFinite(sceneId)) return undefined;
    return order.get(sceneId);
  };

  const listed = found.map((r) => {
    const projected = projectRow(r, refs, lookup);
    const position = positionOf(r);
    return {
      uuid: projected.uuid ?? "",
      label: String(r[labelField] ?? ""),
      fields: projected.fields,
      ...(position === undefined ? {} : { storyPosition: position }),
    };
  });

  if (order !== null) {
    listed.sort((a, b) => {
      const ap = a.storyPosition;
      const bp = b.storyPosition;
      if (ap === undefined || bp === undefined) {
        return ap === bp ? 0 : ap === undefined ? 1 : -1;
      }
      return ap - bp;
    });
  }
  return listed;
}

/**
 * The stored column a caller means.
 *
 * Results project `<name>_id` to `<name>_uuid` (§12.1.2), so a caller
 * that read `scene_uuid` off a listed row and passed it straight back
 * as a filter field was naming a column that does not exist. The
 * projection is the normative spelling on the way out; this accepts it
 * on the way in rather than making a round trip fail on a rule the
 * caller followed correctly.
 */
function storedName(field: string, refs: Record<string, unknown>): string {
  if (refs[field] !== undefined) return field;
  if (field.endsWith("_uuid")) {
    const stored = `${field.slice(0, -"_uuid".length)}_id`;
    if (refs[stored] !== undefined) return stored;
  }
  return field;
}
