// SPDX-License-Identifier: Apache-2.0
/**
 * screenplay/sceneScript.ts — a scene's lines, located by its HEADING.
 *
 * §3.4 (derived-but-stored): `screenplay_lines.scene_id` is threaded
 * onto body lines at commit. It is derived state that happens to be
 * stored, and it is absent for lines typed since the last commit and
 * for files written before the threading existed. Implementations MUST
 * NOT rely on it. To read a scene's text: find the heading line linked
 * to that scene, and take every line up to the next heading.
 *
 * This lived only in `scf-app/src/editor/shootOps.ts` until 0.49, where
 * it served the Shoot tab's read-only scene spine. §12.17 now gives Q04
 * a `screenplay` member, which needs the same derivation — so it moves
 * here and the app imports it. One rule described in two places drifts;
 * this one describes a MUST.
 */

import type { Row, SqlExec } from "../db.ts";
import { projectRow, type ProjectedRow, type UuidLookup }
  from "../queryResult.ts";

/**
 * The lines of one scene, in `line_order`, starting at the scene's
 * heading and stopping before the next heading.
 *
 * The COALESCE chain is the honest reading of §3.4's three cases:
 *
 *  1. the scene has a heading line — the normal case, and the one the
 *     rule is written for;
 *  2. it has no heading but some line carries its `scene_id` — start
 *     there rather than returning nothing, since something is better
 *     anchored than nothing;
 *  3. neither — an empty answer, which is correct. Scene 17 of the
 *     conformance fixture is exactly this: a scene authored in the
 *     database with no line in the screenplay yet.
 *
 * The terminating bound is the next heading by `line_order`, whichever
 * scene it belongs to. A cut scene's heading still ends the previous
 * scene's text: §6.6.1 excludes cut ROWS from a result, and those lines
 * belong to the cut scene rather than to this one — they are not in
 * this answer because the bound stops before them, not because they
 * were filtered.
 *
 * Bind the scene id three times.
 */
export const SCENE_SCRIPT_SQL =
  "SELECT * FROM screenplay_lines " +
  "WHERE line_order >= COALESCE(" +
  "    (SELECT MIN(line_order) FROM screenplay_lines " +
  "     WHERE scene_id = ? AND line_type = 'heading'), " +
  "    (SELECT MIN(line_order) FROM screenplay_lines WHERE scene_id = ?), " +
  "    9e18) " +
  "  AND line_order < COALESCE((SELECT MIN(line_order) " +
  "     FROM screenplay_lines WHERE line_type = 'heading' " +
  "       AND line_order > COALESCE(" +
  "         (SELECT MIN(line_order) FROM screenplay_lines " +
  "          WHERE scene_id = ? AND line_type = 'heading'), -1)), 9e18) " +
  "ORDER BY line_order";

export async function sceneScriptLines(
    exec: SqlExec, sceneId: number): Promise<Row[]> {
  return exec(SCENE_SCRIPT_SQL, [sceneId, sceneId, sceneId]);
}

/**
 * The reference columns of `screenplay_lines`, for §12.1.2's resolution
 * rule.
 *
 * The registry cannot declare these — `screenplay_lines` is a
 * `uuidExtraTable` (§1.3), not an entity — so unlike every other
 * reference map in this codebase, this one is written by hand. §12.17
 * publishes it for that reason: a hand-written map that is not also
 * published is the exact shape of the defect §12.1.2 records.
 *
 * `scene_id` is deliberately ABSENT rather than listed. It is not
 * omitted as a reference that failed to resolve — it is dropped
 * outright by `projectScreenplayLines` below, because §3.4 forbids
 * relying on it and a normative answer that carries it invites exactly
 * that.
 */
export const SCREENPLAY_LINE_REFERENCES: Readonly<Record<string, string>> = {
  character_id: "character",
  location_id: "location",
};

/**
 * A scene's lines as projected rows (§12.1.2), with `scene_id` dropped.
 *
 * `screenplay_lines` carries uuid identity on §6.1's terms, so its rows
 * project like any other; the column names come from
 * `screenplay-tables.json` (§1.3.1) rather than from the registry,
 * which is the only difference.
 */
export function projectScreenplayLines(
    rows: readonly Row[], lookup: UuidLookup): ProjectedRow[] {
  return rows.map((row) => {
    const { scene_id: _dropped, ...rest } = row;
    return projectRow(rest as Row, SCREENPLAY_LINE_REFERENCES, lookup);
  });
}
