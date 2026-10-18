// SPDX-License-Identifier: Apache-2.0
/**
 * gallery.ts — every picture in the project, and how much each one is
 * carrying.
 *
 * Headless so the ranking can be tested against the fixture. Nothing is
 * stored: the gallery is a reading of the rows that already point at
 * assets, walked forward to the subjects they serve —
 *
 *   bundle_asset → bundle → <kind>_asset_binding → character / location /
 *                                                  prop / costume
 *   entity_anchor → its subject
 *   asset_relationship → the shot, scene, project or other row it is about
 *
 * "Importance" is that reach, weighted by how much of the film each
 * subject is in: an asset is worth one point for every direct use, and
 * for every subject it reaches, one plus the number of scenes that
 * subject appears in. Eleanor's face anchor outranks a reference on a
 * one-scene prop, which outranks a file nothing points at. A heuristic
 * for ordering a wall of pictures, not a measure of anything stored.
 *
 * Cut rows count for nothing (§6.6.1), as everywhere else.
 */

import type { Row, SqlExec } from "./db.ts";
import { previewCapability, type PreviewKind } from "./preview.ts";

export type GallerySubjectKind =
  "character" | "location" | "prop" | "costume" | "scene" | "shot" | "project";

/** One way an asset is used, as the viewer lists it. */
export interface Use {
  /** What it serves; null for a use that reaches no subject (a bundle
   *  nothing binds, a link to another asset). */
  subject: { kind: GallerySubjectKind; id: number; name: string } | null;
  /** How: "look board", "face anchor", "storyboard" … */
  how: string;
}

export interface GalleryItem {
  asset: Row;
  /** From the identifier's extension. */
  kind: PreviewKind | null;
  uses: Use[];
  score: number;
}

export type GallerySort = "importance" | "alphabetical" | "random" | "newest";
export type GalleryFilter =
  "all" | "character" | "location" | "prop" | "shot" | "unused";

export const SORT_LABEL: Record<GallerySort, string> = {
  importance: "By importance",
  alphabetical: "Alphabetical",
  random: "Random",
  newest: "Newest first",
};

export const FILTER_LABEL: Record<GalleryFilter, string> = {
  all: "Everything",
  character: "Characters",
  location: "Locations",
  prop: "Props",
  shot: "Shots and scenes",
  unused: "Not used by anything",
};

/** The extension, lower-cased, of an identifier or file name. */
export function extensionOf(identifier: unknown): string | null {
  if (typeof identifier !== "string") return null;
  const m = /\.([a-z0-9]+)$/i.exec(identifier.trim());
  return m === null ? null : (m[1] ?? "").toLowerCase();
}

/** Run a query, or return nothing when the table is not in this file —
 *  an older schema is not an error for a gallery. */
async function maybe(exec: SqlExec, sql: string): Promise<Row[]> {
  try {
    return await exec(sql);
  } catch {
    return [];
  }
}

const notCut = (alias: string): string =>
  `COALESCE(${alias}.lifecycle_status, 'active') <> 'cut'`;

const BINDING_KINDS = ["character", "location", "prop", "costume"] as const;

/** A board's purpose as a person would say it. */
function intentLabel(intent: unknown): string {
  const s = typeof intent === "string" && intent !== ""
    ? intent.replace(/[_-]+/g, " ") : "reference";
  return `${s} board`;
}

/**
 * Every asset with its uses and score.
 *
 * `includeHistory` keeps superseded and cut assets; off, the gallery is
 * what the film uses now.
 */
export async function loadGallery(exec: SqlExec,
                                  includeHistory = false): Promise<GalleryItem[]> {
  const assets = await exec(
    "SELECT id, uuid, name, identifier, description, tags, lifecycle_status, " +
    "superseded_by_id, created_at FROM asset ORDER BY id");

  // Subject names and how many scenes each is in.
  const names = new Map<string, string>();
  const weight = new Map<string, number>();
  const key = (k: GallerySubjectKind, id: unknown): string => `${k}:${String(id)}`;
  for (const k of ["character", "location", "prop", "costume"] as const) {
    for (const r of await maybe(exec, `SELECT id, name FROM ${k} s WHERE ${notCut("s")}`)) {
      names.set(key(k, r["id"]), String(r["name"] ?? `${k} ${String(r["id"])}`));
    }
  }
  const sceneCounts: Array<[GallerySubjectKind, string]> = [
    ["character", "SELECT character_id AS id, COUNT(DISTINCT scene_id) AS n FROM scene_character GROUP BY character_id"],
    ["location", "SELECT location_id AS id, COUNT(*) AS n FROM scene s WHERE location_id IS NOT NULL AND " + notCut("s") + " GROUP BY location_id"],
    ["prop", "SELECT prop_id AS id, COUNT(DISTINCT scene_id) AS n FROM scene_prop GROUP BY prop_id"],
    ["costume", "SELECT costume_id AS id, COUNT(DISTINCT scene_id) AS n FROM costume_scene GROUP BY costume_id"],
  ];
  for (const [k, sql] of sceneCounts) {
    for (const r of await maybe(exec, sql)) weight.set(key(k, r["id"]), Number(r["n"] ?? 0));
  }
  const scenes = await maybe(exec, `SELECT id, scene_number, name FROM scene s WHERE ${notCut("s")}`);
  for (const s of scenes) {
    const num = s["scene_number"];
    names.set(key("scene", s["id"]), num === null || num === undefined || num === ""
      ? String(s["name"] ?? "Scene") : `Scene ${String(num)}`);
  }
  for (const s of await maybe(exec, `SELECT id, shot_number FROM shot s WHERE ${notCut("s")}`)) {
    names.set(key("shot", s["id"]), `Shot ${String(s["shot_number"] ?? s["id"])}`);
  }
  // The project's poster is the film's face: weighted as if it were in
  // every scene.
  const project = await maybe(exec, "SELECT id, name FROM project LIMIT 1");
  for (const p of project) {
    names.set(key("project", p["id"]), String(p["name"] ?? "Project"));
    weight.set(key("project", p["id"]), scenes.length);
  }

  // Which subjects each bundle reaches.
  const bundleReach = new Map<number, Array<{ kind: GallerySubjectKind; id: number }>>();
  for (const k of BINDING_KINDS) {
    const rows = await maybe(exec,
      `SELECT bundle_id, ${k}_id AS sid FROM ${k}_asset_binding b WHERE ${notCut("b")}`);
    for (const r of rows) {
      if (r["sid"] === null || r["bundle_id"] === null) continue;
      const list = bundleReach.get(Number(r["bundle_id"])) ?? [];
      list.push({ kind: k, id: Number(r["sid"]) });
      bundleReach.set(Number(r["bundle_id"]), list);
    }
  }

  const uses = new Map<number, Use[]>();
  const add = (assetId: unknown, use: Use): void => {
    const id = Number(assetId);
    const list = uses.get(id) ?? [];
    list.push(use);
    uses.set(id, list);
  };
  const subject = (kind: GallerySubjectKind, id: unknown): Use["subject"] => {
    const n = names.get(key(kind, id));
    return n === undefined ? null : { kind, id: Number(id), name: n };
  };

  for (const r of await maybe(exec,
      "SELECT ba.asset_id, ba.bundle_id, b.intent, b.name FROM bundle_asset ba " +
      `JOIN bundle b ON b.id = ba.bundle_id WHERE ${notCut("b")}`)) {
    const reach = bundleReach.get(Number(r["bundle_id"])) ?? [];
    const how = intentLabel(r["intent"]);
    if (reach.length === 0) {
      add(r["asset_id"], { subject: null, how: `in “${String(r["name"] ?? "a bundle")}”, bound to nothing` });
    }
    for (const s of reach) add(r["asset_id"], { subject: subject(s.kind, s.id), how });
  }
  for (const r of await maybe(exec,
      "SELECT asset_id, subject_type, subject_id, anchor_type FROM entity_anchor a " +
      `WHERE ${notCut("a")}`)) {
    const kind = String(r["subject_type"]) as GallerySubjectKind;
    const how = `${String(r["anchor_type"] ?? "identity").replace(/[_-]+/g, " ")} anchor`;
    add(r["asset_id"], { subject: subject(kind, r["subject_id"]), how });
  }
  for (const r of await maybe(exec,
      "SELECT asset_id, entity_type, entity_id, relationship_type FROM asset_relationship")) {
    const kind = String(r["entity_type"]) as GallerySubjectKind;
    const how = String(r["relationship_type"] ?? "related").replace(/[_-]+/g, " ");
    if (kind !== ("asset" as GallerySubjectKind)) {
      add(r["asset_id"], { subject: subject(kind, r["entity_id"]), how });
      continue;
    }
    // File to file. Both ends are in use: the poster's textless master
    // is not an orphan.
    const nameOfAsset = (id: unknown): string => String(
      assets.find((a) => Number(a["id"]) === Number(id))?.["name"] ?? "another file");
    add(r["asset_id"], { subject: null, how: `${how} ${nameOfAsset(r["entity_id"])}` });
    add(r["entity_id"], { subject: null, how: `source of ${nameOfAsset(r["asset_id"])}` });
  }

  const out: GalleryItem[] = [];
  for (const a of assets) {
    const history = a["lifecycle_status"] === "cut" ||
      (a["superseded_by_id"] !== null && a["superseded_by_id"] !== undefined);
    if (history && !includeHistory) continue;
    const list = uses.get(Number(a["id"])) ?? [];
    const ext = extensionOf(a["identifier"]) ?? extensionOf(a["name"]);
    out.push({
      asset: a,
      kind: ext === null ? null : previewCapability(ext).kind,
      uses: list,
      score: scoreOf(list, weight),
    });
  }
  return out;
}

/** One per direct use, plus one and its scene count per subject
 *  reached — each subject once, however many ways it is reached. */
export function scoreOf(uses: readonly Use[],
                        weight: ReadonlyMap<string, number>): number {
  const seen = new Set<string>();
  let score = uses.length;
  for (const u of uses) {
    if (u.subject === null) continue;
    const k = `${u.subject.kind}:${String(u.subject.id)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    score += 1 + (weight.get(k) ?? 0);
  }
  return score;
}

/** Shots, scenes and the project poster read as one group. */
const FILTER_KINDS: Record<Exclude<GalleryFilter, "all" | "unused">, GallerySubjectKind[]> = {
  character: ["character", "costume"],
  location: ["location"],
  prop: ["prop"],
  shot: ["shot", "scene", "project"],
};

export function filterItems(items: readonly GalleryItem[], filter: GalleryFilter,
                            visualOnly: boolean): GalleryItem[] {
  return items.filter((it) => {
    if (visualOnly && it.kind !== "image" && it.kind !== "video") return false;
    if (filter === "all") return true;
    if (filter === "unused") return it.uses.every((u) => u.subject === null);
    const kinds = FILTER_KINDS[filter];
    return it.uses.some((u) => u.subject !== null && kinds.includes(u.subject.kind));
  });
}

/** A small deterministic PRNG, so "random" holds still until reshuffled
 *  and does not jump on every re-render. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const label = (it: GalleryItem): string =>
  String(it.asset["name"] ?? it.asset["identifier"] ?? "").toLowerCase();

export function sortItems(items: readonly GalleryItem[], sort: GallerySort,
                          seed = 1): GalleryItem[] {
  const list = [...items];
  switch (sort) {
    case "alphabetical":
      return list.sort((a, b) => label(a).localeCompare(label(b), undefined,
                                                          { numeric: true }));
    case "importance":
      return list.sort((a, b) => b.score - a.score ||
        label(a).localeCompare(label(b), undefined, { numeric: true }));
    case "newest":
      return list.sort((a, b) =>
        String(b.asset["created_at"] ?? "").localeCompare(String(a.asset["created_at"] ?? "")) ||
        Number(b.asset["id"]) - Number(a.asset["id"]));
    case "random": {
      // Ordered by id first, so the same seed gives the same order
      // whatever order the rows arrived in.
      list.sort((a, b) => Number(a.asset["id"]) - Number(b.asset["id"]));
      const rnd = mulberry32(seed);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j]!, list[i]!];
      }
      return list;
    }
  }
}

/** Uses grouped for the viewer: "Eleanor Cade — look board, face anchor". */
export function describeUses(uses: readonly Use[]): string[] {
  const by = new Map<string, string[]>();
  for (const u of uses) {
    const k = u.subject?.name ?? "";
    const list = by.get(k) ?? [];
    if (!list.includes(u.how)) list.push(u.how);
    by.set(k, list);
  }
  return [...by.entries()].map(([who, hows]) =>
    who === "" ? hows.join(", ") : `${who} — ${hows.join(", ")}`);
}

/**
 * Only files that are there. A gallery is for looking at, and a tile
 * for a file the folder does not hold — or one the browser could not
 * draw — is an empty frame where a picture should be. Those are what
 * the Assets section is for; here they are left out unless asked for.
 *
 * `states` is each asset's resolution by id; an asset not in it yet is
 * still being resolved and is held back rather than shown empty.
 * `broken` is assets that resolved but failed to load or decode.
 */
export function presentItems(items: readonly GalleryItem[],
                             states: ReadonlyMap<number, string>,
                             broken: ReadonlySet<number>,
                             showMissing: boolean): GalleryItem[] {
  if (showMissing) return [...items];
  return items.filter((it) => {
    const id = Number(it.asset["id"]);
    return states.get(id) === "resolved" && !broken.has(id);
  });
}
