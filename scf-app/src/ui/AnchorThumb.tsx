// SPDX-License-Identifier: Apache-2.0
/**
 * AnchorThumb — what a character, prop or location looks like.
 *
 * The answer is the subject's visual ANCHOR, not its bundles. A bundle
 * is everything gathered for an intent; an anchor is somebody pointing
 * at one image and saying "that is her". For a single small picture the
 * second is what you want, and it is position-independent, so it does
 * not need the scene picker the media cascade does.
 *
 * ## The crop
 *
 * `entity_anchor.region_box` names a rectangle inside the asset. Eleanor's
 * face anchor points at a reference SHEET; showing the sheet as her
 * thumbnail is nearly useless, and showing the region is the actual
 * answer. So the crop is the default and the toggle shows the frame it
 * came out of — the toggle exists because a crop with no way back hides
 * the thing that would let someone see the box is wrong.
 *
 * The state is sticky across subjects, like the preview's loop
 * checkbox: someone auditing anchors is auditing several in a row.
 *
 * BundleStrip is the other half — a bundle is a set of assets, and on a
 * BINDING the useful question is "what does this bundle put on screen",
 * which is a row of thumbnails rather than a name.
 */

import { useEffect, useState } from "react";
import { visualAnchorFor, type SubjectAnchor } from "@scf-core/anchors.ts";
import { bundleMembers, type BundleMember } from "@scf-core/bundling.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { AssetThumb, type ThumbSize } from "./AssetThumb.tsx";

const CROP_KEY = "scf:anchor-crop";

/** The three subject types `entity_anchor.subject_type` allows. */
export const ANCHOR_SUBJECTS = ["character", "prop", "location"];

export function AnchorThumb({ subjectType, subjectId, size = "md" }: {
  subjectType: string;
  subjectId: number;
  size?: ThumbSize;
}): JSX.Element | null {
  const { revision, openEntityRow } = useStore();
  const [found, setFound] = useState<SubjectAnchor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [crop, setCrop] = useState(
    () => localStorage.getItem(CROP_KEY) !== "0");
  /** Null until a cropped draw has reported back. A box that does not
   *  fit its asset is an authoring error worth naming — silently
   *  showing the whole frame makes it indistinguishable from an anchor
   *  that never had a region. */
  const [fits, setFits] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const a = await visualAnchorFor({ exec, registry },
                                      subjectType, subjectId);
      if (!cancelled) {
        setFound(a);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [subjectType, subjectId, revision]);

  // Nothing at all until the lookup finishes, so a subject with no
  // anchor never flashes an empty box on its way to showing nothing.
  if (!loaded) return null;

  if (found === null) {
    return (
      <div className="anchor-thumb anchor-thumb-none">
        <div className={`asset-thumb asset-thumb-${size} asset-thumb-chip`}
             title="No visual anchor. Nothing has been pointed at and
called this subject.">
          —
        </div>
      </div>
    );
  }

  const identifier = found.asset === null ? null
    : found.asset["identifier"] === null ||
      found.asset["identifier"] === undefined
      ? null : String(found.asset["identifier"]);
  const anchorName = found.anchor["name"] === null ||
                     found.anchor["name"] === undefined
    ? null : String(found.anchor["name"]);
  const assetId = found.asset === null ? null : Number(found.asset["id"]);

  const setCropping = (on: boolean): void => {
    setCrop(on);
    localStorage.setItem(CROP_KEY, on ? "1" : "0");
  };

  return (
    <div className="anchor-thumb">
      <AssetThumb identifier={identifier} size={size}
                  region={crop ? found.region : null}
                  onRegion={setFits}
                  alt={anchorName ?? "anchor"}
                  onClick={assetId === null ? undefined
                    : () => { void openEntityRow("asset", assetId); }} />
      <div className="anchor-thumb-meta">
        <span className="muted anchor-thumb-name">
          {anchorName ?? "unnamed anchor"}
        </span>
        {found.region !== null && crop && fits === false && (
          <span className="anchor-thumb-warn"
                title="This anchor's region_box does not fit the asset it
points at — it was measured against a different file. Showing the whole
asset instead of cropping to a rectangle that means nothing here.">
            region does not fit
          </span>
        )}
        {found.region !== null && (
          <button className="ghost tiny"
                  onClick={() => setCropping(!crop)}
                  title={crop
                    ? "Showing the anchor's region. Switch to the whole frame."
                    : "Showing the whole asset. Switch back to the region."}>
            {crop ? "whole frame" : "region"}
          </button>
        )}
        {found.region === null &&
         found.anchor["region_box"] !== null &&
         found.anchor["region_box"] !== undefined &&
         found.anchor["region_box"] !== "" && (
          // Present but unreadable. Said out loud, because silently
          // showing the whole frame would make a malformed box look
          // exactly like an absent one.
          <span className="anchor-thumb-warn"
                title="This anchor has a region_box that could not be
read as {x, y, w, h} in pixels. Showing the whole asset instead.">
            region unreadable
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A bundle's contents as a row of thumbnails.
 *
 * On a binding this answers the question the row cannot: a binding says
 * "this bundle, at this precedence, under these filters", and the
 * bundle is a name. What it PUTS ON SCREEN is the thing being decided
 * about.
 */
export function BundleStrip({ bundleId, limit = 8 }: {
  bundleId: number;
  limit?: number;
}): JSX.Element | null {
  const { revision, openEntityRow } = useStore();
  const [members, setMembers] = useState<BundleMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = await bundleMembers(exec, bundleId);
      if (!cancelled) setMembers(m);
    })();
    return () => { cancelled = true; };
  }, [bundleId, revision]);

  if (members === null) return null;
  if (members.length === 0) {
    return (
      <p className="muted bundle-strip-empty">
        This bundle is empty, so it resolves to nothing.
      </p>
    );
  }

  return (
    <div className="bundle-strip">
      {members.slice(0, limit).map((m) => (
        <AssetThumb key={m.linkId} identifier={m.identifier} size="sm"
                    alt={m.assetName ?? `#${m.assetId}`}
                    onClick={() => {
                      void openEntityRow("asset", m.assetId);
                    }} />
      ))}
      {members.length > limit && (
        <span className="muted bundle-strip-more">
          +{members.length - limit}
        </span>
      )}
    </div>
  );
}
