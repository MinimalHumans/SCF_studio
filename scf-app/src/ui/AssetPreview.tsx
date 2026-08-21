// SPDX-License-Identifier: Apache-2.0
/**
 * AssetPreview — showing the bytes an identifier points at (P5).
 *
 * Only tier 1 renders: an object URL into an <img>, <video>, <audio>,
 * <iframe> for pdf, or truncated text. Tiers 2 and 3 say what they are
 * and why, because "cannot display" is a real answer and dressing it up
 * as an error would be wrong about nearly half a real project.
 *
 * Nothing is cached and nothing is written. Object URLs are revoked on
 * unmount and when the identifier changes; a browser that keeps one
 * alive keeps the whole file in memory, and an asset browser walked
 * through a few hundred plates would hold all of them.
 */

import { useEffect, useState } from "react";
import {
  previewCapability, LARGE_FILE_BYTES, TEXT_PREVIEW_LIMIT,
  type PreviewCapability,
} from "@scf-core/preview.ts";
import { parseIdentifier, resolveIdentifier, type Resolution }
  from "@scf-core/assets.ts";
import { assetObjectUrl, makeLocator, readAssetText }
  from "../files/assetLocator.ts";
import { useStore } from "../state/store.ts";

function Unavailable({ cap, state }: {
  cap: PreviewCapability; state: string;
}): JSX.Element {
  return (
    <div className="asset-preview asset-preview-none">
      <p className="muted">
        {state !== "resolved"
          ? "Nothing to show until this resolves."
          : cap.detail}
      </p>
    </div>
  );
}

export function AssetPreview({ identifier }: {
  identifier: string | null;
}): JSX.Element | null {
  const { projectRoot } = useStore();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  // Sticky across assets: someone checking a cycle or a loop-point is
  // usually checking several in a row, and re-ticking it every time
  // would be its own small annoyance. Applies to audio too — a footstep
  // or a room tone is exactly the kind of thing you listen to round.
  const [loop, setLoop] = useState(() =>
    localStorage.getItem("scf:preview-loop") === "1");

  const setLooping = (on: boolean): void => {
    setLoop(on);
    localStorage.setItem("scf:preview-loop", on ? "1" : "0");
  };

  const root = projectRoot as FileSystemDirectoryHandle | null;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setText(null);
    setAsked(false);
    void (async () => {
      const r = await resolveIdentifier(identifier, makeLocator(root));
      if (!cancelled) setResolution(r);
    })();
    return () => { cancelled = true; };
  }, [identifier, root]);

  const cap = previewCapability(resolution?.format ?? null);
  const parsed = identifier === null ? null : parseIdentifier(identifier);
  const big = (resolution?.sizeBytes ?? 0) > LARGE_FILE_BYTES;

  // Load only when it can be shown, and only when a large file has been
  // asked for: opening an asset row should never pull 200MB off disk on
  // its own.
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    void (async () => {
      if (resolution?.state !== "resolved") return;
      if (cap.tier !== "native" || parsed === null) return;
      if (big && !asked) return;

      if (cap.kind === "text") {
        const body = await readAssetText(root, parsed.path,
                                         TEXT_PREVIEW_LIMIT);
        if (!cancelled) setText(body);
        return;
      }
      const objectUrl = await assetObjectUrl(root, parsed.path);
      created = objectUrl;
      if (cancelled) {
        if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
        return;
      }
      setUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [resolution, cap.tier, cap.kind, parsed?.path, root, big, asked]);

  if (identifier === null || resolution === null) return null;

  if (resolution.state !== "resolved" || cap.tier !== "native") {
    return <Unavailable cap={cap} state={resolution.state} />;
  }

  if (big && !asked) {
    return (
      <div className="asset-preview asset-preview-none">
        <p className="muted">
          {Math.round((resolution.sizeBytes ?? 0) / 1024 / 1024)} MB —
          large enough that loading it is worth asking about.
        </p>
        <button className="tiny" onClick={() => setAsked(true)}>
          Load preview
        </button>
      </div>
    );
  }

  if (cap.kind === "text") {
    return (
      <div className="asset-preview">
        {text === null
          ? <p className="muted">Reading…</p>
          : <pre className="asset-preview-text">{text}</pre>}
      </div>
    );
  }

  if (url === null) {
    return (
      <div className="asset-preview asset-preview-none">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="asset-preview">
      {cap.kind === "image" && (
        <img src={url} alt="" className="asset-preview-image" />
      )}
      {cap.kind === "video" && (
        <video src={url} controls loop={loop}
               className="asset-preview-image" />
      )}
      {cap.kind === "audio" && <audio src={url} controls loop={loop} />}
      {(cap.kind === "video" || cap.kind === "audio") && (
        <label className="asset-preview-loop">
          <input type="checkbox" checked={loop}
                 onChange={(e) => setLooping(e.target.checked)} />
          loop
        </label>
      )}
      {cap.kind === "pdf" && (
        <iframe src={url} className="asset-preview-pdf" title="preview" />
      )}
    </div>
  );
}
