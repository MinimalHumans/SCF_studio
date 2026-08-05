/**
 * junctions.ts — what makes two link rows the same link.
 *
 * Junctions DO carry row identity: `uuid` is a framework column on all
 * 99 entities since schema 2.3, junctions included, backfilled on open.
 * That answers "is this the same row as before" across export,
 * re-import, and versioning — the lineage question.
 *
 * It does not answer the other one. A uuid is minted per file, so two
 * people describing the same production produce different uuids for the
 * same (scene, character) link. Across files, a junction is identified
 * by its NATURAL KEY: the rows it joins. That key already exists in
 * every link entity — this module states it explicitly so that merging,
 * de-duplicating, and validating all agree on what it is.
 *
 * The immediate use is duplicates. Nothing in the schema stops two rows
 * for one pair; the commit path de-duplicates in code, and anything
 * added by hand is not checked at all. Two rows for one link split its
 * authored content — a role, a usage note, a significance — between
 * them, and a reader that takes the first finds half the truth. As
 * everywhere else in SCF this is reported, not rejected.
 */

import { q, type SqlExec } from "./db.ts";
import type { EntityDef, Registry } from "./registry.ts";

/**
 * The columns that identify a link row.
 *
 * Its references, plus the polymorphic target where the entity has one
 * (`thematic_connection` points at a theme and then at anything), plus
 * `domain` where present — a motif may legitimately appear twice in one
 * scene if it appears once visually and once sonically.
 */
export function junctionKeyFields(edef: EntityDef): string[] {
  const refs = edef.fields
    .filter((f) => f.fieldType === "reference" && !f.autoInjected)
    .map((f) => f.name);
  const extra = ["entity_type", "entity_id", "domain"]
    .filter((name) => edef.fields.some((f) => f.name === name));
  return [...refs, ...extra];
}

export function junctionEntities(registry: Registry): EntityDef[] {
  return [...registry.entities.values()]
    .filter((e) => e.subject === "link" && junctionKeyFields(e).length > 0);
}

export interface DuplicateJunction {
  entity: string;
  label: string;
  /** The natural key values that repeat. */
  key: Record<string, unknown>;
  rowIds: number[];
  /** True when the duplicates disagree on some authored column. */
  contentDiffers: boolean;
  message: string;
}

/**
 * Every link row that shares a natural key with another.
 *
 * `contentDiffers` is the part worth acting on: two identical rows are
 * clutter, but two rows for one link that disagree on their authored
 * content are a fact split in half, and whichever a reader happens to
 * take is arbitrary.
 */
export async function duplicateJunctions(
    exec: SqlExec, registry: Registry): Promise<DuplicateJunction[]> {
  const out: DuplicateJunction[] = [];
  for (const edef of junctionEntities(registry)) {
    const key = junctionKeyFields(edef);
    const authored = edef.fields
      .filter((f) => !f.autoInjected && !key.includes(f.name) &&
                     f.name !== edef.nameField)
      .map((f) => f.name);
    const cols = key.map(q).join(", ");
    let groups;
    try {
      groups = await exec(
        `SELECT ${cols}, COUNT(*) AS n, GROUP_CONCAT(id) AS ids ` +
        `FROM ${q(edef.name)} GROUP BY ${cols} HAVING COUNT(*) > 1`);
    } catch {
      continue; // a table the file predates
    }
    for (const group of groups) {
      const ids = String(group["ids"] ?? "").split(",")
        .map((s) => Number(s)).filter((n) => !Number.isNaN(n));
      const rows = await exec(
        `SELECT * FROM ${q(edef.name)} WHERE id IN (${
          ids.map(() => "?").join(", ")})`, ids);
      const differs = authored.some((col) =>
        new Set(rows.map((r) => JSON.stringify(r[col] ?? null))).size > 1);
      out.push({
        entity: edef.name,
        label: edef.label,
        key: Object.fromEntries(key.map((k) => [k, group[k]])),
        rowIds: ids,
        contentDiffers: differs,
        message: differs
          ? `${String(ids.length)} ${edef.label} rows describe the same ` +
            "link and disagree on their content. Whichever a reader " +
            "takes first is arbitrary — merge them."
          : `${String(ids.length)} identical ${edef.label} rows describe ` +
            "the same link. Harmless, but one of them is noise.",
      });
    }
  }
  return out;
}
