// SPDX-License-Identifier: Apache-2.0
/**
 * mediaOps.ts — the wiring behind a reference board.
 *
 * The writer points at a file and says what it is for. This module turns
 * that into the rows SCF needs, and reads them back as tiles:
 *
 * | The writer says          | Rows                                        |
 * |--------------------------|---------------------------------------------|
 * | This is them             | entity_anchor, verified                     |
 * | Look / Voice reference   | bundle_asset in the owner's baseline set;   |
 * |                          | on first use a bundle of the board's intent |
 * |                          | and a baseline binding to it                |
 * | Concept, Inspiration     | asset_relationship                          |
 * | Which part of it         | entity_anchor.region_box / audio offsets    |
 * | An exception             | a bundle and a non-baseline binding with    |
 * |                          | the condition as its filter                 |
 *
 * A board belongs to an OWNER: a character, or one of its costumes
 * (costume_asset_binding, 2.16). Everything below is written once for
 * every owner kind; what differs — whether it can carry an anchor, which
 * filter columns its binding table declares — is read from the registry.
 *
 * Every row is ordinary SCF — what a careful hand-author would write —
 * so a board-built look and a hand-built look give the same Q13 answer
 * (`mediaOps.test.ts` holds that equivalence).
 *
 * "The baseline set" is identified STRUCTURALLY, never by a marker: a
 * binding of this owner, baseline, carrying no filter its table
 * declares, to a bundle of the board's intent. A flag saying "made by
 * the workspace" would be a second description of that same fact.
 *
 * Purpose lives on the LINK, never on the asset (§8.4).
 *
 * Headless (no view imports), and every write returns its ChangeUndo so
 * one action undoes as one step.
 */

import {
  newUuid, q, withTransaction, type Row, type SqlExec, type SqlValue,
} from "@scf-core/db.ts";
import type { Registry } from "@scf-core/registry.ts";
import {
  applyBundleAdd, bindBundle, bindingSubjects, createBundle, planBundleAdd,
} from "@scf-core/bundling.ts";
import { formatOf } from "@scf-core/assets.ts";
import {
  applyAssetImport, planAssetImport, type ImportCandidate,
} from "@scf-core/assetImport.ts";
import { previewCapability } from "@scf-core/preview.ts";
import { parseRegionBox, type RegionBox } from "@scf-core/anchors.ts";
import { ChangeRecorder, type ChangeUndo } from "../state/undoChange.ts";

export const BOARDS = {
  look: { intent: "visual_identity", anchorType: "visual", noun: "look" },
  voice: { intent: "voice_identity", anchorType: "audio", noun: "voice" },
  motion: { intent: "motion", anchorType: "motion", noun: "movement" },
  /** A place's or an object's sonic identity — room tone, the chime's
   *  ring. `acoustic` is any subject's, not only a location's. */
  sound: { intent: "acoustic", anchorType: "audio", noun: "sound" },
} as const;
export type BoardName = keyof typeof BOARDS;

export type Purpose = "identity" | "set" | "concept" | "inspiration";
export const PURPOSES: Purpose[] = ["identity", "set", "concept", "inspiration"];

export const PURPOSE_LABEL: Record<BoardName, Record<Purpose, string>> = {
  look: { identity: "This is them", set: "Look", concept: "Concept",
          inspiration: "Inspiration" },
  voice: { identity: "This is their voice", set: "Voice reference",
           concept: "Concept", inspiration: "Inspiration" },
  motion: { identity: "This is how they move", set: "Motion reference",
            concept: "Concept", inspiration: "Inspiration" },
  sound: { identity: "This is how it sounds", set: "Sound reference",
           concept: "Concept", inspiration: "Inspiration" },
};

/** What each purpose means, for the drop dialog. */
export const PURPOSE_HELP: Record<BoardName, Record<Purpose, string>> = {
  look: {
    identity: "Their face. Downstream tools match against it.",
    set: "Part of how they look — what tools should use.",
    concept: "Design exploration. Informs, isn't the answer.",
    inspiration: "Mood and references from outside the project.",
  },
  voice: {
    identity: "Their voice. Downstream tools match against it.",
    set: "Part of how they sound — what tools should use.",
    concept: "Exploration of the voice. Informs, isn't the answer.",
    inspiration: "Voices and recordings from outside the project.",
  },
  motion: {
    identity: "Their movement. Downstream tools match against it.",
    set: "Part of how they move — what tools should use.",
    concept: "Exploration of movement. Informs, isn't the answer.",
    inspiration: "Movement from outside the project.",
  },
  sound: {
    identity: "Its sound. Downstream tools match against it.",
    set: "Part of how it sounds — what tools should use.",
    concept: "Exploration of the sound. Informs, isn't the answer.",
    inspiration: "Recordings from outside the project.",
  },
};

/**
 * A purpose's label for an owner. "This is them" is a person; a place or
 * an object is "this is it". Everything else reads the same for all.
 */
export function purposeLabel(kind: string, board: BoardName,
                             purpose: Purpose): string {
  if (purpose === "identity" && kind !== "character" && board === "look") {
    return "This is it";
  }
  return PURPOSE_LABEL[board][purpose];
}

export function purposeHelp(kind: string, board: BoardName,
                            purpose: Purpose): string {
  if (purpose === "identity" && kind !== "character" && board === "look") {
    return "What it looks like. Downstream tools match against it.";
  }
  return PURPOSE_HELP[board][purpose];
}

/** Who a board belongs to. A bare number means a character. */
export interface Owner {
  kind: "character" | "costume" | "location" | "prop";
  id: number;
}
type OwnerArg = Owner | number;
const ownerOf = (o: OwnerArg): Owner =>
  typeof o === "number" ? { kind: "character", id: o } : o;

/** Owner kinds that can carry an entity_anchor (its subject_type enum). */
const ANCHOR_KINDS = new Set(["character", "prop", "location"]);

/** Each owner kind's variant table, where it has one (§4.8). */
const VARIANT_TABLE: Record<string, string> = {
  character: "character_variant", location: "location_variant",
  prop: "prop_variant",
};

/** Audio files sit on the boards that are about sound. */
const AUDIO_BOARDS = new Set<BoardName>(["voice", "sound"]);

/** The purposes a board offers for an owner. Concept and inspiration
 *  sit on Look and Voice only: an asset_relationship has no modality, so
 *  it is placed by what the file is, and only those two boards read it. */
export function purposesFor(owner: OwnerArg, board: BoardName): Purpose[] {
  const o = ownerOf(owner);
  return PURPOSES.filter((p) =>
    (p !== "identity" || ANCHOR_KINDS.has(o.kind)) &&
    (board !== "motion" || p === "identity" || p === "set"));
}

/** Every column that can make a binding conditional, on any table. */
const FILTER_COLUMNS = [
  "scene_range_start_id", "scene_range_end_id", "physical_state_filter",
  "vocal_state_filter", "variant_id", "time_of_day_filter",
];

const NOT_CUT = (alias: string): string =>
  `(${alias}.lifecycle_status IS NULL OR ${alias}.lifecycle_status <> 'cut')`;
const blank = (col: string): string => `COALESCE(${col}, '') = ''`;

function bindingTable(o: Owner): string { return `${o.kind}_asset_binding`; }

/** The filter columns this owner's binding table actually declares. */
function filterColumns(registry: Registry, o: Owner): string[] {
  const fields = new Set(registry.entities.get(bindingTable(o))?.fields
    .map((f) => f.name));
  return FILTER_COLUMNS.filter((c) => fields.has(c));
}

function pureBaseline(registry: Registry, o: Owner): string {
  return ["b.is_baseline = 1",
          ...filterColumns(registry, o).map((c) => blank(`b.${c}`))]
    .join(" AND ");
}

export class SharedSetError extends Error {
  constructor(readonly sharedWith: string[]) {
    super(`This set is also used by ${sharedWith.join(", ")}.`);
  }
}

export interface Tile {
  /** Stable across re-reads: the link's table and id. */
  key: string;
  purpose: Purpose | "other";
  /** The purpose as the board names it, or the stored type for "other". */
  label: string;
  asset: Row;
  link: { entity: string; id: number };
  /** bundle_asset.role_in_bundle, for set tiles. */
  role: string | null;
  /** entity_anchor.canonical_status, for identity tiles. */
  status: string | null;
  /** The variant an identity anchor belongs to (proposal 0033). */
  variant: string | null;
  /** Which part of the file an identity anchor points at; null for
   *  every other tile. */
  scope: AnchorScope | null;
}

/**
 * The part of a file an anchor means: a face in a group shot, the three
 * seconds of a recording that are the voice. Read leniently, as anchors.ts
 * reads region_box: a malformed box is reported as `regionRaw` with
 * `region` null, never thrown or silently dropped.
 */
export interface AnchorScope {
  region: RegionBox | null;
  /** The stored text, when it is there but not a usable box. */
  regionRaw: string | null;
  regionLabel: string | null;
  clipStart: number | null;
  clipEnd: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function scopeOf(r: Row): AnchorScope {
  const raw = r["a_region_box"];
  const region = parseRegionBox(raw);
  const label = r["a_region_label"];
  return {
    region,
    regionRaw: region === null && raw !== null && raw !== undefined && raw !== ""
      ? String(raw) : null,
    regionLabel: label === null || label === undefined || label === ""
      ? null : String(label),
    clipStart: num(r["a_audio_start"]),
    clipEnd: num(r["a_audio_end"]),
  };
}

export interface BaselineSet {
  bindingId: number;
  bundleId: number;
  name: string;
  /** Other subjects this bundle is bound to. */
  sharedWith: string[];
}

/** What a condition is, as the exception editor authors it. */
export type When =
  | { kind: "scenes"; startId: number | null; endId: number | null }
  | { kind: "physical" | "vocal"; state: string }
  | { kind: "variant"; variantId: number }
  /** A location binding's time_of_day_filter: the scene's time of day. */
  | { kind: "time"; value: string };

export interface Exception {
  bindingId: number;
  bundleId: number;
  bundleName: string;
  /** "while wounded", "as Marcus, age nine", "scenes 9–12", in words. */
  when: string;
  replaces: boolean;
  precedence: number;
  /** The filter values, for editing. */
  filters: Record<string, SqlValue>;
  /** A state filter naming no state this character has: it can never
   *  apply. Usually a renamed state. */
  stale: string[];
  /** The bundle's members, as tiles. */
  tiles: Tile[];
}

export interface BoardData {
  tiles: Tile[];
  sets: BaselineSet[];
  exceptions: Exception[];
}

/** Which board a concept or inspiration file sits on: by what it is. */
export function boardForIdentifier(identifier: unknown): "look" | "voice" {
  if (typeof identifier !== "string") return "look";
  return previewCapability(formatOf(identifier)).kind === "audio"
    ? "voice" : "look";
}

async function ownerName(exec: SqlExec, registry: Registry,
                         o: Owner): Promise<string> {
  const field = registry.entities.get(o.kind)?.nameField ?? "name";
  return String((await exec(`SELECT ${q(field)} AS n FROM ${q(o.kind)} ` +
                            "WHERE id = ?", [o.id]))[0]?.["n"] ?? o.kind);
}

/** Other subjects a bundle is bound to, by name. */
export async function bundleSharedWith(
    exec: SqlExec, registry: Registry, bundleId: number,
    except: { subject: string; id: number }): Promise<string[]> {
  const names: string[] = [];
  for (const subject of bindingSubjects(registry)) {
    const nameField = registry.entities.get(subject)?.nameField ?? "name";
    const rows = await exec(
      `SELECT DISTINCT s.id, s.${q(nameField)} AS name ` +
      `FROM ${q(`${subject}_asset_binding`)} b JOIN ${q(subject)} s ` +
      `ON s.id = b.${q(`${subject}_id`)} WHERE b.bundle_id = ? ` +
      `AND ${NOT_CUT("b")}`, [bundleId]);
    for (const r of rows) {
      if (subject === except.subject && Number(r["id"]) === except.id) continue;
      names.push(String(r["name"] ?? `${subject} ${String(r["id"])}`));
    }
  }
  return names;
}

export async function baselineSets(
    exec: SqlExec, registry: Registry, owner: OwnerArg,
    board: BoardName): Promise<BaselineSet[]> {
  const o = ownerOf(owner);
  const rows = await exec(
    "SELECT b.id AS binding_id, u.id AS bundle_id, u.name " +
    `FROM ${q(bindingTable(o))} b JOIN bundle u ON u.id = b.bundle_id ` +
    `WHERE b.${q(`${o.kind}_id`)} = ? AND u.intent = ? AND ` +
    `${pureBaseline(registry, o)} AND ${NOT_CUT("b")} AND ${NOT_CUT("u")} ` +
    "ORDER BY COALESCE(b.precedence, 0), b.id",
    [o.id, BOARDS[board].intent]);
  const out: BaselineSet[] = [];
  for (const r of rows) {
    const bundleId = Number(r["bundle_id"]);
    out.push({
      bindingId: Number(r["binding_id"]), bundleId,
      name: String(r["name"] ?? "Untitled set"),
      sharedWith: await bundleSharedWith(exec, registry, bundleId,
                                         { subject: o.kind, id: o.id }),
    });
  }
  return out;
}

async function memberTiles(exec: SqlExec, bundleId: number,
                           label: string): Promise<Tile[]> {
  const members = await exec(
    "SELECT m.id AS link_id, m.role_in_bundle, s.* FROM bundle_asset m " +
    "JOIN asset s ON s.id = m.asset_id WHERE m.bundle_id = ? " +
    'ORDER BY m."order", m.id', [bundleId]);
  return members.map((r) => {
    const { link_id, role_in_bundle, ...asset } = r;
    return {
      key: `bundle_asset:${String(link_id)}`, purpose: "set" as const, label,
      asset, link: { entity: "bundle_asset", id: Number(link_id) },
      role: role_in_bundle === null || role_in_bundle === undefined ||
        role_in_bundle === "" ? null : String(role_in_bundle),
      status: null, variant: null, scope: null,
    };
  });
}

/** A condition in words. Shared by the exception list and its editor. */
export function describeWhen(f: Record<string, unknown>,
                             names: { scene: (id: unknown) => string | null;
                                      variant: (id: unknown) => string | null }):
    string {
  const parts: string[] = [];
  const variant = names.variant(f["variant_id"]);
  if (variant !== null) parts.push(`as ${variant}`);
  const phys = f["physical_state_filter"];
  if (typeof phys === "string" && phys !== "") parts.push(`while ${phys}`);
  const voc = f["vocal_state_filter"];
  if (typeof voc === "string" && voc !== "") {
    parts.push(`while the voice is ${voc}`);
  }
  const time = f["time_of_day_filter"];
  if (typeof time === "string" && time !== "") parts.push(`at ${time}`);
  const from = names.scene(f["scene_range_start_id"]);
  const to = names.scene(f["scene_range_end_id"]);
  if (from !== null && to !== null) parts.push(`scenes ${from}–${to}`);
  else if (from !== null) parts.push(`from scene ${from}`);
  else if (to !== null) parts.push(`up to scene ${to}`);
  return parts.length === 0 ? "always, as a second baseline" : parts.join(", ");
}

async function exceptions(exec: SqlExec, registry: Registry, o: Owner,
                          board: BoardName): Promise<Exception[]> {
  const cols = filterColumns(registry, o);
  const rows = await exec(
    "SELECT b.*, u.name AS bundle_name " +
    `FROM ${q(bindingTable(o))} b JOIN bundle u ON u.id = b.bundle_id ` +
    `WHERE b.${q(`${o.kind}_id`)} = ? AND u.intent = ? ` +
    `AND NOT (${pureBaseline(registry, o)}) AND ${NOT_CUT("b")} ` +
    "ORDER BY COALESCE(b.precedence, 0) DESC, b.id",
    [o.id, BOARDS[board].intent]);
  const scenes = new Map((await exec("SELECT id, scene_number FROM scene"))
    .map((s) => [Number(s["id"]), String(s["scene_number"] ?? "?")]));
  const variantTable = VARIANT_TABLE[o.kind];
  const variants = new Map(variantTable === undefined ? [] : (await exec(
    `SELECT id, name FROM ${q(variantTable)}`)).map((v) =>
    [Number(v["id"]), String(v["name"])] as const));
  const stateNames = o.kind !== "character" ? [] : await exec(
    "SELECT name, modality FROM performance_state WHERE character_id = ?",
    [o.id]);
  const has = (modality: string, name: unknown): boolean =>
    stateNames.some((s) => s["modality"] === modality &&
      String(s["name"] ?? "").trim().toLowerCase() ===
      String(name).trim().toLowerCase());

  const out: Exception[] = [];
  for (const r of rows) {
    const filters: Record<string, SqlValue> = {};
    for (const c of cols) filters[c] = r[c] ?? null;
    const stale: string[] = [];
    for (const [c, m] of [["physical_state_filter", "physical"],
                          ["vocal_state_filter", "vocal"]] as const) {
      const v = filters[c];
      if (typeof v === "string" && v !== "" && !has(m, v)) stale.push(v);
    }
    const bundleId = Number(r["bundle_id"]);
    out.push({
      bindingId: Number(r["id"]), bundleId,
      bundleName: String(r["bundle_name"] ?? "Untitled set"),
      when: describeWhen(filters, {
        scene: (id) => id === null || id === undefined || id === ""
          ? null : scenes.get(Number(id)) ?? "?",
        variant: (id) => id === null || id === undefined || id === ""
          ? null : variants.get(Number(id)) ?? "a variant",
      }),
      replaces: r["combine"] === "replace",
      precedence: Number(r["precedence"] ?? 0),
      filters, stale,
      tiles: await memberTiles(exec, bundleId, PURPOSE_LABEL[board].set),
    });
  }
  return out;
}

/** Everything a board shows, in one read. */
export async function loadBoard(
    exec: SqlExec, registry: Registry, owner: OwnerArg,
    board: BoardName): Promise<BoardData> {
  const o = ownerOf(owner);
  const spec = BOARDS[board];
  const labels = PURPOSE_LABEL[board];
  const tiles: Tile[] = [];

  if (ANCHOR_KINDS.has(o.kind)) {
    const anchors = await exec(
      "SELECT a.id AS link_id, a.canonical_status, v.name AS variant, " +
      "a.region_box AS a_region_box, a.region_label AS a_region_label, " +
      "a.audio_offset_start_sec AS a_audio_start, " +
      "a.audio_offset_end_sec AS a_audio_end, s.* " +
      "FROM entity_anchor a JOIN asset s ON s.id = a.asset_id " +
      `LEFT JOIN ${q(VARIANT_TABLE[o.kind] ?? "character_variant")} v ` +
      "ON v.id = a.subject_variant_id " +
      "WHERE a.subject_type = ? AND a.subject_id = ? " +
      `AND a.anchor_type = ? AND ${NOT_CUT("a")} ORDER BY a.id`,
      [o.kind, o.id, spec.anchorType]);
    for (const r of anchors) {
      const { link_id, canonical_status, variant, a_region_box: _rb,
              a_region_label: _rl, a_audio_start: _as, a_audio_end: _ae,
              ...asset } = r;
      tiles.push({
        scope: scopeOf(r),
        key: `entity_anchor:${String(link_id)}`, purpose: "identity",
        label: purposeLabel(o.kind, board, "identity"), asset,
        link: { entity: "entity_anchor", id: Number(link_id) },
        role: null,
        status: canonical_status === null || canonical_status === undefined
          ? null : String(canonical_status),
        variant: variant === null || variant === undefined
          ? null : String(variant),
      });
    }
  }

  const sets = await baselineSets(exec, registry, o, board);
  for (const set of sets) {
    tiles.push(...await memberTiles(exec, set.bundleId, labels.set));
  }

  if (board !== "motion") {
    const related = await exec(
      "SELECT r.id AS link_id, r.relationship_type, s.* " +
      "FROM asset_relationship r JOIN asset s ON s.id = r.asset_id " +
      "WHERE r.entity_type = ? AND r.entity_id = ? ORDER BY r.id",
      [o.kind, o.id]);
    for (const r of related) {
      const { link_id, relationship_type, ...asset } = r;
      const audio = boardForIdentifier(asset["identifier"]) === "voice";
      if (audio !== AUDIO_BOARDS.has(board)) continue;
      const type = String(relationship_type ?? "reference");
      const purpose: Purpose | "other" =
        type === "concept" || type === "inspiration" ? type : "other";
      tiles.push({
        key: `asset_relationship:${String(link_id)}`, purpose,
        label: purpose === "other" ? type : labels[purpose], asset,
        link: { entity: "asset_relationship", id: Number(link_id) },
        role: null, status: null, variant: null, scope: null,
      });
    }
  }

  return { tiles, sets,
           exceptions: await exceptions(exec, registry, o, board) };
}

export interface AttachOptions {
  /** bundle_asset.role_in_bundle for a set tile. */
  role?: string | null;
  /** When the baseline set is shared with another subject: add for
   *  everyone using it, or give this owner a copy first. Unset means
   *  ask — `attach` throws SharedSetError. */
  shared?: "both" | "split";
  /** Add set files to this bundle — an exception's — instead of the
   *  baseline set. */
  bundleId?: number;
}

/**
 * Point files at an owner, for a purpose. Re-attaching what is already
 * attached the same way does nothing, so a repeated drop is safe.
 */
export async function attach(
    exec: SqlExec, registry: Registry, owner: OwnerArg,
    board: BoardName, assetIds: readonly number[], purpose: Purpose,
    options: AttachOptions = {}): Promise<ChangeUndo> {
  const o = ownerOf(owner);
  const rec = new ChangeRecorder("");
  await withTransaction(exec, () =>
    attachInto(rec, exec, registry, o, board, assetIds, purpose, options));
  const name = await ownerName(exec, registry, o);
  const n = assetIds.length;
  rec.label = `Added ${n === 1 ? "a file" : `${String(n)} files`} to ` +
    (options.bundleId !== undefined ? `an exception for ${name}`
      : `${name}'s ${BOARDS[board].noun}`);
  return rec.result;
}

async function attachInto(
    rec: ChangeRecorder, exec: SqlExec, registry: Registry, o: Owner,
    board: BoardName, assetIds: readonly number[], purpose: Purpose,
    options: AttachOptions): Promise<void> {
  const spec = BOARDS[board];
  const lastId = async (): Promise<number> =>
    Number((await exec("SELECT last_insert_rowid() AS id"))[0]?.["id"]);

  if (purpose === "identity") {
    if (!ANCHOR_KINDS.has(o.kind)) {
      throw new Error(`A ${o.kind} cannot carry an identity reference.`);
    }
    for (const assetId of assetIds) {
      const existing = await exec(
        "SELECT id FROM entity_anchor WHERE subject_type = ? " +
        "AND subject_id = ? AND asset_id = ? AND anchor_type = ? " +
        "AND subject_variant_id IS NULL",
        [o.kind, o.id, assetId, spec.anchorType]);
      if (existing.length > 0) continue;
      // Verified: the writer pointing at it IS the verification. Q13
      // passes over candidates (§12.8), so a candidate would never reach
      // any tool; candidate stays for anchors something else proposed.
      await exec(
        "INSERT INTO entity_anchor (uuid, subject_type, subject_id, " +
        "anchor_type, asset_id, canonical_status) " +
        "VALUES (?, ?, ?, ?, ?, 'verified')",
        [newUuid(), o.kind, o.id, spec.anchorType, assetId]);
      rec.created("entity_anchor", await lastId());
    }
    return;
  }

  if (purpose === "concept" || purpose === "inspiration") {
    for (const assetId of assetIds) {
      const existing = await exec(
        "SELECT id FROM asset_relationship WHERE asset_id = ? " +
        "AND entity_type = ? AND entity_id = ? AND relationship_type = ?",
        [assetId, o.kind, o.id, purpose]);
      if (existing.length > 0) continue;
      await exec(
        "INSERT INTO asset_relationship (uuid, asset_id, entity_type, " +
        "entity_id, relationship_type) VALUES (?, ?, ?, ?, ?)",
        [newUuid(), assetId, o.kind, o.id, purpose]);
      rec.created("asset_relationship", await lastId());
    }
    return;
  }

  // purpose === "set"
  let bundleId: number;
  if (options.bundleId !== undefined) {
    bundleId = options.bundleId;
  } else {
    let set = (await baselineSets(exec, registry, o, board))[0];
    if (set === undefined) {
      const name = await ownerName(exec, registry, o);
      const made = await createBundle(exec, `${name} — ${spec.noun}`,
                                      spec.intent);
      rec.created("bundle", made);
      const bindingId = await bindBundle(exec, registry, o.kind, o.id, made,
                                         { isBaseline: true, precedence: 0 });
      if (bindingId !== null) rec.created(bindingTable(o), bindingId);
      set = { bindingId: bindingId ?? 0, bundleId: made, name, sharedWith: [] };
    } else if (set.sharedWith.length > 0) {
      if (options.shared === undefined) throw new SharedSetError(set.sharedWith);
      if (options.shared === "split") {
        set = await splitInto(rec, exec, registry, o, board, set);
      }
    }
    bundleId = set.bundleId;
  }
  const plan = await planBundleAdd(exec, bundleId, assetIds);
  if (plan.add.length === 0) return;
  const role = options.role === undefined || options.role === null ||
    options.role.trim() === "" ? null : options.role.trim();
  await applyBundleAdd(exec, bundleId, plan.add, role);
  const links = await exec(
    "SELECT id FROM bundle_asset WHERE bundle_id = ? " +
    `AND asset_id IN (${plan.add.map(() => "?").join(", ")})`,
    [bundleId, ...plan.add]);
  for (const l of links) rec.created("bundle_asset", Number(l["id"]));
}

/**
 * Give this owner its own copy of a shared baseline set: a new bundle
 * with the same members, and this owner's binding pointed at it.
 */
async function splitInto(rec: ChangeRecorder, exec: SqlExec,
                         registry: Registry, o: Owner, board: BoardName,
                         set: BaselineSet): Promise<BaselineSet> {
  const spec = BOARDS[board];
  const name = `${await ownerName(exec, registry, o)} — ${spec.noun}`;
  const bundleId = await createBundle(exec, name, spec.intent);
  rec.created("bundle", bundleId);
  await copyMembers(rec, exec, set.bundleId, bundleId);
  await rec.snapshot(exec, bindingTable(o), set.bindingId);
  await exec(
    `UPDATE ${q(bindingTable(o))} SET bundle_id = ?, ` +
    "updated_at = datetime('now') WHERE id = ?", [bundleId, set.bindingId]);
  return { bindingId: set.bindingId, bundleId, name, sharedWith: [] };
}

async function copyMembers(rec: ChangeRecorder, exec: SqlExec,
                           from: number, to: number): Promise<void> {
  const members = await exec(
    'SELECT asset_id, role_in_bundle FROM bundle_asset WHERE bundle_id = ? ' +
    'ORDER BY "order", id', [from]);
  for (const m of members) {
    await applyBundleAdd(exec, to, [Number(m["asset_id"])],
                         m["role_in_bundle"] === null ? null
                           : String(m["role_in_bundle"]));
  }
  for (const l of await exec(
      "SELECT id FROM bundle_asset WHERE bundle_id = ?", [to])) {
    rec.created("bundle_asset", Number(l["id"]));
  }
}

/** Take a tile off the board: its link row only. The asset stays. */
export async function detach(exec: SqlExec, tile: Tile): Promise<ChangeUndo> {
  const rec = new ChangeRecorder(`Removed ${String(tile.asset["name"] ??
    "a file")} from the board`);
  await withTransaction(exec, async () => {
    await rec.snapshot(exec, tile.link.entity, tile.link.id);
    await exec(`DELETE FROM ${q(tile.link.entity)} WHERE id = ?`,
               [tile.link.id]);
  });
  return rec.result;
}

/** Change what a tile is for: one link out, another in, one undo. */
export async function repurpose(
    exec: SqlExec, registry: Registry, owner: OwnerArg,
    board: BoardName, tile: Tile, purpose: Purpose,
    options: AttachOptions = {}): Promise<ChangeUndo> {
  const rec = new ChangeRecorder(
    `${String(tile.asset["name"] ?? "File")} is now ` +
    PURPOSE_LABEL[board][purpose].toLowerCase());
  await withTransaction(exec, async () => {
    await rec.snapshot(exec, tile.link.entity, tile.link.id);
    await exec(`DELETE FROM ${q(tile.link.entity)} WHERE id = ?`,
               [tile.link.id]);
    await attachInto(rec, exec, registry, ownerOf(owner), board,
                     [Number(tile.asset["id"])], purpose, options);
  });
  return rec.result;
}

/** A proposed "this is them" becomes the real one. */
export async function confirmIdentity(exec: SqlExec,
                                      anchorId: number): Promise<ChangeUndo> {
  const rec = new ChangeRecorder("Confirmed the reference");
  await rec.snapshot(exec, "entity_anchor", anchorId);
  await exec(
    "UPDATE entity_anchor SET canonical_status = 'verified', " +
    "updated_at = datetime('now') WHERE id = ?", [anchorId]);
  return rec.result;
}

/** Name what a set member is: front, side, model sheet. */
export async function setTileRole(exec: SqlExec, linkId: number,
                                  role: string | null): Promise<ChangeUndo> {
  const rec = new ChangeRecorder("Changed the reference's role");
  await rec.snapshot(exec, "bundle_asset", linkId);
  await exec("UPDATE bundle_asset SET role_in_bundle = ? WHERE id = ?",
             [role === null || role.trim() === "" ? null : role.trim(), linkId]);
  return rec.result;
}

/** A value the anchor editors refuse, in words the panel can show. */
export class ScopeError extends Error {}

/**
 * Mark which part of an image the anchor means — the face in a group
 * shot. `box` is in the image's own pixels, origin top-left (the shape
 * anchors.ts reads); null clears it, and the anchor means the whole
 * image again. Stored rounded to whole pixels: sub-pixel precision from
 * a mouse drag is noise, not a measurement.
 *
 * `size` is the image as loaded. A box that does not fit it is refused
 * here rather than stored, because every reader would discard it
 * (`regionFits`) and the writer would see a mark that does nothing.
 */
export async function setAnchorRegion(
    exec: SqlExec, anchorId: number, box: RegionBox | null,
    label: string | null,
    size?: { width: number; height: number }): Promise<ChangeUndo> {
  let stored: string | null = null;
  if (box !== null) {
    const r = { x: Math.round(box.x), y: Math.round(box.y),
                w: Math.round(box.w), h: Math.round(box.h) };
    if (parseRegionBox(r) === null) {
      throw new ScopeError("The box needs a position at or inside the " +
                           "top-left corner and a width and height above zero.");
    }
    if (size !== undefined &&
        (r.x + r.w > size.width || r.y + r.h > size.height)) {
      throw new ScopeError(`The box runs past the edge of the image ` +
                           `(${String(size.width)}×${String(size.height)}).`);
    }
    stored = JSON.stringify(r);
  }
  const text = label === null || label.trim() === "" ? null : label.trim();
  const rec = new ChangeRecorder(box === null ? "Cleared the marked region"
                                              : "Marked the region");
  await rec.snapshot(exec, "entity_anchor", anchorId);
  await exec(
    "UPDATE entity_anchor SET region_box = ?, region_label = ?, " +
    "updated_at = datetime('now') WHERE id = ?",
    [stored, box === null ? null : text, anchorId]);
  return rec.result;
}

/**
 * Mark which stretch of a recording the anchor means — the line that IS
 * the voice. Seconds from the start of the file; either end may be open
 * (null): from the start, or to the end. Both null clears the range.
 * Stored to the millisecond.
 *
 * `duration`, when known, bounds the range: a clip past the end of the
 * file is a typo, not a measurement.
 */
export async function setAnchorClip(
    exec: SqlExec, anchorId: number, start: number | null,
    end: number | null, duration?: number): Promise<ChangeUndo> {
  const ms = (v: number | null): number | null =>
    v === null ? null : Math.round(v * 1000) / 1000;
  const s = ms(start);
  const e = ms(end);
  for (const v of [s, e]) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      throw new ScopeError("Times are seconds from the start, zero or more.");
    }
  }
  if (s !== null && e !== null && e <= s) {
    throw new ScopeError("The clip has to end after it starts.");
  }
  if (duration !== undefined && Number.isFinite(duration) &&
      ((s !== null && s >= duration) || (e !== null && e > duration + 0.001))) {
    throw new ScopeError(`The recording is ${duration.toFixed(2)} s long.`);
  }
  const rec = new ChangeRecorder(s === null && e === null
    ? "Cleared the clip" : "Set the clip");
  await rec.snapshot(exec, "entity_anchor", anchorId);
  await exec(
    "UPDATE entity_anchor SET audio_offset_start_sec = ?, " +
    "audio_offset_end_sec = ?, updated_at = datetime('now') WHERE id = ?",
    [s, e, anchorId]);
  return rec.result;
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

/** The filter columns a condition sets, everything else cleared. */
function filterValues(registry: Registry, o: Owner,
                      when: When): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const c of filterColumns(registry, o)) out[c] = null;
  const need = (c: string): void => {
    if (!(c in out)) throw new Error(`A ${o.kind} cannot be scoped that way.`);
  };
  if (when.kind === "scenes") {
    need("scene_range_start_id");
    if (when.startId === null && when.endId === null) {
      throw new Error("Pick at least the scene it starts at or ends at.");
    }
    out["scene_range_start_id"] = when.startId;
    out["scene_range_end_id"] = when.endId;
  } else if (when.kind === "variant") {
    need("variant_id");
    out["variant_id"] = when.variantId;
  } else if (when.kind === "time") {
    need("time_of_day_filter");
    if (when.value.trim() === "") throw new Error("Pick the time of day.");
    out["time_of_day_filter"] = when.value;
  } else {
    const col = when.kind === "physical"
      ? "physical_state_filter" : "vocal_state_filter";
    need(col);
    if (when.state.trim() === "") throw new Error("Pick the state.");
    out[col] = when.state.trim();
  }
  return out;
}

/**
 * A new exception: an empty bundle of the board's intent, bound with the
 * condition as its filter, ranked above every binding the owner already
 * has for that intent — a new exception is the most specific thing, and
 * the writer can move it down.
 */
export async function addException(
    exec: SqlExec, registry: Registry, owner: OwnerArg, board: BoardName,
    when: When, replaces: boolean): Promise<{ change: ChangeUndo;
                                              bindingId: number }> {
  const o = ownerOf(owner);
  const rec = new ChangeRecorder("Added an exception");
  const spec = BOARDS[board];
  const filters = filterValues(registry, o, when);
  let bindingId = 0;
  await withTransaction(exec, async () => {
    const top = Number((await exec(
      `SELECT MAX(COALESCE(b.precedence, 0)) AS top FROM ` +
      `${q(bindingTable(o))} b JOIN bundle u ON u.id = b.bundle_id ` +
      `WHERE b.${q(`${o.kind}_id`)} = ? AND u.intent = ?`,
      [o.id, spec.intent]))[0]?.["top"] ?? 0);
    const name = await ownerName(exec, registry, o);
    const bundleId = await createBundle(exec, `${name} — ${spec.noun}, ` +
      `exception`, spec.intent);
    rec.created("bundle", bundleId);
    const cols = Object.keys(filters);
    await exec(
      `INSERT INTO ${q(bindingTable(o))} (uuid, ${q(`${o.kind}_id`)}, ` +
      "bundle_id, is_baseline, precedence, combine" +
      cols.map((c) => `, ${q(c)}`).join("") + ") VALUES (?, ?, ?, 0, ?, ?" +
      cols.map(() => ", ?").join("") + ")",
      [newUuid(), o.id, bundleId, top + 1, replaces ? "replace" : "add",
       ...cols.map((c) => filters[c] ?? null)]);
    bindingId = Number((await exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    rec.created(bindingTable(o), bindingId);
  });
  return { change: rec.result, bindingId };
}

/** Change when an exception applies, or whether it replaces. */
export async function updateException(
    exec: SqlExec, registry: Registry, owner: OwnerArg, bindingId: number,
    patch: { when?: When; replaces?: boolean }): Promise<ChangeUndo> {
  const o = ownerOf(owner);
  const rec = new ChangeRecorder("Changed an exception");
  await withTransaction(exec, async () => {
    await rec.snapshot(exec, bindingTable(o), bindingId);
    const sets: Record<string, SqlValue> = {};
    if (patch.when !== undefined) {
      Object.assign(sets, filterValues(registry, o, patch.when));
    }
    if (patch.replaces !== undefined) {
      sets["combine"] = patch.replaces ? "replace" : "add";
    }
    const cols = Object.keys(sets);
    if (cols.length === 0) return;
    await exec(
      `UPDATE ${q(bindingTable(o))} SET ` +
      cols.map((c) => `${q(c)} = ?`).join(", ") +
      ", updated_at = datetime('now') WHERE id = ?",
      [...cols.map((c) => sets[c] ?? null), bindingId]);
  });
  return rec.result;
}

/**
 * Move an exception one place up (wins over more) or down. Exceptions
 * are renumbered 1…n from the bottom so the order shown IS the
 * precedence; baselines, at 0, are never touched.
 */
export async function moveException(
    exec: SqlExec, registry: Registry, owner: OwnerArg, board: BoardName,
    bindingId: number, direction: "up" | "down"): Promise<ChangeUndo> {
  const o = ownerOf(owner);
  const rec = new ChangeRecorder("Reordered exceptions");
  await withTransaction(exec, async () => {
    const list = (await exceptions(exec, registry, o, board))
      .map((x) => x.bindingId);           // highest first
    const i = list.indexOf(bindingId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as number, list[i] as number];
    for (let k = 0; k < list.length; k += 1) {
      const id = list[k] as number;
      const precedence = list.length - k;
      const cur = Number((await exec(
        `SELECT COALESCE(precedence, 0) AS p FROM ${q(bindingTable(o))} ` +
        "WHERE id = ?", [id]))[0]?.["p"]);
      if (cur === precedence) continue;
      await rec.snapshot(exec, bindingTable(o), id);
      await exec(
        `UPDATE ${q(bindingTable(o))} SET precedence = ?, ` +
        "updated_at = datetime('now') WHERE id = ?", [precedence, id]);
    }
  });
  return rec.result;
}

/**
 * Remove an exception: its binding, and its bundle with the bundle's
 * memberships when nothing else binds that bundle. The files stay in
 * the project.
 */
export async function removeException(
    exec: SqlExec, registry: Registry, owner: OwnerArg,
    bindingId: number): Promise<ChangeUndo> {
  const o = ownerOf(owner);
  const rec = new ChangeRecorder("Removed an exception");
  await withTransaction(exec, async () => {
    const row = (await exec(
      `SELECT bundle_id FROM ${q(bindingTable(o))} WHERE id = ?`,
      [bindingId]))[0];
    if (row === undefined) return;
    const bundleId = Number(row["bundle_id"]);
    await rec.snapshot(exec, bindingTable(o), bindingId);
    await exec(`DELETE FROM ${q(bindingTable(o))} WHERE id = ?`, [bindingId]);
    let stillBound = false;
    for (const subject of bindingSubjects(registry)) {
      const n = await exec(
        `SELECT 1 FROM ${q(`${subject}_asset_binding`)} WHERE bundle_id = ? ` +
        "LIMIT 1", [bundleId]);
      if (n.length > 0) { stillBound = true; break; }
    }
    if (stillBound) return;
    for (const m of await exec(
        "SELECT id FROM bundle_asset WHERE bundle_id = ?", [bundleId])) {
      await rec.snapshot(exec, "bundle_asset", Number(m["id"]));
    }
    await rec.snapshot(exec, "bundle", bundleId);
    await exec("DELETE FROM bundle_asset WHERE bundle_id = ?", [bundleId]);
    await exec("DELETE FROM bundle WHERE id = ?", [bundleId]);
  });
  return rec.result;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Make asset rows for files the board was given, reusing any row that
 * already has the identifier — one file used twenty ways is twenty links
 * and one asset. Returns every asset id, in the order given, and which
 * of them this call created, so the drop's undo can remove those too.
 */
export async function registerFiles(
    exec: SqlExec, candidates: readonly ImportCandidate[]):
    Promise<{ assetIds: number[]; created: number[] }> {
  const plan = await planAssetImport(exec, candidates);
  const created: number[] = [];
  for (const c of plan.create) {
    await applyAssetImport(exec, [c]);
    created.push(Number((await exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]));
  }
  const ids = new Map<string, number>([
    ...plan.existing.map((e) => [e.identifier, e.id] as const),
    ...plan.create.map((c, i) =>
      [c.identifier.trim(), created[i] as number] as const),
  ]);
  const assetIds: number[] = [];
  for (const c of candidates) {
    const id = ids.get(c.identifier.trim());
    if (id !== undefined && !assetIds.includes(id)) assetIds.push(id);
  }
  return { assetIds, created };
}

/** Fold the asset rows a drop created into the drop's own undo. */
export function withCreatedAssets(change: ChangeUndo,
                                  assetIds: readonly number[]): ChangeUndo {
  return {
    ...change,
    // First, so undo — which removes newest first — deletes the links
    // before the assets they point at.
    created: [...assetIds.map((id) => ({ entity: "asset", id })),
              ...change.created],
  };
}
