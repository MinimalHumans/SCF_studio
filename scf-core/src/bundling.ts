// SPDX-License-Identifier: Apache-2.0
/**
 * bundling.ts — getting an asset into a bundle.
 *
 * Three entities stand between a subject and an asset:
 *
 *   character → character_asset_binding → bundle → bundle_asset → asset
 *   (and the same for props and locations; shot overrides skip the binding)
 *
 * The indirection earns its place: one bundle can serve several
 * characters, carry `precedence` and `is_baseline`, and be scoped to a
 * scene range or a variant. Collapsing it would cost real
 * expressiveness, and the cascade in `resolution.ts` walks it.
 *
 * But the schema being right does not mean the workflow should mirror
 * it. The common act — put this asset in that bundle — is one thing,
 * and doing it by hand meant three creates across three forms in the
 * right order. This module is the one-action version, and it is built
 * for batches, because after importing a folder the real act is "put
 * these twenty in that bundle".
 *
 * Reporting, not enforcing, as everywhere else: a plan says what would
 * change and the caller decides.
 */

import { newUuid, q, type SqlExec } from "./db.ts";
import type { Registry } from "./registry.ts";

export interface BundleSummary {
  id: number;
  name: string | null;
  intent: string | null;
  assetCount: number;
}

export async function listBundles(exec: SqlExec): Promise<BundleSummary[]> {
  const rows = await exec(
    `SELECT b.id, b.name, b.intent, ` +
    `  (SELECT COUNT(*) FROM ${q("bundle_asset")} ba ` +
    `   WHERE ba.bundle_id = b.id) AS n ` +
    `FROM ${q("bundle")} b ORDER BY b.name, b.id`);
  return rows.map((row) => ({
    id: Number(row["id"]),
    name: row["name"] === null || row["name"] === undefined
      ? null : String(row["name"]),
    intent: row["intent"] === null || row["intent"] === undefined
      ? null : String(row["intent"]),
    assetCount: Number(row["n"] ?? 0),
  }));
}

export interface BundleMember {
  /** bundle_asset row id — what a removal targets. */
  linkId: number;
  assetId: number;
  assetName: string | null;
  identifier: string | null;
  role: string | null;
  order: number | null;
}

export async function bundleMembers(
  exec: SqlExec, bundleId: number,
): Promise<BundleMember[]> {
  const rows = await exec(
    `SELECT ba.id AS link_id, ba.asset_id, ba.role_in_bundle, ` +
    `       ba."order" AS ord, a.name, a.identifier ` +
    `FROM ${q("bundle_asset")} ba ` +
    `LEFT JOIN ${q("asset")} a ON a.id = ba.asset_id ` +
    `WHERE ba.bundle_id = ? ` +
    `ORDER BY COALESCE(ba."order", 999999), ba.id`, [bundleId]);
  return rows.map((row) => ({
    linkId: Number(row["link_id"]),
    assetId: Number(row["asset_id"]),
    assetName: row["name"] === null || row["name"] === undefined
      ? null : String(row["name"]),
    identifier: row["identifier"] === null ||
      row["identifier"] === undefined ? null : String(row["identifier"]),
    role: row["role_in_bundle"] === null ||
      row["role_in_bundle"] === undefined
      ? null : String(row["role_in_bundle"]),
    order: row["ord"] === null || row["ord"] === undefined
      ? null : Number(row["ord"]),
  }));
}

/** Which bundles an asset already appears in — the reverse view. */
export async function bundlesForAsset(
  exec: SqlExec, assetId: number,
): Promise<{ bundleId: number; name: string | null; intent: string | null;
             role: string | null }[]> {
  const rows = await exec(
    `SELECT b.id, b.name, b.intent, ba.role_in_bundle ` +
    `FROM ${q("bundle_asset")} ba ` +
    `JOIN ${q("bundle")} b ON b.id = ba.bundle_id ` +
    `WHERE ba.asset_id = ? ORDER BY b.name, b.id`, [assetId]);
  return rows.map((row) => ({
    bundleId: Number(row["id"]),
    name: row["name"] === null || row["name"] === undefined
      ? null : String(row["name"]),
    intent: row["intent"] === null || row["intent"] === undefined
      ? null : String(row["intent"]),
    role: row["role_in_bundle"] === null ||
      row["role_in_bundle"] === undefined
      ? null : String(row["role_in_bundle"]),
  }));
}

export interface BundleAddPlan {
  /** Asset ids that would become new members. */
  add: number[];
  /** Asset ids already in the bundle, which are left alone. */
  already: number[];
}

/**
 * What adding these assets would do.
 *
 * An asset already in the bundle is not added again: `bundle_asset` is
 * a link entity whose natural key is the pair (conventions §5), so a
 * second row for the same pair is a duplicate rather than a second
 * fact. Re-adding a selection that overlaps what is already there is
 * therefore safe, which is what makes batch work bearable.
 */
export async function planBundleAdd(
  exec: SqlExec, bundleId: number, assetIds: readonly number[],
): Promise<BundleAddPlan> {
  const existing = new Set((await exec(
    `SELECT asset_id FROM ${q("bundle_asset")} WHERE bundle_id = ?`,
    [bundleId])).map((r) => Number(r["asset_id"])));

  const add: number[] = [];
  const already: number[] = [];
  const seen = new Set<number>();
  for (const id of assetIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (existing.has(id)) already.push(id);
    else add.push(id);
  }
  return { add, already };
}

/**
 * Add assets to a bundle, continuing its ordering.
 *
 * `order` picks up after the highest already present rather than
 * restarting, so a batch appended to an existing bundle lands after it
 * instead of interleaving.
 */
export async function applyBundleAdd(
  exec: SqlExec, bundleId: number, assetIds: readonly number[],
  role: string | null = null,
): Promise<number> {
  const [row] = await exec(
    `SELECT MAX("order") AS top FROM ${q("bundle_asset")} ` +
    `WHERE bundle_id = ?`, [bundleId]);
  let next = row?.["top"] === null || row?.["top"] === undefined
    ? 0 : Number(row["top"]);

  for (const assetId of assetIds) {
    next += 1;
    await exec(
      `INSERT INTO ${q("bundle_asset")} ` +
      `(bundle_id, asset_id, role_in_bundle, "order", uuid) ` +
      `VALUES (?, ?, ?, ?, ?)`,
      [bundleId, assetId, role, next, newUuid()]);
  }
  return assetIds.length;
}

/** Remove one membership. The asset itself is untouched. */
export async function removeBundleMember(
  exec: SqlExec, linkId: number,
): Promise<void> {
  await exec(`DELETE FROM ${q("bundle_asset")} WHERE id = ?`, [linkId]);
}

export async function setMemberRole(
  exec: SqlExec, linkId: number, role: string | null,
): Promise<void> {
  await exec(
    `UPDATE ${q("bundle_asset")} SET role_in_bundle = ? WHERE id = ?`,
    [role === null || role.trim() === "" ? null : role.trim(), linkId]);
}

/**
 * Create a bundle.
 *
 * `intent` is what the media cascade filters on, so a bundle without
 * one resolves for nothing. It is required here even though the column
 * is nullable — a bundle that cannot be reached is not a useful thing
 * to have made by accident.
 */
export async function createBundle(
  exec: SqlExec, name: string, intent: string,
): Promise<number> {
  await exec(
    `INSERT INTO ${q("bundle")} (name, intent, uuid) VALUES (?, ?, ?)`,
    [name, intent, newUuid()]);
  const [row] = await exec("SELECT last_insert_rowid() AS id");
  return Number(row?.["id"]);
}

/**
 * Bind a bundle to a character, which is what makes it resolve.
 *
 * Kept for callers that predate `bindBundle`; it is that call with the
 * character's defaults.
 */
export async function bindBundleToCharacter(
  exec: SqlExec, characterId: number, bundleId: number,
  isBaseline = true,
): Promise<number | null> {
  return bindBundle(exec, "character", characterId, bundleId,
                    { isBaseline });
}

/** The subject kinds that own an `<subject>_asset_binding` table. */
export const BINDING_SUBJECTS = ["character", "prop", "location"] as const;
export type BindingSubject = typeof BINDING_SUBJECTS[number];

export interface BindOptions {
  isBaseline?: boolean;
  precedence?: number;
  /** Scene row ids. Either bound may be null — open-ended. */
  sceneRangeStartId?: number | null;
  sceneRangeEndId?: number | null;
  name?: string | null;
}

/**
 * Bind a bundle to a character, prop or location.
 *
 * Without a binding the bundle exists but reaches nobody: the media
 * cascade starts at the subject (spec §7). This is the step most easily
 * forgotten, because putting assets in a bundle produces something
 * visible and binding it does not.
 *
 * A second binding of the same pair with the same scene range is a
 * duplicate rather than a second fact, and returns null. The same pair
 * over a DIFFERENT range is legitimate — one bundle can apply in two
 * stretches of the story.
 */
export async function bindBundle(
  exec: SqlExec, subjectType: BindingSubject, subjectId: number,
  bundleId: number, options: BindOptions = {},
): Promise<number | null> {
  if (!(BINDING_SUBJECTS as readonly string[]).includes(subjectType)) {
    throw new Error(`bindBundle: no binding table for "${subjectType}"`);
  }
  const table = `${subjectType}_asset_binding`;
  const column = `${subjectType}_id`;
  const start = options.sceneRangeStartId ?? null;
  const end = options.sceneRangeEndId ?? null;

  const [existing] = await exec(
    `SELECT id FROM ${q(table)} ` +
    `WHERE ${q(column)} = ? AND bundle_id = ? ` +
    `AND scene_range_start_id IS ? AND scene_range_end_id IS ?`,
    [subjectId, bundleId, start, end]);
  if (existing !== undefined) return null;   // already bound

  await exec(
    `INSERT INTO ${q(table)} ` +
    `(${q(column)}, bundle_id, is_baseline, precedence, ` +
    ` scene_range_start_id, scene_range_end_id, name, uuid) ` +
    `VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [subjectId, bundleId, options.isBaseline === false ? 0 : 1,
     options.precedence ?? 0, start, end,
     options.name === undefined || options.name === null
       || options.name.trim() === "" ? null : options.name.trim(),
     newUuid()]);
  const [row] = await exec("SELECT last_insert_rowid() AS id");
  return Number(row?.["id"]);
}

/**
 * Where a row can put a bundle in force: every reference to `bundle` on
 * an entity whose registry `subject` is itself an entity — the
 * `*_asset_binding` and `*_shot_override` families today.
 *
 * Read from the registry rather than listed, so a subject kind gaining a
 * binding table is covered without touching this file. `bundle_asset`
 * (membership, not reach) and `bundle`'s own version columns have no
 * such subject and fall out on their own.
 */
export function bundleReachColumns(registry: Registry):
    { entity: string; column: string; subject: string }[] {
  const out: { entity: string; column: string; subject: string }[] = [];
  for (const name of registry.order) {
    const def = registry.entities.get(name);
    if (def === undefined || def.subject === null) continue;
    if (!registry.entities.has(def.subject)) continue;
    const subjectColumn = `${def.subject}_id`;
    if (!def.fields.some((f) => f.name === subjectColumn)) continue;
    for (const f of def.fields) {
      if (f.referenceEntity === "bundle" && f.polymorphicType === undefined) {
        out.push({ entity: name, column: f.name, subject: def.subject });
      }
    }
  }
  return out;
}

export interface BundleReach {
  /** The binding or override table. */
  entity: string;
  rowId: number;
  rowName: string | null;
  subjectType: string;
  subjectId: number | null;
  subjectName: string | null;
  /** Null where the entity has no such column (shot overrides). */
  isBaseline: boolean | null;
  precedence: number | null;
  sceneRangeStartId: number | null;
  sceneRangeEndId: number | null;
  /** Set on a shot override; null on a binding. */
  shotId: number | null;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

async function columnsOf(exec: SqlExec, table: string): Promise<Set<string>> {
  return new Set((await exec(`PRAGMA table_info(${q(table)})`))
    .map((r) => String(r["name"])));
}

/**
 * Every live row that puts this bundle in force, and for whom.
 *
 * A cut binding reaches nothing (spec §6.6.1), so it is not listed. The
 * answer is the rows, not a resolution: whether a binding APPLIES at a
 * given scene is Q13's question, not this one's.
 */
export async function bundleReach(
  exec: SqlExec, registry: Registry, bundleId: number,
): Promise<BundleReach[]> {
  const present = new Set((await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => String(r["name"])));
  const out: BundleReach[] = [];
  for (const { entity, column, subject } of bundleReachColumns(registry)) {
    if (!present.has(entity) || !present.has(subject)) continue;
    const cols = await columnsOf(exec, entity);
    const pick = (c: string): string =>
      cols.has(c) ? `r.${q(c)}` : "NULL";
    const live = cols.has("lifecycle_status")
      ? ` AND (r.lifecycle_status IS NULL OR r.lifecycle_status <> 'cut')`
      : "";
    const found = await exec(
      `SELECT r.id, r.name, r.${q(`${subject}_id`)} AS subject_id, ` +
      `  s.name AS subject_name, ${pick("is_baseline")} AS is_baseline, ` +
      `  ${pick("precedence")} AS precedence, ` +
      `  ${pick("scene_range_start_id")} AS range_start, ` +
      `  ${pick("scene_range_end_id")} AS range_end, ` +
      `  ${pick("shot_id")} AS shot_id ` +
      `FROM ${q(entity)} r ` +
      `LEFT JOIN ${q(subject)} s ON s.id = r.${q(`${subject}_id`)} ` +
      `WHERE r.${q(column)} = ?${live} ORDER BY r.id`, [bundleId]);
    for (const row of found) {
      out.push({
        entity,
        rowId: Number(row["id"]),
        rowName: str(row["name"]),
        subjectType: subject,
        subjectId: num(row["subject_id"]),
        subjectName: str(row["subject_name"]),
        isBaseline: row["is_baseline"] === null
          || row["is_baseline"] === undefined
          ? null : Number(row["is_baseline"]) !== 0,
        precedence: num(row["precedence"]),
        sceneRangeStartId: num(row["range_start"]),
        sceneRangeEndId: num(row["range_end"]),
        shotId: num(row["shot_id"]),
      });
    }
  }
  return out;
}

/**
 * Bundles no live binding or override reaches.
 *
 * One level above §8.6's orphan: an asset in such a bundle is referenced
 * — `bundle_asset` points at it — and still resolves for no subject at
 * any position. Reported, never repaired: a bundle can be assembled
 * before anyone decides what it is for.
 */
export async function unboundBundleIds(
  exec: SqlExec, registry: Registry,
): Promise<Set<number>> {
  const present = new Set((await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => String(r["name"])));
  const reached = new Set<number>();
  for (const { entity, column } of bundleReachColumns(registry)) {
    if (!present.has(entity)) continue;
    const cols = await columnsOf(exec, entity);
    const live = cols.has("lifecycle_status")
      ? ` AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut')`
      : "";
    for (const row of await exec(
      `SELECT DISTINCT ${q(column)} AS ref FROM ${q(entity)} ` +
      `WHERE ${q(column)} IS NOT NULL${live}`)) {
      reached.add(Number(row["ref"]));
    }
  }
  const out = new Set<number>();
  for (const row of await exec(
    `SELECT id, lifecycle_status FROM ${q("bundle")}`)) {
    if (row["lifecycle_status"] === "cut") continue;
    const id = Number(row["id"]);
    if (!reached.has(id)) out.add(id);
  }
  return out;
}
