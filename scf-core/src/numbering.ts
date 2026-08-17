/**
 * numbering.ts — resolving the numbering policy. Spec §4.3.
 *
 * `project.numbering_policy` governs whether act, sequence and scene
 * numbers and shot codes are recomputed at commit. It was called
 * `scene_numbering` until schema 2.11, a name that described one of the
 * four things it governs.
 *
 * The rename is running through §11.4's deprecation window rather than
 * as a break: 2.11 adds the new column and keeps the old one readable,
 * 2.12 removes the old one. So this module exists to make sure no caller
 * ever has to know that, and to keep the precedence rule in one place
 * rather than in every reader that happens to need it.
 *
 * The mirroring §4.3 requires of writers is a deliberate, time-boxed
 * exception to §3.1's rule against storing a value twice. Without it a
 * reader that only knows the old column would see a stale policy and
 * could renumber a locked project — which is the one failure this field
 * exists to prevent.
 */

import type { Row, SqlExec } from "./db.ts";

export type NumberingPolicy = "derived" | "fixed";

/** What a file with no policy at all means. */
export const DEFAULT_NUMBERING_POLICY: NumberingPolicy = "derived";

const clean = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === ""
    ? null : String(v).trim();

/**
 * Read the policy from a project row, preferring the current column.
 *
 * Anything that is neither `derived` nor `fixed` resolves to the
 * default: §9.1 says findings are reported, never a reason to refuse,
 * and a resolver must stay total (§9.2).
 */
export function numberingPolicyOf(project: Row | undefined | null):
    NumberingPolicy {
  if (project === undefined || project === null) {
    return DEFAULT_NUMBERING_POLICY;
  }
  const current = clean(project["numbering_policy"]);
  const legacy = clean(project["scene_numbering"]);
  const value = current ?? legacy;
  return value === "fixed" || value === "derived"
    ? value : DEFAULT_NUMBERING_POLICY;
}

/** Read the policy from the database's first project row. */
export async function numberingPolicy(exec: SqlExec):
    Promise<NumberingPolicy> {
  try {
    const rows = await exec("SELECT * FROM project ORDER BY id LIMIT 1");
    return numberingPolicyOf(rows[0]);
  } catch {
    // No project table, or an unreadable one. Total, per §9.2.
    return DEFAULT_NUMBERING_POLICY;
  }
}

/**
 * Set the policy, writing both columns while the deprecated one exists.
 *
 * Returns the statements issued, so a caller can log or test them
 * without re-deriving what the deprecation window requires.
 */
export async function setNumberingPolicy(
    exec: SqlExec, policy: NumberingPolicy): Promise<void> {
  await exec(
    "UPDATE project SET numbering_policy = ? " +
    "WHERE id = (SELECT id FROM project ORDER BY id LIMIT 1)",
    [policy]);
  // The mirror. Remove with the column in schema 2.12.
  await exec(
    "UPDATE project SET scene_numbering = ? " +
    "WHERE id = (SELECT id FROM project ORDER BY id LIMIT 1)",
    [policy]);
}
