// SPDX-License-Identifier: Apache-2.0
/**
 * AnchorScope.tsx — say WHICH PART of a file is the reference.
 *
 * Two small editors on an identity tile ("This is them"):
 *
 *  - RegionEditor: drag a box over the image — the face in a group shot.
 *    Writes `entity_anchor.region_box` ({x, y, w, h} in the image's own
 *    pixels, the shape anchors.ts reads) and `region_label`.
 *  - ClipEditor: mark in and out on a recording — the three seconds of a
 *    take that ARE the voice. Writes `audio_offset_start_sec` and
 *    `audio_offset_end_sec`.
 *
 * Both open the full file through the same refcounted object-URL cache
 * as AssetPreview: nothing is copied, nothing is written beside it
 * (conventions §9). Every save is one undo step (mediaOps).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { parseIdentifier, resolveIdentifier, type Resolution }
  from "@scf-core/assets.ts";
import { LARGE_FILE_BYTES, previewCapability } from "@scf-core/preview.ts";
import type { RegionBox } from "@scf-core/anchors.ts";
import { exec, useStore } from "../../state/store.ts";
import { acquire, release } from "../../files/objectUrlCache.ts";
import { makeLocator } from "../../files/assetLocator.ts";
import {
  ScopeError, setAnchorClip, setAnchorRegion, type Tile,
} from "../../editor/mediaOps.ts";
import type { ChangeUndo } from "../../state/undoChange.ts";

/** "0:02.12" — minutes, seconds, hundredths. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m)}:${s < 10 ? "0" : ""}${s.toFixed(2)}`;
}

/** What the tile's button says about the scope already set. */
export function scopeSummary(tile: Tile, audio: boolean): string | null {
  const s = tile.scope;
  if (s === null) return null;
  if (audio) {
    if (s.clipStart === null && s.clipEnd === null) return null;
    return `${clock(s.clipStart ?? 0)}–${s.clipEnd === null ? "end"
                                                            : clock(s.clipEnd)}`;
  }
  if (s.region !== null) return s.regionLabel ?? "region marked";
  if (s.regionRaw !== null) return "unreadable region";
  return null;
}

/**
 * The file behind an identifier as a URL, or why there isn't one.
 * `big` files are not opened until asked, as in AssetPreview.
 */
function useAssetUrl(identifier: string | null, allowBig: boolean): {
  url: string | null; resolution: Resolution | null; big: boolean;
} {
  const { projectRoot } = useStore();
  const root = projectRoot as FileSystemDirectoryHandle | null;
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const path = identifier === null ? null : parseIdentifier(identifier)?.path ?? null;

  useEffect(() => {
    let cancelled = false;
    setResolution(null);
    void resolveIdentifier(identifier, makeLocator(root)).then((r) => {
      if (!cancelled) setResolution(r);
    });
    return () => { cancelled = true; };
  }, [identifier, root]);

  const big = (resolution?.sizeBytes ?? 0) > LARGE_FILE_BYTES;
  const ok = resolution?.state === "resolved" &&
    previewCapability(resolution.format).tier === "native";

  useEffect(() => {
    let cancelled = false;
    let held: string | null = null;
    setUrl(null);
    if (!ok || path === null || (big && !allowBig)) return;
    held = path;
    void acquire(root, path).then((u) => { if (!cancelled) setUrl(u); });
    return () => {
      cancelled = true;
      if (held !== null) release(root, held);
    };
  }, [ok, path, root, big, allowBig]);

  return { url, resolution, big };
}

function Unreachable({ resolution, big, onLoad }: {
  resolution: Resolution | null; big: boolean; onLoad: () => void;
}): JSX.Element {
  if (resolution === null) return <p className="muted">Finding the file…</p>;
  if (resolution.state !== "resolved") {
    return (
      <p className="muted">
        The file cannot be opened here: {resolution.detail ??
          resolution.state}. {resolution.state === "unaddressed"
          ? "Connect the project folder to mark it." : ""}
      </p>
    );
  }
  if (big) {
    return (
      <p className="muted">
        {Math.round((resolution.sizeBytes ?? 0) / 1024 / 1024)} MB — large
        enough that opening it is worth asking about.{" "}
        <button className="tiny" onClick={onLoad}>Open it</button>
      </p>
    );
  }
  return <p className="muted">This kind of file cannot be shown here.</p>;
}

/** Shared frame: heading, body, actions, error line. */
function ScopePanel({ title, note, children, error, actions, onClose }: {
  title: string; note: string; children: React.ReactNode;
  error: string | null; actions: React.ReactNode; onClose: () => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  // It opens below the tiles; on a full board that is off screen.
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div className="board-dialog scope-panel" role="region" aria-label={title}
         ref={panel}
         onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="scope-head">
        <h4>{title}</h4>
        <button className="ghost tiny" onClick={onClose}>Close</button>
      </div>
      <p className="ws-section-note">{note}</p>
      {children}
      {error !== null && <p className="board-notice" role="alert">{error}</p>}
      <div className="ws-create-actions">{actions}</div>
    </div>
  );
}

const asMessage = (e: unknown): string =>
  e instanceof ScopeError ? e.message
    : `Could not save: ${e instanceof Error ? e.message : String(e)}`;

// ---------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------

export function RegionEditor({ tile, kind, onDone, onClose }: {
  tile: Tile; kind: string;
  onDone: (c: ChangeUndo) => void; onClose: () => void;
}): JSX.Element {
  const identifier = typeof tile.asset["identifier"] === "string"
    ? tile.asset["identifier"] : null;
  const [allowBig, setAllowBig] = useState(false);
  const { url, resolution, big } = useAssetUrl(identifier, allowBig);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState<RegionBox | null>(tile.scope?.region ?? null);
  const [label, setLabel] = useState(tile.scope?.regionLabel ??
                                     (kind === "character" ? "face" : ""));
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const name = String(tile.asset["name"] ?? identifier ?? "the file");

  /** Pointer position in the image's own pixels, clamped to it. */
  const toImage = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = frame.current;
    if (el === null || natural === null) return null;
    const r = el.getBoundingClientRect();
    const sx = natural.width / r.width;
    const sy = natural.height / r.height;
    return {
      x: Math.min(natural.width, Math.max(0, (e.clientX - r.left) * sx)),
      y: Math.min(natural.height, Math.max(0, (e.clientY - r.top) * sy)),
    };
  };
  const span = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)),
    w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)),
  });

  const save = (next: RegionBox | null): void => {
    setError(null);
    setAnchorRegion(exec, tile.link.id, next, label, natural ?? undefined)
      .then((c) => { onDone(c); onClose(); })
      .catch((e: unknown) => setError(asMessage(e)));
  };

  const pct = (v: number, of: number): string => `${String((v / of) * 100)}%`;
  const field = (k: keyof RegionBox, text: string): JSX.Element => (
    <label className="scope-num">
      <span>{text}</span>
      <input type="number" min={0} step={1} value={box?.[k] ?? ""}
             onChange={(e) => {
               const v = Number(e.target.value);
               const base = box ?? { x: 0, y: 0, w: 0, h: 0 };
               setBox({ ...base, [k]: Number.isFinite(v) ? v : 0 });
             }} />
    </label>
  );

  return (
    <ScopePanel
      title={kind === "character" ? `Mark the face in ${name}`
                                  : `Mark the part of ${name} that matters`}
      note={"Drag a box over the image. Thumbnails and tools use that part " +
            "instead of the whole frame. The box is kept in the image's own " +
            "pixels, so it means this file and no other."}
      error={error} onClose={onClose}
      actions={<>
        <button className="primary" disabled={box === null || box.w <= 0 ||
                                              box.h <= 0}
                onClick={() => save(box)}>Save</button>
        {(tile.scope?.region !== null || tile.scope?.regionRaw !== null) && (
          <button onClick={() => save(null)}>Use the whole image</button>
        )}
        <button className="ghost" onClick={onClose}>Cancel</button>
      </>}>
      {tile.scope?.regionRaw !== null && tile.scope?.regionRaw !== undefined && (
        <p className="board-notice">
          The stored region <code>{tile.scope.regionRaw}</code> is not a box
          this editor can read. Saving a new box replaces it.
        </p>
      )}
      {url === null ? (
        <Unreachable resolution={resolution} big={big}
                     onLoad={() => setAllowBig(true)} />
      ) : (
        <div className="scope-stage">
          <div className="scope-frame" ref={frame}
               onPointerDown={(e) => {
                 const p = toImage(e);
                 if (p === null) return;
                 e.currentTarget.setPointerCapture(e.pointerId);
                 drag.current = p;
                 setBox({ x: Math.round(p.x), y: Math.round(p.y), w: 0, h: 0 });
               }}
               onPointerMove={(e) => {
                 const from = drag.current;
                 const p = toImage(e);
                 if (from === null || p === null) return;
                 setBox(span(from, p));
               }}
               onPointerUp={() => { drag.current = null; }}>
            <img src={url} alt={name} draggable={false}
                 onLoad={(e) => setNatural({
                   width: e.currentTarget.naturalWidth,
                   height: e.currentTarget.naturalHeight })} />
            {box !== null && natural !== null && box.w > 0 && box.h > 0 && (
              <div className="scope-box" aria-hidden="true"
                   style={{ left: pct(box.x, natural.width),
                            top: pct(box.y, natural.height),
                            width: pct(box.w, natural.width),
                            height: pct(box.h, natural.height) }}>
                {label.trim() !== "" && <span>{label.trim()}</span>}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="scope-fields">
        {field("x", "Left")}{field("y", "Top")}
        {field("w", "Width")}{field("h", "Height")}
        <label className="scope-num scope-label">
          <span>What it is</span>
          <input value={label} placeholder={kind === "character" ? "face"
                                                                 : "sign, handle…"}
                 onChange={(e) => setLabel(e.target.value)} />
        </label>
        {natural !== null && (
          <span className="muted scope-size">
            image {natural.width}×{natural.height}
          </span>
        )}
      </div>
    </ScopePanel>
  );
}

// ---------------------------------------------------------------------------
// Clip
// ---------------------------------------------------------------------------

/** Peaks for a waveform: max |sample| per column, over all channels. */
async function peaksOf(url: string, columns: number): Promise<{
  peaks: Float32Array; duration: number;
} | null> {
  const Ctx = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (Ctx === undefined) return null;
  const ctx = new Ctx();
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const buf = await ctx.decodeAudioData(data);
    const peaks = new Float32Array(columns);
    const per = Math.max(1, Math.floor(buf.length / columns));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < columns; i++) {
        let m = 0;
        const end = Math.min(ch.length, (i + 1) * per);
        for (let j = i * per; j < end; j++) {
          const v = Math.abs(ch[j] ?? 0);
          if (v > m) m = v;
        }
        if (m > (peaks[i] ?? 0)) peaks[i] = m;
      }
    }
    return { peaks, duration: buf.duration };
  } catch {
    return null;   // Not decodable here: the player still works.
  } finally {
    void ctx.close();
  }
}

const COLUMNS = 640;

export function ClipEditor({ tile, onDone, onClose }: {
  tile: Tile; onDone: (c: ChangeUndo) => void; onClose: () => void;
}): JSX.Element {
  const identifier = typeof tile.asset["identifier"] === "string"
    ? tile.asset["identifier"] : null;
  const [allowBig, setAllowBig] = useState(false);
  const { url, resolution, big } = useAssetUrl(identifier, allowBig);
  const [start, setStart] = useState<number | null>(tile.scope?.clipStart ?? null);
  const [end, setEnd] = useState<number | null>(tile.scope?.clipEnd ?? null);
  const [duration, setDuration] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** Where a drag began, and the range before it — a click that turns
   *  out not to be a drag puts that range back. */
  const drag = useRef<{ t: number; was: [number | null, number | null] } | null>(null);
  /** Stop at the out point when playing the clip, not when scrubbing. */
  const stopAt = useRef<number | null>(null);
  /** The seek playClip makes is not the listener scrubbing. */
  const clipSeek = useRef(false);
  const name = String(tile.asset["name"] ?? identifier ?? "the recording");

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    setDecoding(true);
    void peaksOf(url, COLUMNS).then((r) => {
      if (cancelled) return;
      setDecoding(false);
      if (r !== null) { setPeaks(r.peaks); setDuration(r.duration); }
    });
    return () => { cancelled = true; };
  }, [url]);

  // Draw: waveform, the clip shaded, the playhead.
  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (el === null || el === undefined || g === null || g === undefined) return;
    const w = el.width;
    const h = el.height;
    const css = getComputedStyle(el);
    g.clearRect(0, 0, w, h);
    const d = duration ?? 0;
    if (d > 0 && (start !== null || end !== null)) {
      const a = ((start ?? 0) / d) * w;
      const b = ((end ?? d) / d) * w;
      g.fillStyle = css.getPropertyValue("--scope-sel").trim() || "rgba(106,169,233,0.24)";
      g.fillRect(a, 0, Math.max(1, b - a), h);
    }
    g.fillStyle = css.getPropertyValue("--scope-wave").trim() || "#8a96a8";
    if (peaks !== null) {
      for (let i = 0; i < peaks.length; i++) {
        const v = (peaks[i] ?? 0) * (h / 2 - 2);
        g.fillRect((i / peaks.length) * w, h / 2 - v, Math.max(1, w / peaks.length - 0.5),
                   Math.max(1, v * 2));
      }
    } else {
      g.fillRect(0, h / 2, w, 1);
    }
    if (d > 0) {
      g.fillStyle = css.getPropertyValue("--scope-head").trim() || "#6aa9e9";
      g.fillRect((now / d) * w, 0, 2, h);
    }
  }, [peaks, duration, start, end, now]);

  const timeAt = (e: React.PointerEvent): number | null => {
    const el = canvas.current;
    if (el === null || duration === null || duration <= 0) return null;
    const r = el.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration;
    return Math.min(duration, Math.max(0, Math.round(t * 1000) / 1000));
  };

  const playClip = (): void => {
    const a = audio.current;
    if (a === null) return;
    clipSeek.current = true;
    a.currentTime = start ?? 0;
    stopAt.current = end;
    void a.play();
    // timeupdate fires about four times a second — a quarter-second
    // overrun past the out point. Watch every frame while the clip plays.
    const watch = (): void => {
      const stop = stopAt.current;
      if (stop === null || a.paused) return;
      setNow(a.currentTime);
      if (a.currentTime >= stop) {
        a.pause();
        a.currentTime = stop;
        stopAt.current = null;
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  };

  const save = (s: number | null, e: number | null): void => {
    setError(null);
    setAnchorClip(exec, tile.link.id, s, e, duration ?? undefined)
      .then((c) => { onDone(c); onClose(); })
      .catch((err: unknown) => setError(asMessage(err)));
  };

  const seconds = (value: number | null, set: (v: number | null) => void,
                   text: string): JSX.Element => (
    <label className="scope-num">
      <span>{text}</span>
      <input type="number" min={0} step={0.01}
             value={value === null ? "" : value}
             placeholder={text === "In" ? "start" : "end"}
             onChange={(e) => set(e.target.value === "" ? null
                                                         : Number(e.target.value))} />
    </label>
  );

  const hasClip = tile.scope !== null &&
    (tile.scope.clipStart !== null || tile.scope.clipEnd !== null);
  const lengthText = useMemo(() => {
    if (start === null && end === null) return "the whole recording";
    const a = start ?? 0;
    const b = end ?? duration;
    return b === null ? `from ${clock(a)} to the end`
                      : `${(b - a).toFixed(2)} s, ${clock(a)} to ${clock(b)}`;
  }, [start, end, duration]);

  return (
    <ScopePanel
      title={`Mark the clip in ${name}`}
      note={"Drag across the waveform, or play it and set in and out where " +
            "you hear it. Leave an end empty to run from the start or to " +
            "the end of the file."}
      error={error} onClose={onClose}
      actions={<>
        <button className="primary" onClick={() => save(start, end)}>Save</button>
        {hasClip && (
          <button onClick={() => save(null, null)}>Use the whole recording</button>
        )}
        <button className="ghost" onClick={onClose}>Cancel</button>
      </>}>
      {url === null ? (
        <Unreachable resolution={resolution} big={big}
                     onLoad={() => setAllowBig(true)} />
      ) : (
        <div className="scope-audio">
          <canvas ref={canvas} width={COLUMNS} height={84}
                  className="scope-wave"
                  aria-label={`Waveform of ${name}; drag to choose the clip`}
                  role="img"
                  onPointerDown={(e) => {
                    const t = timeAt(e);
                    if (t === null) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { t, was: [start, end] };
                    setStart(t); setEnd(null);
                  }}
                  onPointerMove={(e) => {
                    const from = drag.current?.t ?? null;
                    const t = timeAt(e);
                    if (from === null || t === null) return;
                    setStart(Math.min(from, t));
                    setEnd(Math.max(from, t));
                  }}
                  onPointerUp={(e) => {
                    const from = drag.current;
                    drag.current = null;
                    const t = timeAt(e);
                    // A click without a drag moves the playhead instead.
                    if (from !== null && t !== null && Math.abs(t - from.t) < 0.02) {
                      setStart(from.was[0]);
                      setEnd(from.was[1]);
                      if (audio.current !== null) audio.current.currentTime = t;
                      setNow(t);
                    }
                  }} />
          {decoding && <p className="muted">Reading the waveform…</p>}
          {!decoding && peaks === null && (
            <p className="muted">
              No waveform for this file here; the player and the times below
              still work.
            </p>
          )}
          <audio ref={audio} src={url} controls preload="metadata"
                 onLoadedMetadata={(e) => {
                   if (duration === null && Number.isFinite(e.currentTarget.duration)) {
                     setDuration(e.currentTarget.duration);
                   }
                 }}
                 onTimeUpdate={(e) => {
                   const t = e.currentTarget.currentTime;
                   setNow(t);
                   if (stopAt.current !== null && t >= stopAt.current) {
                     e.currentTarget.pause();
                     stopAt.current = null;
                   }
                 }}
                 onSeeking={() => {
                   if (clipSeek.current) clipSeek.current = false;
                   else stopAt.current = null;
                 }} />
          <div className="scope-fields">
            <button className="tiny" onClick={playClip}>▶ Play the clip</button>
            <button className="tiny" onClick={() => setStart(
              Math.round((audio.current?.currentTime ?? 0) * 1000) / 1000)}>
              Set in at {clock(now)}
            </button>
            <button className="tiny" onClick={() => setEnd(
              Math.round((audio.current?.currentTime ?? 0) * 1000) / 1000)}>
              Set out at {clock(now)}
            </button>
          </div>
        </div>
      )}
      <div className="scope-fields">
        {seconds(start, setStart, "In")}
        {seconds(end, setEnd, "Out")}
        <span className="muted scope-size">
          {lengthText}{duration !== null ? ` · file ${clock(duration)}` : ""}
        </span>
      </div>
    </ScopePanel>
  );
}
