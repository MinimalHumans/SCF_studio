// SPDX-License-Identifier: Apache-2.0
/**
 * projectName.ts — the version-suffix rule shared by Save As
 * (`suggestSaveAsName`, scf-app) and the open-time weak match
 * (file-management-plan.md §3.2): "hollow_creek" and "hollow_creek_v2"
 * are the same project by name. One rule, so a weak match at open
 * time and the name Save As would propose never disagree.
 */

/** `name` without its `.scf` extension, case-insensitive. */
export function withoutScfExtension(name: string): string {
  return /\.scf$/i.test(name) ? name.slice(0, -4) : name;
}

const VERSIONED = /^(.*?)([._-]?v)(\d+)$/i;
const NUMBERED = /^(.*?)([._-])(\d+)$/;

/**
 * `base` (already extension-free) with a trailing version marker
 * stripped — `_v2`, `-v9`, `.v1`, a bare `-004` — whatever the
 * separator. A name with no such marker comes back unchanged.
 */
export function stripVersionSuffix(base: string): string {
  const versioned = VERSIONED.exec(base);
  if (versioned !== null) return versioned[1] ?? base;
  const numbered = NUMBERED.exec(base);
  if (numbered !== null) return numbered[1] ?? base;
  return base;
}

/**
 * `base` stepped to its next version: an existing marker increments
 * (zero padding kept for a bare number), and a name with none gets
 * `_v2` appended.
 */
export function bumpVersionSuffix(base: string): string {
  const versioned = VERSIONED.exec(base);
  if (versioned !== null) {
    return `${versioned[1]}${versioned[2]}${String(Number(versioned[3]) + 1)}`;
  }
  const numbered = NUMBERED.exec(base);
  if (numbered !== null) {
    const digits = numbered[3] ?? "";
    const next = String(Number(digits) + 1).padStart(digits.length, "0");
    return `${numbered[1]}${numbered[2]}${next}`;
  }
  return `${base}_v2`;
}

/**
 * The comparison key for "is this the same project by file name": the
 * name with its extension and any version suffix gone. What `app.db`
 * stores as `base_name` (file-management-plan.md §3.1).
 */
export function baseNameOf(fileName: string): string {
  return stripVersionSuffix(withoutScfExtension(fileName));
}
