// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { parseIdentifier } from "@scf-core/assets.ts";
import { previewCapability, type PreviewKind } from "@scf-core/preview.ts";
import { useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";
import { resolveCached } from "../files/thumbnailCache.ts";
import { acquire, release } from "../files/objectUrlCache.ts";

/**
 * The frame each shot is shown by, shot id → asset identifier: its first
 * storyboard panel, else its start frame. A superseded file loses to the
 * one that replaced it. Shared by the shot list and the storyboard so
 * the two never disagree about which picture a shot is.
 */
export function useShotFrames(): Map<number, string> {
  const frames = useQuery(
    "SELECT r.entity_id AS shot_id, a.identifier FROM asset_relationship r " +
    "JOIN asset a ON a.id = r.asset_id " +
    "WHERE r.entity_type = 'shot' " +
    "AND r.relationship_type IN ('storyboard', 'start_frame') " +
    "ORDER BY r.entity_id, " +
    "CASE r.relationship_type WHEN 'storyboard' THEN 0 ELSE 1 END, " +
    "a.superseded_by_id IS NOT NULL, " +
    "r.\"order\" IS NULL, r.\"order\", r.id");
  return useMemo(() => {
    const m = new Map<number, string>();
    for (const r of frames) {
      const id = Number(r["shot_id"]);
      if (!m.has(id) && typeof r["identifier"] === "string") {
        m.set(id, r["identifier"]);
      }
    }
    return m;
  }, [frames]);
}

/**
 * An object URL for an image asset (or another kind, when asked), or
 * null while loading or when the identifier does not resolve to one.
 *
 * From the file itself rather than the square thumbnail cache: a frame
 * is the point of these views and should print and project sharp.
 * Loaded eagerly, because a print only shows what has already loaded.
 */
export function useFrameUrl(identifier: string | null,
                            kinds: readonly PreviewKind[] = ["image"]):
    string | null {
  const { assetRoot, environmentRevision } = useStore();
  const root = assetRoot;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (identifier === null) return;
    const parsed = parseIdentifier(identifier);
    if (parsed === null) return;
    let cancelled = false;
    let held = false;
    void (async () => {
      const r = await resolveCached(root, identifier, environmentRevision);
      if (cancelled || r.state !== "resolved") return;
      const kind = previewCapability(r.format).kind;
      if (kind === null || !kinds.includes(kind)) return;
      held = true;
      const u = await acquire(root, parsed.path);
      if (!cancelled) setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (held) release(root, parsed.path);
    };
  }, [identifier, root, environmentRevision, kinds.join()]);  // eslint-disable-line react-hooks/exhaustive-deps

  return url;
}

/**
 * One shot's frame in a box of a given shape. `cover` fills the box (a
 * board reads as a grid of equal panels); `contain` shows all of it.
 * With no picture, `placeholder` is drawn in the box instead, so a shot
 * not yet boarded still holds its place.
 */
export function ShotFrame({ identifier, alt, className = "",
                            aspect, fit = "cover", placeholder }: {
  identifier: string | null;
  alt: string;
  className?: string;
  /** Width over height. Omitted: the stylesheet decides. */
  aspect?: number;
  fit?: "cover" | "contain";
  placeholder?: string;
}): JSX.Element {
  const url = useFrameUrl(identifier);
  return (
    <div className={`${className} shot-frame` +
                    (url === null ? " shot-frame-empty" : "")}
         style={aspect === undefined ? undefined : { aspectRatio: String(aspect) }}>
      {url !== null
        ? <img src={url} alt={alt} style={{ objectFit: fit }} />
        : placeholder !== undefined &&
          <span className="shot-frame-placeholder">{placeholder}</span>}
    </div>
  );
}
