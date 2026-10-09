// SPDX-License-Identifier: Apache-2.0
/**
 * relatedMediaOps.ts — media about a shot or a scene.
 *
 * Storyboard panels, start and end frames, previs, and anything else a
 * shot or scene points at. Spec §8.6 says these sit on
 * `asset_relationship` (`entity_type` = `shot` or `scene`), not on a
 * binding: there is no subject, precedence or filter here, only "this
 * file is about that shot". Purpose lives on the link (§8.4) as
 * `relationship_type`; position is `order` (proposal 0037), one
 * sequence per entity whatever the type.
 *
 * Headless (no view imports), and every write returns its ChangeUndo so
 * one action undoes as one step.
 */

import {
  newUuid, q, withTransaction, type Row, type SqlExec,
} from "@scf-core/db.ts";
import { ChangeRecorder, type ChangeUndo } from "../state/undoChange.ts";

/** What a related file can be about. */
export type MediaOwnerKind = "shot" | "scene";

export interface MediaOwner {
  kind: MediaOwnerKind;
  id: number;
}

/** The relationship types this strip offers, in the order it offers
 *  them. Others written elsewhere are shown as they are stored. */
export const MEDIA_TYPES = [
  "storyboard", "start_frame", "end_frame", "previs", "reference",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_LABEL: Record<MediaType, string> = {
  storyboard: "Storyboard",
  start_frame: "Start frame",
  end_frame: "End frame",
  previs: "Previs",
  reference: "Reference",
};

export const MEDIA_HELP: Record<MediaType, string> = {
  storyboard: "A panel planning the shot. Panels keep the order you give them.",
  start_frame: "The frame it opens on — for a generator, the first frame.",
  end_frame: "The frame it closes on — for a generator, the last frame.",
  previs: "A moving rough: animatic, blocking render, previs clip.",
  reference: "Anything else: a clip, a sound, a 3D scan, a lighting plate.",
};

/** A stored type's label: the strip's own name, or the type as stored. */
export function mediaLabel(type: string | null): string {
  if (type === null || type === "") return "Untyped";
  return (MEDIA_LABEL as Record<string, string>)[type] ?? type;
}

export interface MediaTile {
  /** The asset_relationship row. */
  linkId: number;
  type: string | null;
  order: number | null;
  notes: string | null;
  asset: Row;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

const ORDER_BY =
  `ORDER BY r.${q("order")} IS NULL, r.${q("order")}, r.id`;

/** Every file related to the owner, in §8.6's order. */
export async function loadMedia(exec: SqlExec,
                                owner: MediaOwner): Promise<MediaTile[]> {
  const rows = await exec(
    `SELECT r.id AS link_id, r.relationship_type AS link_type, ` +
    `r.${q("order")} AS link_order, r.notes AS link_notes, s.* ` +
    "FROM asset_relationship r JOIN asset s ON s.id = r.asset_id " +
    `WHERE r.entity_type = ? AND r.entity_id = ? ${ORDER_BY}`,
    [owner.kind, owner.id]);
  return rows.map((r) => {
    const { link_id, link_type, link_order, link_notes, ...asset } = r;
    return {
      linkId: Number(link_id), type: str(link_type),
      order: link_order === null || link_order === undefined
        ? null : Number(link_order),
      notes: str(link_notes), asset,
    };
  });
}

/** How many files each owner of a kind has, for the collapsed rows. */
export async function mediaCounts(
    exec: SqlExec, kind: MediaOwnerKind): Promise<Map<number, number>> {
  const rows = await exec(
    "SELECT entity_id, COUNT(*) AS n FROM asset_relationship " +
    "WHERE entity_type = ? GROUP BY entity_id", [kind]);
  return new Map(rows.map((r) => [Number(r["entity_id"]), Number(r["n"])]));
}

/**
 * Point files at a shot or scene, for one purpose, after what is there.
 * A file already related the same way is skipped, so a repeated drop is
 * safe; the same file as a storyboard and as a start frame is two links.
 */
export async function attachMedia(
    exec: SqlExec, owner: MediaOwner, assetIds: readonly number[],
    type: string): Promise<ChangeUndo> {
  const rec = new ChangeRecorder("");
  let added = 0;
  await withTransaction(exec, async () => {
    const max = await exec(
      `SELECT MAX(${q("order")}) AS m, COUNT(*) AS n ` +
      "FROM asset_relationship WHERE entity_type = ? AND entity_id = ?",
      [owner.kind, owner.id]);
    // Unordered rows count too: a strip of three untouched rows puts the
    // next one fourth, not first.
    let next = Math.max(Number(max[0]?.["m"] ?? 0),
                        Number(max[0]?.["n"] ?? 0)) + 1;
    for (const assetId of assetIds) {
      const existing = await exec(
        "SELECT id FROM asset_relationship WHERE asset_id = ? " +
        "AND entity_type = ? AND entity_id = ? AND relationship_type = ?",
        [assetId, owner.kind, owner.id, type]);
      if (existing.length > 0) continue;
      const made = await exec(
        "INSERT INTO asset_relationship (uuid, asset_id, entity_type, " +
        `entity_id, relationship_type, ${q("order")}) ` +
        "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        [newUuid(), assetId, owner.kind, owner.id, type, next]);
      rec.created("asset_relationship", Number(made[0]?.["id"]));
      next += 1;
      added += 1;
    }
  });
  rec.label = `Added ${added === 1 ? "a file" : `${String(added)} files`} ` +
    `to the ${owner.kind} as ${mediaLabel(type).toLowerCase()}`;
  return rec.result;
}

/** Take a file off the shot or scene: its link only. The asset stays. */
export async function detachMedia(exec: SqlExec,
                                  tile: MediaTile): Promise<ChangeUndo> {
  const rec = new ChangeRecorder(`Removed ${String(tile.asset["name"] ??
    "a file")}`);
  await withTransaction(exec, async () => {
    await rec.snapshot(exec, "asset_relationship", tile.linkId);
    await exec("DELETE FROM asset_relationship WHERE id = ?", [tile.linkId]);
  });
  return rec.result;
}

/** Say what a file is for. Its position stays. */
export async function setMediaType(exec: SqlExec, tile: MediaTile,
                                   type: string): Promise<ChangeUndo> {
  const rec = new ChangeRecorder(`${String(tile.asset["name"] ?? "File")} ` +
    `is now ${mediaLabel(type).toLowerCase()}`);
  await rec.snapshot(exec, "asset_relationship", tile.linkId);
  await exec(
    "UPDATE asset_relationship SET relationship_type = ?, " +
    "updated_at = datetime('now') WHERE id = ?", [type, tile.linkId]);
  return rec.result;
}

/** Write a note on the link: what this panel shows, which take. */
export async function setMediaNotes(exec: SqlExec, tile: MediaTile,
                                    notes: string): Promise<ChangeUndo> {
  const rec = new ChangeRecorder("Changed the note");
  await rec.snapshot(exec, "asset_relationship", tile.linkId);
  await exec(
    "UPDATE asset_relationship SET notes = ?, " +
    "updated_at = datetime('now') WHERE id = ?",
    [notes.trim() === "" ? null : notes.trim(), tile.linkId]);
  return rec.result;
}

/**
 * Move one file a step earlier or later. The whole strip is renumbered
 * 1..n in its new order, so rows that had no order gain one and the
 * sequence the writer sees is the one stored.
 */
export async function moveMedia(
    exec: SqlExec, tiles: readonly MediaTile[], linkId: number,
    delta: -1 | 1): Promise<ChangeUndo | null> {
  const at = tiles.findIndex((t) => t.linkId === linkId);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= tiles.length) return null;
  const next = [...tiles];
  const [moved] = next.splice(at, 1);
  next.splice(to, 0, moved as MediaTile);
  const rec = new ChangeRecorder(`Moved ${String(
    (moved as MediaTile).asset["name"] ?? "a file")} ${
    delta < 0 ? "earlier" : "later"}`);
  await withTransaction(exec, async () => {
    for (const [i, t] of next.entries()) {
      if (t.order === i + 1) continue;
      await rec.snapshot(exec, "asset_relationship", t.linkId);
      await exec(
        `UPDATE asset_relationship SET ${q("order")} = ?, ` +
        "updated_at = datetime('now') WHERE id = ?", [i + 1, t.linkId]);
    }
  });
  return rec.result;
}
