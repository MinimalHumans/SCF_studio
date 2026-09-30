// SPDX-License-Identifier: Apache-2.0
/**
 * whereUsed.ts — every row that points at one row.
 *
 * The queries all run FORWARD: given a subject and a position, what is
 * in force. Nothing ran backward, and the absence cost a real answer —
 * asked which bundles an asset was in, an agent could only diff a full
 * `list("asset")` against a resolution per subject per intent, by
 * hand, and no agent will. §8.6's orphan finding says an asset is
 * referenced by nothing; this says by WHAT, which is the question
 * anyone actually has.
 *
 * Every column comes from the registry — plain references and
 * polymorphic pairs alike (§12.1.2) — so a junction added in a later
 * schema is covered without editing this file. Cut rows are excluded
 * like everywhere else (§6.6.1); a cut row is not in the film, and a
 * reference from one is not a use.
 */

import { q } from "./db.ts";
import { rows, type ScfContext } from "./resolution.ts";
import { columnRoles, projectRow, uuidLookupForAll } from "./queryResult.ts";
import { labelFieldOf } from "./naturalKey.ts";

export interface Usage {
  /** The entity whose row points at the subject. */
  entity: string;
  /** The column it points with. */
  column: string;
  uuid: string | null;
  /** That row's natural-key label, where its entity has one. */
  label: string | null;
  /** True where the reference is polymorphic (§12.1.2). */
  polymorphic: boolean;
  /**
   * The referencing row, projected (§12.1.2). A junction carries no
   * label of its own (§6.3), so without this a caller learns that
   * something points at the subject and has no way to reach it — the
   * bundle a `bundle_asset` belongs to is in here as `bundle_uuid`.
   */
  fields: Record<string, unknown>;
}

/**
 * Rows referencing `entityType`'s row `id`, in registry order.
 *
 * Grouping and presentation are the caller's: this returns the facts,
 * and a caller that wants "which bundles hold this asset" filters by
 * entity rather than asking for a second, narrower function.
 */
export async function whereUsed(
    ctx: ScfContext, entityType: string, uuid: string,
): Promise<Usage[]> {
  if (!ctx.registry.entities.has(entityType)) {
    throw new Error(`whereUsed: unknown entity type "${entityType}"`);
  }
  const subject = (await rows(ctx.exec, entityType, "uuid = ?", [uuid]))[0];
  if (subject === undefined) {
    throw new Error(`whereUsed: no ${entityType} with uuid ${uuid}`);
  }
  const id = Number(subject["id"]);
  const lookup = await uuidLookupForAll(ctx.exec, ctx.registry);
  const present = new Set((await ctx.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => String(r["name"])));

  const out: Usage[] = [];
  for (const name of ctx.registry.order) {
    const def = ctx.registry.entities.get(name);
    if (def === undefined || !present.has(name)) continue;
    let label: string | null = null;
    try {
      label = labelFieldOf(ctx, name);
    } catch {
      label = null;                       // a junction has no label (§6.3)
    }
    for (const field of def.fields) {
      const poly = field.polymorphicType !== undefined
        && field.polymorphicType !== "";
      if (!poly && field.referenceEntity !== entityType) continue;
      if (name === entityType && field.name === "id") continue;

      const where = poly
        ? `${q(field.name)} = ? AND ${q(field.polymorphicType as string)} = ?`
        : `${q(field.name)} = ?`;
      const params = poly ? [id, entityType] : [id];
      for (const row of await rows(ctx.exec, name, where, params)) {
        const projected = projectRow(row, columnRoles(ctx.registry, name),
                                     lookup);
        out.push({
          entity: name,
          column: field.name,
          uuid: row["uuid"] === null || row["uuid"] === undefined
            ? null : String(row["uuid"]),
          label: label === null || row[label] === null
            || row[label] === undefined ? null : String(row[label]),
          polymorphic: poly,
          fields: projected.fields,
        });
      }
    }
  }
  return out;
}
