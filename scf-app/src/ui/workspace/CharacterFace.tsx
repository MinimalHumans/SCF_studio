// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { visualAnchorFor, type SubjectAnchor } from "@scf-core/anchors.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { AssetThumb, type ThumbSize } from "../AssetThumb.tsx";

/** "Eleanor Cade" → "EC"; one word → its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? "") + (words[words.length - 1]?.[0] ?? ""))
    .toUpperCase();
}

/**
 * A subject's face: its verified visual anchor cropped to the region,
 * or its initials. Unlike AnchorThumb this is a picture only — no
 * caption, no crop toggle, no click — so it can sit inside a list
 * button without nesting one control in another.
 */
export function CharacterFace({ id, name, size = "sm", kind = "character" }: {
  id: number; name: string; size?: ThumbSize;
  /** Any anchor subject kind: a location's or prop's verified visual
   *  anchor is its face the same way. */
  kind?: "character" | "location" | "prop";
}): JSX.Element {
  const revision = useStore((s) => s.revision);
  const [found, setFound] = useState<SubjectAnchor | null>(null);

  useEffect(() => {
    let cancelled = false;
    void visualAnchorFor({ exec, registry }, kind, id).then((a) => {
      if (!cancelled) setFound(a);
    }).catch(() => { if (!cancelled) setFound(null); });
    return () => { cancelled = true; };
  }, [id, kind, revision]);

  const identifier = found?.asset?.["identifier"];
  // The initials are always drawn, and the picture is laid over them.
  // AssetThumb draws a placeholder of its own when the file cannot be
  // reached (no folder connected, a missing file, a format with no
  // preview); CSS hides that placeholder here, so an unreachable face
  // reads as initials rather than as a dash.
  return (
    <span className={`ws-face ws-face-${size}`}>
      <span aria-hidden="true">{initials(name)}</span>
      {found !== null && identifier !== null && identifier !== undefined && (
        <span className="ws-face-image">
          <AssetThumb identifier={String(identifier)} size={size}
                      region={found.region} alt="" />
        </span>
      )}
    </span>
  );
}
