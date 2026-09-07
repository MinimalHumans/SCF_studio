// SPDX-License-Identifier: Apache-2.0
/**
 * numbering.ts — resolving the numbering policy. Spec §4.3.
 *
 * `project.numbering_policy` governs whether act, sequence and scene
 * numbers and shot codes are recomputed at commit. (It carried the
 * narrower name `scene_numbering` before schema 2.12; §11.0 makes
 * pre-1.0 files disposable, so no mirrored column survives.)
 *
 * This module is small on purpose. It exists to keep the resolution rule
 * — including what an absent or unrecognised value means — in one place
 * rather than in every reader that happens to need it.
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
  const value = clean(project["numbering_policy"]);
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

/** Set the policy on the first project row. */
export async function setNumberingPolicy(
    exec: SqlExec, policy: NumberingPolicy): Promise<void> {
  await exec(
    "UPDATE project SET numbering_policy = ? " +
    "WHERE id = (SELECT id FROM project ORDER BY id LIMIT 1)",
    [policy]);
}
