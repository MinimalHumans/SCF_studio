// SPDX-License-Identifier: Apache-2.0
import { bumpVersionSuffix, withoutScfExtension } from "@scf-core/projectName.ts";

/**
 * Filename the Save-As picker opens with.
 *
 * `bump` (Save As) proposes the next version so the common case — keep
 * the working file, write the next one — is a single Return:
 *   hollow_creek.scf      → hollow_creek_v2.scf
 *   hollow_creek_v2.scf   → hollow_creek_v3.scf
 *   hollow_creek-004.scf  → hollow_creek-005.scf   (zero padding kept)
 * A project that has no file yet (the demo, a new project) is only given
 * the extension — there is no earlier version to step past.
 *
 * The stepping rule itself is `scf-core`'s `bumpVersionSuffix`, shared
 * with the open-time weak match (file-management-plan.md §3.2) so the
 * two never disagree about what counts as "the same project, another
 * version."
 */
export function suggestSaveAsName(
    current: string | null, bump = false): string {
  if (current === null || current.trim() === "") return "project.scf";
  const hasExt = /\.scf$/i.test(current);
  const base = withoutScfExtension(current);
  if (!bump || !hasExt) return `${base || "project"}.scf`;
  return `${bumpVersionSuffix(base)}.scf`;
}

/**
 * Filename an exported .fountain lands under.
 *
 * A constant "screenplay.fountain" for every project is how an export
 * ends up sitting next to — or on top of — the file it was imported
 * from. Naming it after the project makes the relationship obvious and
 * stops two projects' exports colliding in a downloads folder.
 *
 * The import itself never writes anywhere: it reads through a plain file
 * input, which hands the page a read-only snapshot and no way back to
 * the disk. Export is the only path that produces a fountain file, and
 * it always produces a NEW one.
 */
export function suggestExportName(current: string | null): string {
  const base = (current ?? "").trim().replace(/\.scf$/i, "").trim();
  return base === "" ? "screenplay.fountain" : `${base}.fountain`;
}
