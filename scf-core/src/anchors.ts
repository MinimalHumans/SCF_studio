// SPDX-License-Identifier: Apache-2.0
/**
 * anchors.ts — which asset depicts a subject, and which part of it.
 *
 * `resolveMedia()` already returns anchors, but it returns ALL of them,
 * filtered to an intent and alongside three other cascade layers,
 * because a query wants the whole picture. A thumbnail wants one
 * answer, and the tie-break has to be stated somewhere rather than
 * being whichever row the UI happened to render first.
 *
 * ## region_box
 *
 * This module is the FIRST READER of `entity_anchor.region_box`.
 * Nothing in the repository had ever parsed it — the field existed in
 * `entity_registry.py` and in the generated entity reference, and
 * nowhere else. That makes reading it a definition, not an
 * implementation, so the shape is stated here and in the registry's
 * own help text rather than being implied by this code:
 *
 *   `{"x": 420, "y": 180, "w": 480, "h": 600}` — PIXELS in the source
 *   asset's own coordinate space, origin at top-left.
 *
 * Pixels rather than a normalised 0..1 box because the field's
 * long-standing placeholder is four integers in the hundreds, and
 * because an anchor is a measurement someone took against a specific
 * file. The cost is that the box only means anything against the asset
 * it was measured on, which is why a consumer must degrade rather than
 * insist (below).
 *
 * NOTE: the spec does not state this. §2.1 makes the registry the
 * authority on fields, so the help text is a published, checksummed
 * home for it — but promoting it to a normative MUST is a format
 * decision, not a UI one. See docs/editor-mvp.md §7b.
 *
 * Parsing is TOTAL, in the sense §2 uses everywhere: a box that is
 * absent, malformed, negative, zero-sized or measured against some
 * other image is not an error. It is an anchor with no usable region,
 * and the answer is the whole asset. An anchor that refuses to display
 * because its box is wrong would be worse than one that shows too
 * much.
 */

import { rows } from "./resolution.ts";
import type { ScfContext } from "./resolution.ts";
import type { Row } from "./db.ts";

/** A rectangle in the source asset's pixels, origin top-left. */
export interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function finite(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a `region_box`, or decide there isn't one.
 *
 * Accepts the stored TEXT (json) or an already-parsed object, since a
 * caller holding a Row has the former and a caller holding a decoded
 * result has the latter, and making them convert first would put a
 * second copy of this leniency at every call site.
 *
 * Returns null — never throws, never guesses — for: absent, empty,
 * unparseable, not an object, missing any of the four members,
 * non-numeric, negative position, or non-positive size. A zero-width
 * box is not a region; it is a typo.
 */
export function parseRegionBox(raw: unknown): RegionBox | null {
  if (raw === null || raw === undefined || raw === "") return null;

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return null;
  }

  const r = obj as Record<string, unknown>;
  const x = finite(r["x"]);
  const y = finite(r["y"]);
  const w = finite(r["w"]);
  const h = finite(r["h"]);
  if (x === null || y === null || w === null || h === null) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * Is this box usable against an image of these dimensions?
 *
 * A box measured on a 4096-wide plate and applied to a 512-wide proxy
 * would crop a corner and present it as the subject's face. Nothing
 * records WHICH file a box was measured against, so the only available
 * check is whether it fits — and a box that does not fit is discarded
 * rather than clamped, because a clamped crop is a confident wrong
 * answer and the whole image is an honest one.
 */
export function regionFits(
  box: RegionBox, naturalWidth: number, naturalHeight: number,
): boolean {
  if (naturalWidth <= 0 || naturalHeight <= 0) return false;
  return box.x + box.w <= naturalWidth && box.y + box.h <= naturalHeight;
}

export interface SubjectAnchor {
  anchor: Row;
  /** The asset the anchor points at, or null if the reference dangles.
   *  Resolved here for the same reason `resolveMedia` resolves it: an
   *  `asset_id` looked up in the wrong table is how an anchor came to
   *  be reported as an unrelated asset. */
  asset: Row | null;
  region: RegionBox | null;
}

/**
 * The one anchor that best depicts a subject, for a single thumbnail.
 *
 * `subjectType` is `character`, `prop` or `location` — the hard closed
 * enum, not the open `entity_type` used elsewhere.
 *
 * Selection, stated rather than incidental:
 *
 *  1. `anchor_type = 'visual'`. An audio anchor depicts nothing.
 *  2. Cut anchors are excluded, by `rows()` (§6.6.1).
 *  3. `canonical_status = 'verified'` wins over an unset one, which
 *     wins over anything else. The field is a verification axis
 *     distinct from lifecycle, and a verified anchor is precisely the
 *     one someone has said is right.
 *  4. Lowest row id breaks the tie — "the row written first", the same
 *     direction §4.5's tie-break settles.
 *
 * Returns null when the subject has no visual anchor at all, which is
 * an ordinary state and not a finding: most rows in a real file do not
 * have one.
 */
export async function visualAnchorFor(
  ctx: ScfContext, subjectType: string, subjectId: number,
): Promise<SubjectAnchor | null> {
  const candidates = (await rows(
    ctx.exec, "entity_anchor", "subject_type = ? AND subject_id = ?",
    [subjectType, subjectId]))
    .filter((a) => a["anchor_type"] === "visual");
  if (candidates.length === 0) return null;

  const rank = (a: Row): number => {
    const s = a["canonical_status"];
    if (s === "verified") return 0;
    if (s === null || s === undefined || s === "") return 1;
    return 2;
  };
  candidates.sort((a, b) =>
    rank(a) - rank(b) || Number(a["id"]) - Number(b["id"]));

  const anchor = candidates[0] as Row;
  const assetId = Number(anchor["asset_id"]);
  const asset = Number.isFinite(assetId)
    ? (await rows(ctx.exec, "asset", "id = ?", [assetId]))[0] ?? null
    : null;

  return { anchor, asset, region: parseRegionBox(anchor["region_box"]) };
}
