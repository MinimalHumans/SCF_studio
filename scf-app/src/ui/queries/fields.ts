// SPDX-License-Identifier: Apache-2.0
/**
 * fields.ts — reading a projected row (§12.1.2) for display.
 *
 * Query pages render scf-core's normative results, whose rows are
 * `{ uuid, fields }`: framework columns dropped, references resolved to
 * `<name>_uuid`, empties omitted, keys sorted. Shared by the markdown and
 * the human views so both show the same fields in the same order.
 */

import type { ProjectedRow } from "@scf-core/queryResult.ts";
import type { Registry } from "@scf-core/registry.ts";

/** Authored, but not worth a line: identity, lifecycle, version plumbing. */
const SKIP = new Set([
  "name", "lifecycle_status", "external_id", "external_id_namespace",
  "version_label", "superseded_at",
]);

/** A row's display name, or `fallback` when it carries none. */
export function nameOf(row: ProjectedRow | null | undefined,
                       fallback = "—"): string {
  const v = row?.fields["name"];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}

/** One field, or null when the row does not carry it. */
export function field(row: ProjectedRow | null | undefined,
                      key: string): string | null {
  const v = row?.fields[key];
  return v === undefined || v === null || v === "" ? null : String(v);
}

/**
 * The authored fields worth showing, in the registry's column order
 * rather than the projection's alphabetical one — a profile reads in
 * the order it was designed to be filled in. Resolved references
 * (`*_uuid`) are skipped: a uuid is identity, not content.
 */
export function authoredEntries(
    registry: Registry, entity: string | null, row: ProjectedRow,
    includeName = false): Array<[string, unknown]> {
  const keep = (k: string): boolean =>
    (includeName ? k === "name" || !SKIP.has(k) : !SKIP.has(k)) &&
    !k.endsWith("_uuid");
  const order = entity === null ? []
    : (registry.entities.get(entity)?.fields ?? []).map((f) => f.name);
  const keys = Object.keys(row.fields).filter(keep);
  const rank = (k: string): number => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return keys
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((k) => [k, row.fields[k]]);
}

/**
 * Markdown text for a field value. A `string_list` arrives as an array
 * and is written back as the JSON it was stored as, so a context block
 * reads the same whether or not the column was declared a list.
 */
export function valueText(v: unknown): string {
  if (Array.isArray(v) || (typeof v === "object" && v !== null)) {
    return JSON.stringify(v);
  }
  return String(v);
}
