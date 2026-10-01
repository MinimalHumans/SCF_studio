// SPDX-License-Identifier: Apache-2.0
/**
 * lines.ts — line anchors (spec §3.5) and the lines a shot or clip covers
 * (§4.7).
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
 * The entities that carry a range: both range anchors and a scene to
 * belong to. Derived, so `shot` and `clip` are found rather than listed.
 */
export function rangeEntities(registry: Registry): string[] {
  const anchors = lineAnchorFields(registry);
  const has = (entity: string, field: string) =>
    anchors.some((a) => a.entity === entity && a.field === field);
  return registry.order.filter((name) =>
    has(name, "line_start_ref") && has(name, "line_end_ref") &&
    (registry.entities.get(name)?.fields ?? [])
      .some((f) => f.name === "scene_id"));
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

/** A line problem, for the finding catalog (§3.5, §4.7). */
export interface LineProblem {
  code: "line.anchor_orphaned" | "line.range_outside_scene"
    | "line.range_reversed" | "line.end_without_start";
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
  const orphaned = await orphanedAnchors(ctx.exec, ctx.registry);
  for (const o of orphaned) {
    out.push({ code: "line.anchor_orphaned", table: o.entity,
      rowId: o.rowId,
      message: `${o.entity}.${o.field} names line ${o.uuid}, which is ` +
        `not in the screenplay.` });
  }
  for (const entity of rangeEntities(ctx.registry)) {
    let found: Row[];
    try { found = await rows(ctx.exec, entity); } catch { continue; }
    for (const r of found) {
      const sceneId = Number(r["scene_id"]);
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
