// SPDX-License-Identifier: Apache-2.0
/**
 * lines.ts — line anchors (spec §3.5), the lines a shot or clip covers
 * (§4.7), and the closed `line_type` set (§1.3.1) as findings.
 *
 * A line anchor is a text field holding a screenplay line's uuid. The
 * registry marks every one (`lineAnchor`), and this module reads them from
 * there, so a new anchor is swept, re-anchorable and checked the day it is
 * declared. `screenplay_prop_tags.line_uuid` is the one anchor outside the
 * registry, since that table is a screenplay table (§1.3.1), and it is
 * named here once.
 *
 * A range is two anchors, `line_start_ref` and `line_end_ref`, on an entity
 * that belongs to a scene. It covers that scene's lines, located by the
 * heading as Q04 locates them (§3.4), from start to end inclusive in script
 * order. Ranges may overlap: several shots of one exchange each cover it.
 */

import type { Row, SqlExec } from "./db.ts";
import type { Registry } from "./registry.ts";
import { rows, type ScfContext } from "./resolution.ts";
import { sceneScriptLines } from "./screenplay/sceneScript.ts";
import { LINE_TYPES } from "./fountain/types.ts";

/** One line anchor field. */
export interface LineAnchorField {
  entity: string;
  field: string;
}

/** The one anchor that is not a registry field (§3.5). */
const SCREENPLAY_ANCHORS: readonly LineAnchorField[] = [
  { entity: "screenplay_prop_tags", field: "line_uuid" },
];

/** Every line anchor the format declares, registry first. */
export function lineAnchorFields(registry: Registry): LineAnchorField[] {
  const out: LineAnchorField[] = [];
  for (const name of registry.order) {
    for (const f of registry.entities.get(name)?.fields ?? []) {
      if (f.lineAnchor === true) out.push({ entity: name, field: f.name });
    }
  }
  return [...out, ...SCREENPLAY_ANCHORS];
}

/**
 * The field placing a row in a scene, for its range: `scene_id` where the
 * row belongs to the scene, otherwise its one other reference to `scene`
 * (a clip's `slated_scene_id`, which points without owning, §2.3). Null
 * when there is none, or more than one to choose between.
 */
export function rangeSceneField(registry: Registry,
                                entity: string): string | null {
  const fields = registry.entities.get(entity)?.fields ?? [];
  if (fields.some((f) => f.name === "scene_id")) return "scene_id";
  const refs = fields.filter((f) => f.referenceEntity === "scene");
  return refs.length === 1 ? refs[0]!.name : null;
}

/**
 * The entities that carry a range: both range anchors and a scene to
 * cover. Derived, so `shot` and `clip` are found rather than listed.
 */
export function rangeEntities(registry: Registry): string[] {
  const anchors = lineAnchorFields(registry);
  const has = (entity: string, field: string) =>
    anchors.some((a) => a.entity === entity && a.field === field);
  return registry.order.filter((name) =>
    has(name, "line_start_ref") && has(name, "line_end_ref") &&
    rangeSceneField(registry, name) !== null);
}

const text = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === ""
    ? null : String(v).trim();

/** A table the file does not have reads as empty (§9.2). */
async function safe(exec: SqlExec, sql: string,
                    params: Array<number | string> = []): Promise<Row[]> {
  try { return await exec(sql, params); } catch { return []; }
}

/** The uuids of every line in the screenplay. */
export async function liveLineUuids(exec: SqlExec): Promise<Set<string>> {
  return new Set((await safe(exec, "SELECT uuid FROM screenplay_lines"))
    .map((r) => String(r["uuid"])));
}

/** An anchor naming no line. */
export interface OrphanedAnchor extends LineAnchorField {
  rowId: number;
  uuid: string;
}

/**
 * Every anchor whose uuid names no line (§3.5). `live` is the set of line
 * uuids to check against: the file's, unless a caller holding an unsaved
 * document passes its own.
 */
export async function orphanedAnchors(
    exec: SqlExec, registry: Registry,
    live?: ReadonlySet<string>): Promise<OrphanedAnchor[]> {
  const lines = live ?? await liveLineUuids(exec);
  const out: OrphanedAnchor[] = [];
  for (const a of lineAnchorFields(registry)) {
    for (const r of await safe(exec,
        `SELECT id, "${a.field}" AS anchor FROM "${a.entity}" ` +
        `WHERE "${a.field}" IS NOT NULL AND "${a.field}" != ''`)) {
      const uuid = String(r["anchor"]).trim();
      if (!lines.has(uuid)) {
        out.push({ ...a, rowId: Number(r["id"]), uuid });
      }
    }
  }
  return out;
}

/** What a range says, and why it says nothing where it does not. */
export type RangeVerdict =
  | { kind: "unrecorded" }
  | { kind: "lines"; lines: Row[] }
  | { kind: "problem";
      code: "line.anchor_orphaned" | "line.range_outside_scene"
        | "line.range_reversed" | "line.end_without_start" };

/**
 * The lines a row's range covers in its scene (§4.7).
 *
 * Unrecorded when neither end is set. Whole lines, start to end inclusive,
 * in script order; an unset end is the one line at the start. Anything
 * that cannot be read as a range of this scene is a problem rather than a
 * guess, and the findings report it.
 */
export async function rangeLines(
    exec: SqlExec, sceneId: number, start: unknown,
    end: unknown): Promise<RangeVerdict> {
  const s = text(start);
  const e = text(end);
  if (s === null && e === null) return { kind: "unrecorded" };
  if (s === null) return { kind: "problem", code: "line.end_without_start" };

  const live = await liveLineUuids(exec);
  if (!live.has(s) || (e !== null && !live.has(e))) {
    return { kind: "problem", code: "line.anchor_orphaned" };
  }
  const scene = await sceneScriptLines(exec, sceneId);
  const at = (uuid: string) => scene.findIndex((l) => String(l["uuid"]) === uuid);
  const first = at(s);
  const last = e === null ? first : at(e);
  if (first < 0 || last < 0) {
    return { kind: "problem", code: "line.range_outside_scene" };
  }
  if (last < first) return { kind: "problem", code: "line.range_reversed" };
  return { kind: "lines", lines: scene.slice(first, last + 1) };
}

/** A line problem, for the finding catalog (§1.3.1, §3.5, §4.7). */
export interface LineProblem {
  code: "line.anchor_orphaned" | "line.range_outside_scene"
    | "line.range_reversed" | "line.end_without_start"
    | "line.type_unknown";
  table: string;
  rowId: number;
  message: string;
}

/**
 * Everything §3.5 and §4.7 say to report rather than refuse. An orphaned
 * anchor is reported once, by the anchor sweep, and a range with an
 * orphaned end is not reported again as a range problem.
 */
export async function lineProblems(ctx: ScfContext): Promise<LineProblem[]> {
  const out: LineProblem[] = [];
  // §1.3.1: the set is closed and `line_type` is free TEXT, so a value
  // outside it is a writer's error the file cannot prevent. Story order
  // is derived from these lines (§4.1); a reader guessing that
  // `scene_heading` means `heading` answers wrongly and in silence.
  // The version tables are not read (§0), so only the screenplay is.
  const known = new Set<string>(LINE_TYPES);
  for (const r of await safe(ctx.exec,
      "SELECT id, uuid, line_type FROM screenplay_lines ORDER BY line_order")) {
    const type = String(r["line_type"] ?? "");
    if (known.has(type)) continue;
    out.push({ code: "line.type_unknown", table: "screenplay_lines",
      rowId: Number(r["id"]),
      message: `Line ${String(r["uuid"] ?? r["id"])} has line_type ` +
        `${JSON.stringify(type)}, which is not in the published set; it ` +
        `is unknown content and maps to nothing.` });
  }
  const orphaned = await orphanedAnchors(ctx.exec, ctx.registry);
  for (const o of orphaned) {
    out.push({ code: "line.anchor_orphaned", table: o.entity,
      rowId: o.rowId,
      message: `${o.entity}.${o.field} names line ${o.uuid}, which is ` +
        `not in the screenplay.` });
  }
  for (const entity of rangeEntities(ctx.registry)) {
    const sceneField = rangeSceneField(ctx.registry, entity) ?? "scene_id";
    let found: Row[];
    try { found = await rows(ctx.exec, entity); } catch { continue; }
    for (const r of found) {
      // A clip whose scene was deleted has no scene to cover.
      if (r[sceneField] === null || r[sceneField] === undefined) continue;
      const sceneId = Number(r[sceneField]);
      if (!Number.isFinite(sceneId)) continue;
      const v = await rangeLines(ctx.exec, sceneId, r["line_start_ref"],
                                 r["line_end_ref"]);
      if (v.kind !== "problem" || v.code === "line.anchor_orphaned") continue;
      const label = text(r["shot_number"]) ?? text(r["name"])
        ?? String(r["id"]);
      out.push({ code: v.code, table: entity, rowId: Number(r["id"]),
        message: {
          "line.range_outside_scene":
            `${entity} ${label}: its range names a line outside its scene.`,
          "line.range_reversed":
            `${entity} ${label}: its range ends before it starts.`,
          "line.end_without_start":
            `${entity} ${label}: line_end_ref is set and line_start_ref ` +
            `is not.`,
        }[v.code] });
    }
  }
  return out;
}
