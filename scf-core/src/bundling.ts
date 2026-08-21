// SPDX-License-Identifier: Apache-2.0
/**
 * bundling.ts — getting an asset into a bundle.
 *
 * Three entities stand between a character and an asset:
 *
 *   character → character_asset_binding → bundle → bundle_asset → asset
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
 * Without a binding the bundle exists but reaches nobody: the cascade
 * starts at the subject. This is the third of the three steps and the
 * one most easily forgotten, because the first two produce something
 * visible and this one does not.
 */
export async function bindBundleToCharacter(
  exec: SqlExec, characterId: number, bundleId: number,
  isBaseline = true,
): Promise<number | null> {
  const [existing] = await exec(
    `SELECT id FROM ${q("character_asset_binding")} ` +
    `WHERE character_id = ? AND bundle_id = ?`, [characterId, bundleId]);
  if (existing !== undefined) return null;   // already bound

  await exec(
    `INSERT INTO ${q("character_asset_binding")} ` +
    `(character_id, bundle_id, is_baseline, uuid) VALUES (?, ?, ?, ?)`,
    [characterId, bundleId, isBaseline ? 1 : 0, newUuid()]);
  const [row] = await exec("SELECT last_insert_rowid() AS id");
  return Number(row?.["id"]);
}
