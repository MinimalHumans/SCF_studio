/**
 * subjectStats.ts — how often a subject appears, and where it first
 * does, so the subject rail can be sorted by something other than the
 * alphabet.
 *
 * The paths are derived from the reference graph rather than listed by
 * hand: anything that points at the subject AND carries a scene_id ties
 * that subject to a story position, as does a scene pointing at it
 * directly (scene.location_id) and the subject's own scene_id (a shot).
 * A subject with no such path — a theme, a project — simply has no
 * story order, and the rail says so by offering only A–Z.
 */

import { q } from "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";

export type SubjectSort = "name" | "story" | "uses";

export interface SubjectStat {
  /** Rows tying this subject to a scene — "how much it is used". */
  uses: number;
  /** Distinct scenes it appears in. */
  scenes: number;
  /** Scene number of its first appearance; NO_POSITION when unnumbered. */
  firstNumber: number;
  /** Scene id, to break ties between equal or absent numbers. */
  firstSceneId: number;
}

export const NO_POSITION = 1e9;

/** One `SELECT sid, scene_id, n` per way the subject reaches a scene. */
export function subjectScenePaths(registry: Registry,
                                  subject: string): string[] {
  const edef = registry.entities.get(subject);
  if (edef === undefined) return [];
  const paths: string[] = [];

  // The subject carries its own position: a scene IS one, a shot has one.
  if (subject === "scene") {
    paths.push(
      "SELECT s.id AS sid, s.id AS scene_id, s.scene_number AS n " +
      "FROM scene s");
  } else if (edef.fields.some((f) => f.name === "scene_id")) {
    paths.push(
      `SELECT x.id AS sid, sc.id AS scene_id, sc.scene_number AS n ` +
      `FROM ${q(subject)} x JOIN scene sc ON sc.id = x.scene_id`);
  }

  for (const other of registry.entities.values()) {
    const carriesScene = other.name === "scene" ||
      other.fields.some((f) => f.name === "scene_id");
    if (!carriesScene) continue;
    for (const f of other.fields) {
      if (f.fieldType !== "reference" || f.referenceEntity !== subject) {
        continue;
      }
      if (f.name === "parent_id" || f.name === "superseded_by_id") continue;
      paths.push(other.name === "scene"
        ? `SELECT sc.${q(f.name)} AS sid, sc.id AS scene_id, ` +
          `sc.scene_number AS n FROM scene sc ` +
          `WHERE sc.${q(f.name)} IS NOT NULL`
        : `SELECT x.${q(f.name)} AS sid, sc.id AS scene_id, ` +
          `sc.scene_number AS n FROM ${q(other.name)} x ` +
          `JOIN scene sc ON sc.id = x.scene_id ` +
          `WHERE x.${q(f.name)} IS NOT NULL`);
    }
  }
  return paths;
}

/**
 * One statement for the whole rail — a UNION over the paths, aggregated
 * per subject. Scene has 39 paths in 2.3; that is still one round trip
 * rather than 39, and it re-runs only when the sort or the data changes.
 */
export function subjectStatsSql(registry: Registry,
                                subject: string): string | null {
  const paths = subjectScenePaths(registry, subject);
  if (paths.length === 0) return null;
  return (
    "SELECT sid, COUNT(*) AS uses, COUNT(DISTINCT scene_id) AS scenes, " +
    `MIN(CASE WHEN n IS NULL THEN ${String(NO_POSITION)} ELSE n END) ` +
    "AS first_number, MIN(scene_id) AS first_scene_id FROM (" +
    paths.join(" UNION ALL ") +
    ") GROUP BY sid");
}

/**
 * Rail order. Every mode falls back to the name so the list is stable
 * rather than jittering between equal rows, and subjects with no scene
 * anywhere sort last under both non-alphabetical modes — an unplaced
 * row is not a rank-zero row, it is a row with nothing to rank on.
 */
export function compareSubjects(
    sort: SubjectSort,
    a: { name: string; stat?: SubjectStat },
    b: { name: string; stat?: SubjectStat }): number {
  const byName = a.name.localeCompare(b.name);
  if (sort === "name") return byName;
  if (sort === "uses") {
    const ua = a.stat?.uses ?? -1;
    const ub = b.stat?.uses ?? -1;
    if (ua !== ub) return ub - ua;
    const sa = a.stat?.scenes ?? -1;
    const sb = b.stat?.scenes ?? -1;
    if (sa !== sb) return sb - sa;
    return byName;
  }
  const pa = a.stat?.firstNumber ?? NO_POSITION;
  const pb = b.stat?.firstNumber ?? NO_POSITION;
  if (pa !== pb) return pa - pb;
  const ia = a.stat?.firstSceneId ?? NO_POSITION;
  const ib = b.stat?.firstSceneId ?? NO_POSITION;
  if (ia !== ib) return ia - ib;
  return byName;
}
