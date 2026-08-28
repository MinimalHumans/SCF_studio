// SPDX-License-Identifier: Apache-2.0
/**
 * AssetThumb — the small one.
 *
 * Deliberately NOT AssetPreview at a smaller size. A previewer is one
 * of a kind on screen and can afford to resolve, read and hold a file
 * the moment it mounts; a thumbnail appears forty at a time in a list
 * nobody has scrolled yet. Three differences follow, and they are the
 * whole reason this is a separate component:
 *
 *  1. Nothing loads until the row is ON SCREEN (IntersectionObserver).
 *     A bundle of two hundred plates that the user never scrolls costs
 *     two hundred resolutions and zero reads.
 *  2. Resolution and the drawn raster both come from `thumbnailCache`,
 *     which survives unmount, tab switches and reload. Leaving the
 *     assets tab and coming back used to rebuild everything; the second
 *     visit now touches no files at all.
 *  3. Images only. Video would need a poster frame, which means
 *     decoding to a canvas; audio and text have no small form at all.
 *     Everything else gets a format chip — the SAME SIZE as an image,
 *     because a slot that collapses for the .zip makes every list jump
 *     as it loads, and three of the nine assets in Hollow Creek are
 *     not natively viewable.
 *
 * The chip is not a failure state. `previewCapability`'s third tier is
 * a real tier: a LoRA is not media, and there is no image of it to fail
 * to render.
 *
 * The CROP lives in the cache, not in CSS. The first version scaled and
 * offset the full image inside a clipping box, which meant holding a
 * whole plate decoded in order to show 176 pixels of it — and it could
 * not tell "no region" from "a region that did not fit", because both
 * render as the whole frame.
 */

import { useEffect, useRef, useState } from "react";
import { previewCapability, LARGE_FILE_BYTES }
  from "@scf-core/preview.ts";
import { parseIdentifier, type Resolution } from "@scf-core/assets.ts";
import type { RegionBox } from "@scf-core/anchors.ts";
import { resolveCached, thumbnailFor, type Thumbnail }
  from "../files/thumbnailCache.ts";
import { useStore } from "../state/store.ts";

export type ThumbSize = "sm" | "md" | "lg";

/** Short label for a tier-2/3 asset. The detail goes in the title. */
function chipLabel(format: string | null): string {
  if (format === null) return "?";
  return format.length > 5 ? format.slice(0, 5) : format;
}

export function AssetThumb({ identifier, size = "sm", region = null,
                            alt = "", onClick, onRegion }: {
  identifier: string | null;
  size?: ThumbSize;
  /** Crop to this box, in the asset's own pixels. Applied during
   *  generation, and dropped if it does not fit what loaded. */
  region?: RegionBox | null;
  alt?: string;
  onClick?: () => void;
  /** Told whether the region was actually used, so a caller that asked
   *  for one can report a box that does not fit its asset. */
  onRegion?: (applied: boolean) => void;
}): JSX.Element {
  const { projectRoot, environmentRevision } = useStore();
  const root = projectRoot as FileSystemDirectoryHandle | null;
  const box = useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [thumb, setThumb] = useState<Thumbnail | null>(null);

  // On screen? Rendered with a margin so a thumbnail is ready by the
  // time it is scrolled to, rather than popping in after it arrives.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      // One-way: once seen, stay loaded. Unloading on scroll-away would
      // re-read the file every time the list moved.
      if (es.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Memoised across every thumbnail of the same asset AND across
  // mounts, so a list makes one traversal per distinct identifier on
  // the first visit and none at all on the second. This was the bulk of
  // the lag: `getDirectoryHandle`/`getFileHandle`/`getFile` per row,
  // re-run every time the tab was opened.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const r = await resolveCached(root, identifier, environmentRevision);
      if (!cancelled) setResolution(r);
    })();
    return () => { cancelled = true; };
  }, [visible, identifier, root, environmentRevision]);

  const cap = previewCapability(resolution?.format ?? null);
  const parsed = identifier === null ? null : parseIdentifier(identifier);
  const drawable = resolution?.state === "resolved" &&
                   cap.kind === "image" &&
                   (resolution.sizeBytes ?? 0) <= LARGE_FILE_BYTES;

  useEffect(() => {
    if (!drawable || parsed === null || resolution === null) return;
    let cancelled = false;
    void (async () => {
      const t = await thumbnailFor(root, parsed.path, resolution, region);
      if (cancelled) return;
      setThumb(t);
      if (t !== null) onRegion?.(t.regionApplied);
    })();
    return () => { cancelled = true; };
    // `resolution` is identity-stable per asset because it comes from a
    // memoised promise, so this does not re-run on every render.
  }, [drawable, parsed?.path, root, resolution, region]);

  const cls = `asset-thumb asset-thumb-${size}`;

  if (identifier === null) {
    return (
      <div ref={box} className={`${cls} asset-thumb-chip`}
           title="No identifier, so there is nothing to address.">
        —
      </div>
    );
  }

  if (!visible || resolution === null) {
    return <div ref={box} className={`${cls} asset-thumb-idle`} />;
  }

  if (resolution.state !== "resolved") {
    return (
      <div ref={box} className={`${cls} asset-thumb-chip
                                 asset-thumb-${resolution.state}`}
           title={resolution.detail ??
             (root === null
               ? "No project folder attached, so nothing can resolve."
               : "")}>
        {resolution.state === "unaddressed" ? "—" : "!"}
      </div>
    );
  }

  if (!drawable) {
    const why = (resolution.sizeBytes ?? 0) > LARGE_FILE_BYTES
      ? `${Math.round((resolution.sizeBytes ?? 0) / 1024 / 1024)} MB — ` +
        `too large to decode for a thumbnail. Open the asset to load it.`
      : cap.detail ?? "";
    return (
      <div ref={box} className={`${cls} asset-thumb-chip`} title={why}>
        {chipLabel(resolution.format)}
      </div>
    );
  }

  return (
    <div ref={box}
         className={`${cls}${onClick === undefined ? "" : " asset-thumb-btn"}`}
         onClick={onClick}
         role={onClick === undefined ? undefined : "button"}
         title={alt}>
      {thumb !== null && (
        <img src={thumb.dataUrl} alt={alt} className="asset-thumb-img" />
      )}
    </div>
  );
}
