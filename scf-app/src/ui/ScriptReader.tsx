// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { sceneLabel } from "../state/displayName.ts";
import { useQuery } from "./useQuery.ts";

/**
 * ScriptReader — the screenplay as committed, read-only, beside the
 * Structure and Shoot surfaces.
 *
 * Both tabs are planned AGAINST the script: a boundary is placed at a
 * scene because of what happens in it, a shot is written against the
 * action. Reading meant switching tabs and losing your place in the
 * other one; this pane scrolls on its own and never writes.
 *
 * It reads `screenplay_lines`, so it shows the last commit — lines typed
 * in the Script tab since then appear once they are committed, the same
 * as everywhere else that reads the script.
 */

/** Ask the reader to bring a scene's heading into view. */
export function revealSceneInReader(sceneId: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(REVEAL_EVENT, { detail: sceneId }));
}

const REVEAL_EVENT = "scf:reader-reveal-scene";

/** Not script: title-page lines live in their own table anyway, and
 *  struck text and page breaks are layout the reader does not need.
 *  Blank lines are dropped too — a file may or may not carry them, so
 *  spacing comes from the line types (as the editor's does) rather than
 *  doubling up wherever they happen to be stored. */
const HIDDEN = new Set(["title_page", "boneyard", "page_break", "blank"]);

export function ScriptReader({ onHide }: {
  onHide?: () => void;
}): JSX.Element {
  const lines = useQuery(
    "SELECT id, line_type, content, scene_id FROM screenplay_lines " +
    "ORDER BY line_order");
  const scenes = useQuery("SELECT id, scene_number, name FROM scene");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const sceneById = useMemo(
    () => new Map(scenes.map((s) => [Number(s["id"]), s])), [scenes]);
  // Headings in script order — the reader's own table of contents.
  const headings = useMemo(
    () => lines.filter((l) => l["line_type"] === "heading" &&
                              l["scene_id"] !== null),
    [lines]);

  const reveal = (sceneId: number): void => {
    const el = bodyRef.current?.querySelector<HTMLElement>(
      `[data-scene-heading="${String(sceneId)}"]`);
    if (el === null || el === undefined) return;
    // Instant, not smooth: the flash says where it landed, and a smooth
    // scroll is dropped outright by a window that is not painting.
    el.scrollIntoView({ block: "start" });
    setFlash(sceneId);
  };

  useEffect(() => {
    const on = (e: Event): void =>
      reveal((e as CustomEvent<number>).detail);
    window.addEventListener(REVEAL_EVENT, on);
    return () => window.removeEventListener(REVEAL_EVENT, on);
  });

  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [flash]);

  return (
    <div className="script-reader">
      <div className="script-reader-head">
        <span className="script-reader-title">Script</span>
        <span className="muted script-reader-ro">read-only</span>
        {headings.length > 0 && (
          <select className="script-reader-jump" value=""
                  onChange={(e) => {
                    if (e.target.value !== "") reveal(Number(e.target.value));
                  }}>
            <option value="">jump to scene…</option>
            {headings.map((h) => {
              const id = Number(h["scene_id"]);
              return (
                <option key={String(h["id"])} value={id}>
                  {sceneLabel(sceneById.get(id))}
                </option>
              );
            })}
          </select>
        )}
        {onHide !== undefined && (
          <button className="ghost tiny" title="Hide the script"
                  onClick={onHide}>◂</button>
        )}
      </div>
      <div className="script-reader-body" ref={bodyRef}>
        {lines.length === 0
          ? <p className="script-reader-empty">
              No committed script yet. Write or import one in the Script
              tab and commit it.
            </p>
          : <div className="script-reader-page">
              {lines.map((l) => lineNode(l, sceneById, flash))}
            </div>}
      </div>
    </div>
  );
}

function lineNode(l: Row, sceneById: Map<number, Row>,
                  flash: number | null): JSX.Element | null {
  const type = String(l["line_type"]);
  if (HIDDEN.has(type)) return null;
  const key = String(l["id"]);
  if (type === "heading" && l["scene_id"] !== null) {
    const sceneId = Number(l["scene_id"]);
    const num = sceneById.get(sceneId)?.["scene_number"];
    return (
      <p key={key} data-scene-heading={sceneId}
         className={"sr sr-heading" +
                    (flash === sceneId ? " sr-flash" : "")}>
        {num !== null && num !== undefined && num !== "" && (
          <span className="sr-sceneno">{String(num)}</span>
        )}
        {String(l["content"] ?? "")}
      </p>
    );
  }
  return (
    <p key={key} className={`sr sr-${type}`}>
      {String(l["content"] ?? "")}
    </p>
  );
}
