// SPDX-License-Identifier: Apache-2.0
/**
 * editor/mediaChecks.ts — media authoring that looks complete and isn't.
 *
 * Each check here is something the first MCP session hit while writing a
 * shot prompt, and each one was silent in the file: a bundle nobody
 * binds, a binding that applies at every scene without being a baseline,
 * a `.wav` in a visual bundle, `Reference` next to `reference`, a `json`
 * column holding a comma list. None is wrong by the format's rules —
 * SCF reports, it does not enforce (conventions §1) — so these are
 * editor findings, never format findings, and nothing here writes.
 *
 * The pure helpers are exported for the form components; `scanMedia`
 * is the whole-file sweep the Assets tab shows.
 */

import type { SqlExec } from "@scf-core/db.ts";
import { q } from "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";
import { formatOf } from "@scf-core/assets.ts";
import {
  BINDING_SUBJECTS, unboundBundleIds,
} from "@scf-core/bundling.ts";

export type MediaKind = "image" | "video" | "audio" | "model" | "other";

const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif",
  "bmp", "tif", "tiff", "exr", "dpx", "psd"]);
const VIDEO = new Set(["mp4", "webm", "ogv", "mov", "mxf", "r3d", "ari"]);
const AUDIO = new Set(["wav", "mp3", "ogg", "oga", "flac", "m4a", "aac",
  "aif", "aiff"]);
const MODEL = new Set(["glb", "gltf", "fbx", "obj", "abc", "usd", "usdc",
  "usdz", "usda"]);

/** A coarse media kind from an identifier's extension, or null if none. */
export function mediaKindOf(identifier: string | null): MediaKind | null {
  if (identifier === null) return null;
  const ext = formatOf(identifier);
  if (ext === null) return null;
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (MODEL.has(ext)) return "model";
  return "other";
}

/** Intents a picture serves, and intents a recording serves. */
const SEEN = new Set(["visual_identity", "surface", "environment", "motion",
  "performance"]);
const HEARD = new Set(["voice_identity", "acoustic"]);

/**
 * Why this member looks wrong for its bundle's intent, or null.
 *
 * Deliberately narrow: only a contradiction a person would call a
 * mistake on sight. Video is never flagged — it carries picture and
 * sound — and `behavior` / `other` accept anything. Retrieval is BY
 * intent, so a wrong one is a silent miss rather than a visible error;
 * that is the whole reason to say so here.
 */
export function intentConflict(
  intent: string | null, kind: MediaKind | null,
): string | null {
  if (intent === null || kind === null) return null;
  if (kind === "audio" && SEEN.has(intent)) {
    return `audio in a ${intent} bundle — a sound query will not find it`;
  }
  if ((kind === "image" || kind === "model") && HEARD.has(intent)) {
    return `${kind === "image" ? "an image" : "a 3D model"} in a ${intent} ` +
      `bundle — a picture query will not find it`;
  }
  return null;
}

/** One spelling of a value and how many rows carry it. */
export interface Spelling { value: string; count: number }

const fold = (s: string): string =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

/** Levenshtein distance, capped — only "is it at most 1" is asked. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Groups of values that are probably one value spelled several ways:
 * the same after case and whitespace folding, or one character apart
 * once both are at least eight characters long (short words one edit
 * apart are usually different words — `face` / `lace`).
 *
 * Within a group the most-used spelling comes first; it is what the
 * editor offers to adopt. Nothing is rewritten.
 */
export function lookalikeGroups(values: readonly (string | null)[]):
    Spelling[][] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null || v.trim() === "") continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const spellings = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const groups: Spelling[][] = [];
  const placed = new Set<string>();
  for (const s of spellings) {
    if (placed.has(s.value)) continue;
    const group = [s];
    placed.add(s.value);
    for (const t of spellings) {
      if (placed.has(t.value)) continue;
      const a = fold(s.value);
      const b = fold(t.value);
      const near = a === b
        || (a.length >= 8 && b.length >= 8 && withinOneEdit(a, b));
      if (near) {
        group.push(t);
        placed.add(t.value);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

/**
 * The existing spelling a typed value should become, if it is the same
 * value in different case or spacing. Only an exact fold match is
 * adopted automatically; a one-letter difference is a question, not an
 * answer, and is left to the checks panel.
 */
export function adoptSpelling(
  typed: string, existing: readonly string[],
): string {
  const t = fold(typed);
  if (t === "") return typed.trim();
  const hit = existing.find((e) => fold(e) === t);
  return hit ?? typed.trim();
}

/**
 * A comma-separated list typed into a JSON field, as the JSON array it
 * was meant to be — or null if the text is valid JSON already, or does
 * not look like a plain list (brackets, braces or quotes mean someone
 * was attempting JSON, and guessing at a half-written object is worse
 * than saying it is invalid).
 */
export function commaListToJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    JSON.parse(trimmed);
    return null;
  } catch {
    // fall through
  }
  if (/[[\]{}"]/.test(trimmed)) return null;
  const items = trimmed.split(",").map((s) => s.trim()).filter((s) => s !== "");
  return items.length === 0 ? null : JSON.stringify(items);
}

export interface UnboundBundle {
  id: number; name: string | null; intent: string | null; assetCount: number;
}
export interface BindingRef {
  entity: string; id: number; name: string | null;
  subjectType: string; subjectName: string | null; bundleName: string | null;
}
export interface IntentConflictRow {
  bundleId: number; bundleName: string | null; intent: string;
  assetId: number; assetName: string | null; reason: string;
}
export interface LookalikeField {
  entity: string; field: string; groups: Spelling[][];
}
export interface InvalidJson {
  entity: string; field: string; id: number; value: string;
  /** The list it was probably meant to be, when there is one. */
  suggestion: string | null;
}

export interface MediaReport {
  unboundBundles: UnboundBundle[];
  /** Same subject, bundle and scene range, bound more than once. */
  duplicateBindings: BindingRef[][];
  /** Not a baseline and no scene range: in force at every scene. */
  everywhereBindings: BindingRef[];
  intentConflicts: IntentConflictRow[];
  lookalikes: LookalikeField[];
  invalidJson: InvalidJson[];
}

export const EMPTY_MEDIA_REPORT: MediaReport = {
  unboundBundles: [], duplicateBindings: [], everywhereBindings: [],
  intentConflicts: [], lookalikes: [], invalidJson: [],
};

/** Total findings, for a tab badge. */
export function mediaFindingCount(r: MediaReport): number {
  return r.unboundBundles.length + r.duplicateBindings.length
    + r.everywhereBindings.length + r.intentConflicts.length
    + r.lookalikes.reduce((n, f) => n + f.groups.length, 0)
    + r.invalidJson.length;
}

const s = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/** The whole-file sweep. Reads only. */
export async function scanMedia(
  exec: SqlExec, registry: Registry,
): Promise<MediaReport> {
  const tables = new Set((await exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => String(r["name"])));
  const report: MediaReport = {
    unboundBundles: [], duplicateBindings: [], everywhereBindings: [],
    intentConflicts: [], lookalikes: [], invalidJson: [],
  };
  if (!tables.has("bundle")) return report;

  // --- bundles nobody binds ----------------------------------------------
  const unbound = await unboundBundleIds(exec, registry);
  for (const row of await exec(
    `SELECT b.id, b.name, b.intent, ` +
    `  (SELECT COUNT(*) FROM ${q("bundle_asset")} ba ` +
    `   WHERE ba.bundle_id = b.id) AS n ` +
    `FROM ${q("bundle")} b ORDER BY b.name, b.id`)) {
    const id = Number(row["id"]);
    if (!unbound.has(id)) continue;
    report.unboundBundles.push({
      id, name: s(row["name"]), intent: s(row["intent"]),
      assetCount: Number(row["n"] ?? 0),
    });
  }

  // --- bindings: duplicates, and non-baselines with no range ------------
  for (const subject of BINDING_SUBJECTS) {
    const entity = `${subject}_asset_binding`;
    if (!tables.has(entity) || !tables.has(subject)) continue;
    const rows = await exec(
      `SELECT r.id, r.name, r.${q(`${subject}_id`)} AS sid, r.bundle_id, ` +
      `  r.is_baseline, r.scene_range_start_id AS rs, ` +
      `  r.scene_range_end_id AS re, s.name AS subject_name, ` +
      `  b.name AS bundle_name ` +
      `FROM ${q(entity)} r ` +
      `LEFT JOIN ${q(subject)} s ON s.id = r.${q(`${subject}_id`)} ` +
      `LEFT JOIN ${q("bundle")} b ON b.id = r.bundle_id ` +
      `WHERE (r.lifecycle_status IS NULL OR r.lifecycle_status <> 'cut') ` +
      `ORDER BY r.id`);
    const byKey = new Map<string, BindingRef[]>();
    for (const row of rows) {
      const ref: BindingRef = {
        entity, id: Number(row["id"]), name: s(row["name"]),
        subjectType: subject, subjectName: s(row["subject_name"]),
        bundleName: s(row["bundle_name"]),
      };
      const key = [row["sid"], row["bundle_id"], row["rs"], row["re"]]
        .map((v) => (v === null || v === undefined ? "∅" : String(v)))
        .join("|");
      byKey.set(key, [...(byKey.get(key) ?? []), ref]);
      const baseline = row["is_baseline"] !== null
        && row["is_baseline"] !== undefined
        && Number(row["is_baseline"]) !== 0;
      if (!baseline && row["rs"] === null && row["re"] === null) {
        report.everywhereBindings.push(ref);
      }
    }
    for (const group of byKey.values()) {
      if (group.length > 1) report.duplicateBindings.push(group);
    }
  }

  // --- members whose kind contradicts the bundle's intent ---------------
  if (tables.has("bundle_asset") && tables.has("asset")) {
    for (const row of await exec(
      `SELECT b.id AS bid, b.name AS bname, b.intent, ` +
      `  a.id AS aid, a.name AS aname, a.identifier ` +
      `FROM ${q("bundle_asset")} ba ` +
      `JOIN ${q("bundle")} b ON b.id = ba.bundle_id ` +
      `JOIN ${q("asset")} a ON a.id = ba.asset_id ` +
      `ORDER BY b.name, b.id, ba."order", ba.id`)) {
      const reason = intentConflict(
        s(row["intent"]), mediaKindOf(s(row["identifier"])));
      if (reason === null) continue;
      report.intentConflicts.push({
        bundleId: Number(row["bid"]), bundleName: s(row["bname"]),
        intent: String(row["intent"]), assetId: Number(row["aid"]),
        assetName: s(row["aname"]), reason,
      });
    }
  }

  // --- free text that is one value in several spellings -----------------
  for (const [entity, field] of [
    ["bundle_asset", "role_in_bundle"], ["asset", "source"],
  ] as const) {
    if (!tables.has(entity)) continue;
    const values = (await exec(`SELECT ${q(field)} AS v FROM ${q(entity)}`))
      .map((r) => s(r["v"]));
    const groups = lookalikeGroups(values);
    if (groups.length > 0) report.lookalikes.push({ entity, field, groups });
  }

  // --- json columns that do not hold JSON --------------------------------
  for (const entity of registry.order) {
    const def = registry.entities.get(entity);
    if (def === undefined || !tables.has(entity)) continue;
    for (const f of def.fields) {
      if (f.fieldType !== "json") continue;
      for (const row of await exec(
        `SELECT id, ${q(f.name)} AS v FROM ${q(entity)} ` +
        `WHERE ${q(f.name)} IS NOT NULL AND TRIM(${q(f.name)}) <> ''`)) {
        const value = String(row["v"]);
        try {
          JSON.parse(value);
        } catch {
          report.invalidJson.push({
            entity, field: f.name, id: Number(row["id"]), value,
            suggestion: commaListToJson(value),
          });
        }
      }
    }
  }

  return report;
}

/** Distinct non-empty values of one column, most used first. */
export async function columnValues(
  exec: SqlExec, entity: string, field: string, limit = 50,
): Promise<string[]> {
  try {
    return (await exec(
      `SELECT ${q(field)} AS v, COUNT(*) AS n FROM ${q(entity)} ` +
      `WHERE ${q(field)} IS NOT NULL AND TRIM(${q(field)}) <> '' ` +
      `GROUP BY ${q(field)} ORDER BY n DESC, v LIMIT ?`, [limit]))
      .map((r) => String(r["v"]));
  } catch {
    return [];
  }
}
