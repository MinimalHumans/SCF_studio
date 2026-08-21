// SPDX-License-Identifier: Apache-2.0
/**
 * numbering.ts — resolving the numbering policy. Spec §4.3.
 *
 * `project.numbering_policy` governs whether act, sequence and scene
 * numbers and shot codes are recomputed at commit. It was called
 * `scene_numbering` until schema 2.11 — a name that described one of the
 * four things it governs — and 2.12 removed the old column outright.
 *
 * 2.11 had carried both columns with the writer mirroring into the old
 * one, which is what §11.4's deprecation window prescribes. That window
 * existed solely to protect files written before 2.11, and pre-1.0 there
 * are no such files worth protecting: the deprecation machinery is
 * specified and becomes binding at 1.0, when it earns its cost. Carrying
 * it early bought nothing and left the format storing one fact twice.
 *
 * So this module is now small. It exists to keep the resolution rule —
 * including what an absent or unrecognised value means — in one place
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
