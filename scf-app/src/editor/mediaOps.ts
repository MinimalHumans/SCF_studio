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
 * | Look / Voice reference   | bundle_asset in the character's baseline    |
 * |                          | set; on first use a bundle of the board's   |
 * |                          | intent and a baseline binding to it         |
 * | Concept, Inspiration     | asset_relationship                          |
 *
 * Every row is ordinary SCF — what a careful hand-author would write —
 * so a board-built look and a hand-built look give the same Q13 answer
 * (`mediaOps.test.ts` holds that equivalence).
 *
 * "The baseline set" is identified STRUCTURALLY, never by a marker: a
 * binding of this character, baseline, at no scene range, with no state
 * or variant filter, to a bundle of the board's intent. A flag saying
 * "made by the workspace" would be a second description of that same
 * fact, free to disagree with it. Bindings that do carry a filter are
 * exceptions; they are read here and authored in a later phase.
 *
 * Purpose lives on the LINK, never on the asset (§8.4): one file can be
 * a character's face and a location's inspiration at once, and changing
 * what it is for here changes one link and leaves the asset alone.
 *
 * Headless (no view imports), and every write returns its ChangeUndo so
 * one drop undoes as one step.
 */

import {
  newUuid, q, withTransaction, type Row, type SqlExec,
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
import { ChangeRecorder, type ChangeUndo } from "../state/undoChange.ts";

export const BOARDS = {
  look: { intent: "visual_identity", anchorType: "visual", noun: "look" },
  voice: { intent: "voice_identity", anchorType: "audio", noun: "voice" },
} as const;
export type BoardName = keyof typeof BOARDS;

export type Purpose = "identity" | "set" | "concept" | "inspiration";
export const PURPOSES: Purpose[] = ["identity", "set", "concept", "inspiration"];

export const PURPOSE_LABEL: Record<BoardName, Record<Purpose, string>> = {
  look: { identity: "This is them", set: "Look", concept: "Concept",
          inspiration: "Inspiration" },
  voice: { identity: "This is their voice", set: "Voice reference",
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
    identity: "Their voice. Mark the stretch to match against.",
    set: "Part of how they sound — what tools should use.",
    concept: "Exploration of the voice. Informs, isn't the answer.",
    inspiration: "Voices and recordings from outside the project.",
  },
};

const NOT_CUT = (alias: string): string =>
  `(${alias}.lifecycle_status IS NULL OR ${alias}.lifecycle_status <> 'cut')`;

const blank = (col: string): string => `COALESCE(${col}, '') = ''`;

/** The filter columns that make a binding an exception, not a baseline. */
const PURE_BASELINE =
  `b.is_baseline = 1 AND ${blank("b.scene_range_start_id")} AND ` +
  `${blank("b.scene_range_end_id")} AND ${blank("b.physical_state_filter")} ` +
  `AND ${blank("b.vocal_state_filter")} AND ${blank("b.variant_id")}`;

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
  /** bundle_asset.role_in_bundle, for Look and Voice reference tiles. */
  role: string | null;
  /** entity_anchor.canonical_status, for identity tiles. */
  status: string | null;
  /** The variant an identity anchor belongs to (proposal 0033). */
  variant: string | null;
}

export interface BaselineSet {
  bindingId: number;
  bundleId: number;
  name: string;
  /** Other subjects this bundle is bound to. */
  sharedWith: string[];
}

export interface Exception {
  bindingId: number;
  bundleId: number;
  bundleName: string;
  /** "while wounded", "as Marcus, age nine", "scenes 9–12", in words. */
  when: string;
  replaces: boolean;
  assets: number;
}

export interface BoardData {
  tiles: Tile[];
  sets: BaselineSet[];
  exceptions: Exception[];
}

/** Which board a concept or inspiration file sits on: by what it is. */
export function boardForIdentifier(identifier: unknown): BoardName {
  if (typeof identifier !== "string") return "look";
  return previewCapability(formatOf(identifier)).kind === "audio"
    ? "voice" : "look";
}

async function characterName(exec: SqlExec, id: number): Promise<string> {
  return String((await exec("SELECT name FROM character WHERE id = ?",
                            [id]))[0]?.["name"] ?? "Character");
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
    exec: SqlExec, registry: Registry, characterId: number,
    board: BoardName): Promise<BaselineSet[]> {
  const rows = await exec(
    "SELECT b.id AS binding_id, u.id AS bundle_id, u.name " +
    "FROM character_asset_binding b JOIN bundle u ON u.id = b.bundle_id " +
    `WHERE b.character_id = ? AND u.intent = ? AND ${PURE_BASELINE} ` +
    `AND ${NOT_CUT("b")} AND ${NOT_CUT("u")} ` +
    "ORDER BY COALESCE(b.precedence, 0), b.id",
    [characterId, BOARDS[board].intent]);
  const out: BaselineSet[] = [];
  for (const r of rows) {
    const bundleId = Number(r["bundle_id"]);
    out.push({
      bindingId: Number(r["binding_id"]), bundleId,
      name: String(r["name"] ?? "Untitled set"),
      sharedWith: await bundleSharedWith(exec, registry, bundleId,
                                         { subject: "character", id: characterId }),
    });
  }
  return out;
}

async function exceptions(exec: SqlExec, characterId: number,
                          board: BoardName): Promise<Exception[]> {
  const rows = await exec(
    "SELECT b.*, u.name AS bundle_name, " +
    "(SELECT COUNT(*) FROM bundle_asset m WHERE m.bundle_id = u.id) AS n, " +
    "s1.scene_number AS from_n, s2.scene_number AS to_n, v.name AS variant " +
    "FROM character_asset_binding b JOIN bundle u ON u.id = b.bundle_id " +
    "LEFT JOIN scene s1 ON s1.id = b.scene_range_start_id " +
    "LEFT JOIN scene s2 ON s2.id = b.scene_range_end_id " +
    "LEFT JOIN character_variant v ON v.id = b.variant_id " +
    `WHERE b.character_id = ? AND u.intent = ? AND NOT (${PURE_BASELINE}) ` +
    `AND ${NOT_CUT("b")} ORDER BY COALESCE(b.precedence, 0), b.id`,
    [characterId, BOARDS[board].intent]);
  return rows.map((r) => {
    const parts: string[] = [];
    if (r["variant"] !== null && r["variant"] !== undefined) {
      parts.push(`as ${String(r["variant"])}`);
    }
    const phys = r["physical_state_filter"];
    if (typeof phys === "string" && phys !== "") parts.push(`while ${phys}`);
    const voc = r["vocal_state_filter"];
    if (typeof voc === "string" && voc !== "") parts.push(`while the voice is ${voc}`);
    const from = r["from_n"], to = r["to_n"];
    if (from !== null && from !== undefined && to !== null && to !== undefined) {
      parts.push(`scenes ${String(from)}–${String(to)}`);
    } else if (from !== null && from !== undefined) {
      parts.push(`from scene ${String(from)}`);
    } else if (to !== null && to !== undefined) {
      parts.push(`up to scene ${String(to)}`);
    }
    if (parts.length === 0) parts.push("as a second baseline");
    return {
      bindingId: Number(r["id"]), bundleId: Number(r["bundle_id"]),
      bundleName: String(r["bundle_name"] ?? "Untitled set"),
      when: parts.join(", "),
      replaces: r["combine"] === "replace",
      assets: Number(r["n"] ?? 0),
    };
  });
}

/** Everything a board shows, in one read. */
export async function loadBoard(
    exec: SqlExec, registry: Registry, characterId: number,
    board: BoardName): Promise<BoardData> {
  const spec = BOARDS[board];
  const labels = PURPOSE_LABEL[board];
  const tiles: Tile[] = [];

  const anchors = await exec(
    "SELECT a.id AS link_id, a.canonical_status, v.name AS variant, s.* " +
    "FROM entity_anchor a JOIN asset s ON s.id = a.asset_id " +
    "LEFT JOIN character_variant v ON v.id = a.subject_variant_id " +
    "WHERE a.subject_type = 'character' AND a.subject_id = ? " +
    `AND a.anchor_type = ? AND ${NOT_CUT("a")} ORDER BY a.id`,
    [characterId, spec.anchorType]);
  for (const r of anchors) {
    const { link_id, canonical_status, variant, ...asset } = r;
    tiles.push({
      key: `entity_anchor:${String(link_id)}`, purpose: "identity",
      label: labels.identity, asset,
      link: { entity: "entity_anchor", id: Number(link_id) },
      role: null,
      status: canonical_status === null || canonical_status === undefined
        ? null : String(canonical_status),
      variant: variant === null || variant === undefined ? null : String(variant),
    });
  }

  const sets = await baselineSets(exec, registry, characterId, board);
  for (const set of sets) {
    const members = await exec(
      "SELECT m.id AS link_id, m.role_in_bundle, s.* FROM bundle_asset m " +
      "JOIN asset s ON s.id = m.asset_id WHERE m.bundle_id = ? " +
      'ORDER BY m."order", m.id', [set.bundleId]);
    for (const r of members) {
      const { link_id, role_in_bundle, ...asset } = r;
      tiles.push({
        key: `bundle_asset:${String(link_id)}`, purpose: "set",
        label: labels.set, asset,
        link: { entity: "bundle_asset", id: Number(link_id) },
        role: role_in_bundle === null || role_in_bundle === undefined ||
          role_in_bundle === "" ? null : String(role_in_bundle),
        status: null, variant: null,
      });
    }
  }

  const related = await exec(
    "SELECT r.id AS link_id, r.relationship_type, s.* FROM asset_relationship r " +
    "JOIN asset s ON s.id = r.asset_id WHERE r.entity_type = 'character' " +
    "AND r.entity_id = ? ORDER BY r.id", [characterId]);
  for (const r of related) {
    const { link_id, relationship_type, ...asset } = r;
    if (boardForIdentifier(asset["identifier"]) !== board) continue;
    const type = String(relationship_type ?? "reference");
    const purpose: Purpose | "other" =
      type === "concept" || type === "inspiration" ? type : "other";
    tiles.push({
      key: `asset_relationship:${String(link_id)}`, purpose,
      label: purpose === "other" ? type : labels[purpose], asset,
      link: { entity: "asset_relationship", id: Number(link_id) },
      role: null, status: null, variant: null,
    });
  }

  return { tiles, sets,
           exceptions: await exceptions(exec, characterId, board) };
}

export interface AttachOptions {
  /** bundle_asset.role_in_bundle for a Look / Voice reference. */
  role?: string | null;
  /** When the baseline set is shared with another subject: add for
   *  everyone using it, or give this character a copy first. Unset
   *  means ask — `attach` throws SharedSetError. */
  shared?: "both" | "split";
}

/**
 * Point files at a character, for a purpose. Re-attaching what is
 * already attached the same way does nothing, so a repeated drop is
 * safe. Returns the change to undo, empty when nothing was written.
 */
export async function attach(
    exec: SqlExec, registry: Registry, characterId: number,
    board: BoardName, assetIds: readonly number[], purpose: Purpose,
    options: AttachOptions = {}): Promise<ChangeUndo> {
  const rec = new ChangeRecorder("");
  await withTransaction(exec, () =>
    attachInto(rec, exec, registry, characterId, board, assetIds, purpose,
               options));
  const name = await characterName(exec, characterId);
  const n = assetIds.length;
  rec.label = `Added ${n === 1 ? "a file" : `${String(n)} files`} to ` +
              `${name}'s ${BOARDS[board].noun}`;
  return rec.result;
}

async function attachInto(
    rec: ChangeRecorder, exec: SqlExec, registry: Registry,
    characterId: number, board: BoardName, assetIds: readonly number[],
    purpose: Purpose, options: AttachOptions): Promise<void> {
  const spec = BOARDS[board];
  const lastId = async (): Promise<number> =>
    Number((await exec("SELECT last_insert_rowid() AS id"))[0]?.["id"]);

  if (purpose === "identity") {
    for (const assetId of assetIds) {
      const existing = await exec(
        "SELECT id FROM entity_anchor WHERE subject_type = 'character' " +
        "AND subject_id = ? AND asset_id = ? AND anchor_type = ? " +
        "AND subject_variant_id IS NULL", [characterId, assetId, spec.anchorType]);
      if (existing.length > 0) continue;
      // Verified: the writer pointing at it IS the verification. Q13
      // passes over candidates (§12.8), so a candidate would never reach
      // any tool; candidate stays for anchors something else proposed.
      await exec(
        "INSERT INTO entity_anchor (uuid, subject_type, subject_id, " +
        "anchor_type, asset_id, canonical_status) " +
        "VALUES (?, 'character', ?, ?, ?, 'verified')",
        [newUuid(), characterId, spec.anchorType, assetId]);
      const id = await lastId();
      rec.created("entity_anchor", id);
    }
    return;
  }

  if (purpose === "concept" || purpose === "inspiration") {
    for (const assetId of assetIds) {
      const existing = await exec(
        "SELECT id FROM asset_relationship WHERE asset_id = ? " +
        "AND entity_type = 'character' AND entity_id = ? " +
        "AND relationship_type = ?", [assetId, characterId, purpose]);
      if (existing.length > 0) continue;
      await exec(
        "INSERT INTO asset_relationship (uuid, asset_id, entity_type, " +
        "entity_id, relationship_type) VALUES (?, ?, 'character', ?, ?)",
        [newUuid(), assetId, characterId, purpose]);
      const id = await lastId();
      rec.created("asset_relationship", id);
    }
    return;
  }

  // purpose === "set": the character's baseline set for this board.
  let set = (await baselineSets(exec, registry, characterId, board))[0];
  if (set === undefined) {
    const name = await characterName(exec, characterId);
    const bundleId = await createBundle(exec, `${name} — ${spec.noun}`,
                                        spec.intent);
    rec.created("bundle", bundleId);
    const bindingId = await bindBundle(exec, registry, "character",
                                       characterId, bundleId,
                                       { isBaseline: true, precedence: 0 });
    if (bindingId !== null) rec.created("character_asset_binding", bindingId);
    set = { bindingId: bindingId ?? 0, bundleId, name, sharedWith: [] };
  } else if (set.sharedWith.length > 0) {
    if (options.shared === undefined) throw new SharedSetError(set.sharedWith);
    if (options.shared === "split") {
      set = await splitInto(rec, exec, characterId, board, set);
    }
  }
  const plan = await planBundleAdd(exec, set.bundleId, assetIds);
  if (plan.add.length === 0) return;
  const role = options.role === undefined || options.role === null ||
    options.role.trim() === "" ? null : options.role.trim();
  await applyBundleAdd(exec, set.bundleId, plan.add, role);
  const links = await exec(
    "SELECT id, asset_id FROM bundle_asset WHERE bundle_id = ? " +
    `AND asset_id IN (${plan.add.map(() => "?").join(", ")})`,
    [set.bundleId, ...plan.add]);
  for (const l of links) rec.created("bundle_asset", Number(l["id"]));
}

/**
 * Give this character its own copy of a shared baseline set: a new
 * bundle with the same members, and this character's binding pointed at
 * it. The other subjects keep the original untouched.
 */
async function splitInto(rec: ChangeRecorder, exec: SqlExec,
                         characterId: number, board: BoardName,
                         set: BaselineSet): Promise<BaselineSet> {
  const spec = BOARDS[board];
  const name = await characterName(exec, characterId);
  const bundleId = await createBundle(exec, `${name} — ${spec.noun}`,
                                      spec.intent);
  rec.created("bundle", bundleId);
  const members = await exec(
    'SELECT asset_id, role_in_bundle FROM bundle_asset WHERE bundle_id = ? ' +
    'ORDER BY "order", id', [set.bundleId]);
  for (const m of members) {
    await applyBundleAdd(exec, bundleId, [Number(m["asset_id"])],
                         m["role_in_bundle"] === null ? null
                           : String(m["role_in_bundle"]));
  }
  for (const l of await exec(
      "SELECT id FROM bundle_asset WHERE bundle_id = ?", [bundleId])) {
    rec.created("bundle_asset", Number(l["id"]));
  }
  await rec.snapshot(exec, "character_asset_binding", set.bindingId);
  await exec(
    "UPDATE character_asset_binding SET bundle_id = ?, " +
    "updated_at = datetime('now') WHERE id = ?", [bundleId, set.bindingId]);
  return { bindingId: set.bindingId, bundleId, name: `${name} — ${spec.noun}`,
           sharedWith: [] };
}

/**
 * Take a tile off the board: its link row only. The asset stays in the
 * project — §8.6's orphan report is what notices it is now unused —
 * and removing a file from the project is a separate act, in Assets.
 */
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
    exec: SqlExec, registry: Registry, characterId: number,
    board: BoardName, tile: Tile, purpose: Purpose,
    options: AttachOptions = {}): Promise<ChangeUndo> {
  const rec = new ChangeRecorder(
    `${String(tile.asset["name"] ?? "File")} is now ` +
    PURPOSE_LABEL[board][purpose].toLowerCase());
  await withTransaction(exec, async () => {
    await rec.snapshot(exec, tile.link.entity, tile.link.id);
    await exec(`DELETE FROM ${q(tile.link.entity)} WHERE id = ?`,
               [tile.link.id]);
    await attachInto(rec, exec, registry, characterId, board,
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
    ...plan.create.map((c, i) => [c.identifier.trim(), created[i] as number] as const),
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
