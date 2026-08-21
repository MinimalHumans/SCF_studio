// SPDX-License-Identifier: Apache-2.0
/**
 * assetIndex.ts — navigating thousands of assets (P4).
 *
 * The organising principle from the plan, restated because everything
 * here follows from it: DO NOT PICK ONE AXIS. Any single hierarchy —
 * type, intent, name, path — is wrong for half its users and has to be
 * maintained by hand.
 *
 * So: the bundle graph is the authored structure and stays where it is;
 * the path tree here is DERIVED from the identifier and costs nothing,
 * since the identifier is stored anyway; and everything else is a facet
 * rather than a folder, because facets compose and hierarchies do not.
 *
 * The failure mode this is built against is not search but ORPHANS.
 * At a thousand rows the problem is never "I cannot find it" — it is
 * the assets nobody linked, quietly rotting. `orphanIds()` is
 * therefore a first-class query rather than something a user has to
 * notice, and it is derived from the registry: every reference to
 * `asset` anywhere in the schema counts, so a junction added in a
 * later version is covered without anyone remembering to come back
 * here.
 */

import { q, type SqlExec } from "./db.ts";
import { formatOf, parseIdentifier } from "./assets.ts";
import type { Registry } from "./registry.ts";

export interface AssetRow {
  id: number;
  name: string | null;
  identifier: string | null;
  root: string | null;
  /** Path below the root, or null when unaddressed. */
  path: string | null;
  format: string | null;
  lifecycleStatus: string | null;
}

export async function listAssets(exec: SqlExec): Promise<AssetRow[]> {
  const rows = await exec(
    `SELECT id, name, identifier, lifecycle_status FROM ${q("asset")} ` +
    `ORDER BY id`);
  return rows.map((row) => {
    const raw = row["identifier"] === null || row["identifier"] === undefined
      ? null : String(row["identifier"]);
    const parsed = raw === null ? null : parseIdentifier(raw);
    return {
      id: Number(row["id"]),
      name: row["name"] === null || row["name"] === undefined
        ? null : String(row["name"]),
      identifier: raw,
      root: parsed?.root ?? null,
      path: parsed === null ? null : parsed.path,
      format: raw === null ? null : formatOf(raw),
      lifecycleStatus: row["lifecycle_status"] === null ||
        row["lifecycle_status"] === undefined
        ? null : String(row["lifecycle_status"]),
    };
  });
}

/**
 * Every column anywhere in the schema that points at an asset.
 *
 * Read off the registry rather than listed by hand: `bundle_asset`,
 * `entity_anchor` and `asset_relationship` are the ones that exist
 * today, and a junction added in 2.9 is covered without an edit here.
 * The asset table's own version columns are excluded — a row whose
 * only inbound reference is its own successor is still an orphan, and
 * counting supersession as usage would hide exactly the rows worth
 * finding.
 */
export function assetReferenceColumns(
  registry: Registry,
): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  for (const [name, edef] of registry.entities) {
    for (const field of edef.fields) {
      if (field.referenceEntity !== "asset") continue;
      if (name === "asset" && field.autoInjected) continue;
      out.push({ table: name, column: field.name });
    }
  }
  return out;
}

/**
 * Assets that nothing points at.
 *
 * Counted in SQL rather than by pulling every junction into memory:
 * this runs on a panel open over a working project, and the whole
 * reason the feature exists is scale.
 */
export async function orphanIds(
  exec: SqlExec, registry: Registry,
): Promise<Set<number>> {
  const columns = assetReferenceColumns(registry);
  const present = new Set((await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => String(r["name"])));

  const used = new Set<number>();
  for (const { table, column } of columns) {
    if (!present.has(table)) continue;
    const rows = await exec(
      `SELECT DISTINCT ${q(column)} AS ref FROM ${q(table)} ` +
      `WHERE ${q(column)} IS NOT NULL`);
    for (const row of rows) used.add(Number(row["ref"]));
  }

  const all = await exec(`SELECT id FROM ${q("asset")}`);
  const orphans = new Set<number>();
  for (const row of all) {
    const id = Number(row["id"]);
    if (!used.has(id)) orphans.add(id);
  }
  return orphans;
}

export interface Facet {
  value: string;
  count: number;
}

export interface AssetFacets {
  formats: Facet[];
  roots: Facet[];
  lifecycle: Facet[];
  total: number;
  orphans: number;
  unaddressed: number;
}

function tally(values: (string | null)[], nullLabel: string): Facet[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v ?? nullLabel;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function facetsOf(
  assets: readonly AssetRow[], orphans: ReadonlySet<number>,
): AssetFacets {
  return {
    formats: tally(assets.map((a) => a.format), "no extension"),
    roots: tally(assets.map((a) => a.root), "unrooted"),
    lifecycle: tally(assets.map((a) => a.lifecycleStatus), "unset"),
    total: assets.length,
    orphans: assets.filter((a) => orphans.has(a.id)).length,
    unaddressed: assets.filter((a) => a.identifier === null).length,
  };
}

export interface TreeNode {
  /** Segment name; "" for the root node. */
  name: string;
  /** Full prefix including trailing slash, for relink and filtering. */
  prefix: string;
  children: TreeNode[];
  /** Assets directly in this folder, not in its children. */
  assetIds: number[];
  /** Assets here and below — what a folder row should show. */
  totalCount: number;
}

/**
 * The path tree, derived from identifiers alone.
 *
 * Free, because the identifier is stored anyway, and it matches the
 * folder layout a production already maintains — the Hollow Creek
 * fixture sorted itself into `assets/locations/`, `assets/props/` and
 * `assets/sound/` without anyone specifying a convention. It is a VIEW:
 * nothing here is authored, nothing is stored, and moving a file
 * changes the tree rather than breaking it.
 */
export function pathTree(assets: readonly AssetRow[]): TreeNode {
  const root: TreeNode = {
    name: "", prefix: "", children: [], assetIds: [], totalCount: 0,
  };

  for (const asset of assets) {
    if (asset.identifier === null || asset.path === null) continue;
    const prefix = asset.root === null ? "" : `@${asset.root}/`;
    const segments = asset.path.split("/").filter((s) => s !== "");
    const folders = segments.slice(0, -1);

    let node = root;
    node.totalCount += 1;
    let walked = prefix;
    for (const segment of folders) {
      walked += `${segment}/`;
      let child = node.children.find((c) => c.name === segment &&
                                            c.prefix === walked);
      if (child === undefined) {
        child = { name: segment, prefix: walked, children: [],
                  assetIds: [], totalCount: 0 };
        node.children.push(child);
      }
      child.totalCount += 1;
      node = child;
    }
    node.assetIds.push(asset.id);
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.children) sortTree(child);
}

export interface AssetFilter {
  /** Substring match on name and identifier, case-insensitive. */
  text?: string;
  format?: string | null;
  root?: string | null;
  prefix?: string;
  orphansOnly?: boolean;
  unaddressedOnly?: boolean;
}

/**
 * Facets compose. Every filter narrows the same list, and none of them
 * is a folder the user has to be in.
 */
export function applyFilter(
  assets: readonly AssetRow[], filter: AssetFilter,
  orphans: ReadonlySet<number>,
): AssetRow[] {
  const text = filter.text?.trim().toLowerCase() ?? "";
  return assets.filter((a) => {
    if (filter.orphansOnly === true && !orphans.has(a.id)) return false;
    if (filter.unaddressedOnly === true && a.identifier !== null) {
      return false;
    }
    if (filter.format !== undefined && a.format !== filter.format) {
      return false;
    }
    if (filter.root !== undefined && a.root !== filter.root) return false;
    if (filter.prefix !== undefined && filter.prefix !== "" &&
        !(a.identifier ?? "").startsWith(filter.prefix)) {
      return false;
    }
    if (text !== "") {
      const haystack = `${a.name ?? ""} ${a.identifier ?? ""}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}
