// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Row } from "@scf-core/db.ts";
import { SCENE_ORDER_BY, SCENE_ORDER_JOIN } from "@scf-core/structure.ts";
import { useQuery } from "./useQuery.ts";
import { ShotFrame, useShotFrames } from "./ShotFrame.tsx";
import { useRememberedOptions } from "./useRememberedOptions.ts";
import { sceneLabel } from "../state/displayName.ts";
import { beatBanner } from "../state/shotlist.ts";
import {
  ASPECT_CHOICES, BOARD_TABS, boardAspect, buildBoard, step,
  withBoardDefaults, type BoardFrame, type BoardScene, type StoryboardOptions,
} from "../state/storyboard.ts";

const OPTIONS_KEY = "scf:storyboard-options";

/** Frame widths, in CSS pixels, for S / M / L. */
const FRAME_PX = { s: 200, m: 300, l: 440 } as const;

const text = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).trim();

/** "Scene 3 — INT. FARMHOUSE KITCHEN - DAY" */
const sceneTitle = (scene: Row): string =>
  sceneLabel(scene).replace(/^sc /, "Scene ");

/**
 * StoryboardView — the shots as pictures, in the order they cut.
 *
 * Read-only. Each shot is shown by its first storyboard panel, else its
 * start frame (the same choice the shot list makes); the order is the
 * shot list's. Two ways to look at it:
 *
 *  - Board: a wall of frames, scenes as rows or as columns, with as
 *    much or as little written on each frame as the room needs.
 *  - Lightbox: a contact sheet, and a viewer that dims the app and
 *    steps through the frames large with the arrow keys.
 *
 * Any frame on either opens the viewer there.
 */
export function StoryboardView(): JSX.Element {
  const [opts, setOpts] = useRememberedOptions(OPTIONS_KEY, withBoardDefaults);
  const [viewing, setViewing] = useState<number | null>(null);

  const scenes = useQuery(
    "SELECT s.id, s.scene_number, s.name " +
    `FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`);
  const beats = useQuery(
    "SELECT id, name, scene_id, beat_order, description FROM story_beat");
  const shots = useQuery(
    "SELECT id, name, scene_id, story_beat_id, shot_number, shot_order, " +
    "description, lifecycle_status FROM shot");
  const specs = useQuery("SELECT aspect_ratio FROM technical_specs LIMIT 1");
  const frameOf = useShotFrames();

  const projectRatio = text(specs[0]?.["aspect_ratio"]) || null;
  const aspect = boardAspect(opts.aspect, projectRatio);
  const board = useMemo(
    () => buildBoard(scenes, beats, shots, frameOf, opts),
    [scenes, beats, shots, frameOf, opts]);

  const scenesWithShots = useMemo(() => {
    const has = new Set(shots.map((s) => Number(s["scene_id"])));
    return scenes.filter((s) => has.has(Number(s["id"])));
  }, [scenes, shots]);
  const scopeValid = opts.scope === "all" ||
    scenes.some((s) => String(s["id"]) === opts.scope);
  useEffect(() => {
    if (!scopeValid && scenes.length > 0) setOpts({ scope: "all" });
  }, [scopeValid, scenes.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const boarded = board.frames.filter((f) => f.identifier !== null).length;

  return (
    <div className="storyboard">
      <div className="ws-tabs" role="tablist" aria-label="Storyboard views">
        {BOARD_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === opts.tab}
                  className={t === opts.tab ? "active" : ""}
                  onClick={() => setOpts({ tab: t })}>
            {t}
          </button>
        ))}
      </div>

      <BoardControls opts={opts} setOpts={setOpts} scenes={scenesWithShots}
                     projectRatio={projectRatio}
                     canPresent={board.frames.length > 0}
                     onPresent={() => setViewing(0)} />

      {board.frames.length === 0 ? (
        <p className="muted sb-empty">
          {shots.length === 0
            ? "No shots yet. Shots are planned in Shoot; once a scene has " +
              "some, they appear here."
            : "No storyboard frames yet. Add storyboard panels or start " +
              "frames to shots from their media strip in Shoot, or turn " +
              "on “Unboarded shots” to see every shot's place."}
        </p>
      ) : (
        <>
          <p className="sb-summary muted">
            {board.frames.length} shot{board.frames.length === 1 ? "" : "s"}
            {" · "}{boarded} with a frame
            {opts.aspect === "project" && projectRatio !== null &&
              ` · ${projectRatio}`}
          </p>
          {opts.tab === "Board"
            ? <Board scenes={board.scenes} opts={opts} aspect={aspect}
                     onOpen={setViewing} />
            : <ContactSheet scenes={board.scenes} aspect={aspect}
                            sceneHeads={opts.sceneHeads}
                            onOpen={setViewing} />}
        </>
      )}

      {viewing !== null && board.frames.length > 0 && (
        <Lightbox frames={board.frames}
                  index={Math.min(viewing, board.frames.length - 1)}
                  aspect={aspect}
                  onIndex={setViewing}
                  onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function BoardControls({ opts, setOpts, scenes, projectRatio, canPresent,
                         onPresent }: {
  opts: StoryboardOptions;
  setOpts: (p: Partial<StoryboardOptions>) => void;
  scenes: Row[];
  projectRatio: string | null;
  canPresent: boolean;
  onPresent: () => void;
}): JSX.Element {
  const check = (label: string, value: boolean,
                 on: (v: boolean) => void, title?: string): JSX.Element => (
    <label className="sl-check" title={title}>
      <input type="checkbox" checked={value}
             onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
  const onBoard = opts.tab === "Board";
  return (
    <div className="sl-controls sb-controls">
      <div className="sl-controls-row">
        <label className="sl-field">
          <span>Scenes</span>
          <select value={opts.scope}
                  onChange={(e) => setOpts({ scope: e.target.value })}>
            <option value="all">All scenes with shots</option>
            {scenes.map((s) => (
              <option key={String(s["id"])} value={String(s["id"])}>
                {sceneLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="sl-field">
          <span>Frame</span>
          <select value={opts.aspect}
                  onChange={(e) => setOpts({ aspect: e.target.value })}>
            <option value="project">
              Project{projectRatio === null ? " (16:9)" : ` (${projectRatio})`}
            </option>
            {ASPECT_CHOICES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button className="primary sl-print" disabled={!canPresent}
                onClick={onPresent}
                title="Step through the frames large. Arrow keys move, Esc closes.">
          ▶ Present
        </button>
      </div>
      {onBoard && (
        <div className="sl-controls-row">
          <span className="sl-controls-label">Layout</span>
          <div className="sb-seg" role="group" aria-label="Layout">
            {(["rows", "columns"] as const).map((l) => (
              <button key={l} aria-pressed={opts.layout === l}
                      className={opts.layout === l ? "on" : ""}
                      onClick={() => setOpts({ layout: l })}>
                {l === "rows" ? "Rows" : "Columns"}
              </button>
            ))}
          </div>
          <div className="sb-seg" role="group" aria-label="Frame size">
            {(["s", "m", "l"] as const).map((z) => (
              <button key={z} aria-pressed={opts.size === z}
                      className={opts.size === z ? "on" : ""}
                      onClick={() => setOpts({ size: z })}>
                {z.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="sb-seg" role="group" aria-label="Captions">
            {(["below", "overlay"] as const).map((c) => (
              <button key={c} aria-pressed={opts.captions === c}
                      className={opts.captions === c ? "on" : ""}
                      onClick={() => setOpts({ captions: c })}>
                {c === "below" ? "Text below" : "Text on image"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sl-controls-row">
        <span className="sl-controls-label">Show</span>
        {onBoard && check("Shot number", opts.showNumber,
                          (v) => setOpts({ showNumber: v }))}
        {onBoard && check("Shot name", opts.showName,
                          (v) => setOpts({ showName: v }))}
        {onBoard && check("Description", opts.showDescription,
                          (v) => setOpts({ showDescription: v }))}
        {check("Scene headings", opts.sceneHeads,
               (v) => setOpts({ sceneHeads: v }))}
        {onBoard && check("Beats", opts.groupByBeat,
                          (v) => setOpts({ groupByBeat: v }))}
        {check("Unboarded shots", opts.showUnboarded,
               (v) => setOpts({ showUnboarded: v }),
               "Shots with no storyboard panel or start frame keep their place")}
        {check("Cut shots", opts.includeCut,
               (v) => setOpts({ includeCut: v }))}
      </div>
    </div>
  );
}

/** The words on a frame, as the options ask for them. */
function Caption({ frame, opts }: {
  frame: BoardFrame; opts: StoryboardOptions;
}): JSX.Element | null {
  const number = text(frame.shot["shot_number"]);
  const name = text(frame.shot["name"]);
  const desc = text(frame.shot["description"]);
  // The name often opens the description; printing both says it twice.
  const showName = opts.showName && name !== "" &&
    !(opts.showDescription && desc.startsWith(name));
  const lines = [
    showName ? <strong key="n" className="sb-cap-name">{name}</strong> : null,
    opts.showDescription && desc !== ""
      ? <span key="d" className="sb-cap-desc">{desc}</span> : null,
  ].filter((x) => x !== null);
  if (!opts.showNumber && lines.length === 0) return null;
  return (
    <div className={`sb-cap sb-cap-${opts.captions}`}>
      {opts.showNumber && number !== "" && (
        <span className="sb-cap-number">{number}</span>
      )}
      {lines.length > 0 && <div className="sb-cap-text">{lines}</div>}
    </div>
  );
}

function BoardTile({ frame, opts, aspect, onOpen }: {
  frame: BoardFrame; opts: StoryboardOptions; aspect: number;
  onOpen: (i: number) => void;
}): JSX.Element {
  const cut = frame.shot["lifecycle_status"] === "cut";
  return (
    <figure className={"sb-tile" + (cut ? " sb-tile-cut" : "")}>
      <button className="sb-tile-pic" onClick={() => onOpen(frame.index)}
              title="Open large (arrow keys step, Esc closes)">
        <ShotFrame identifier={frame.identifier} aspect={aspect}
                   alt={text(frame.shot["shot_number"])}
                   placeholder={text(frame.shot["shot_number"]) || "—"} />
        {opts.captions === "overlay" && <Caption frame={frame} opts={opts} />}
        {cut && <span className="sb-cut">cut</span>}
      </button>
      {opts.captions === "below" && (
        <figcaption><Caption frame={frame} opts={opts} /></figcaption>
      )}
    </figure>
  );
}

function Board({ scenes, opts, aspect, onOpen }: {
  scenes: BoardScene[]; opts: StoryboardOptions; aspect: number;
  onOpen: (i: number) => void;
}): JSX.Element {
  const width = FRAME_PX[opts.size];
  return (
    <div className={`sb-board sb-${opts.layout}`}
         style={{ ["--sb-w" as string]: `${String(width)}px` }}>
      {scenes.map((s) => (
        <section key={String(s.scene["id"])} className="sb-scene">
          {opts.sceneHeads && (
            <h2 className="sb-scene-head" title={sceneTitle(s.scene)}>
              {sceneTitle(s.scene)}
            </h2>
          )}
          {s.groups.map((g, gi) => {
            const banner = beatBanner({ beat: g.beat, letter: g.letter,
                                        shots: [] });
            return (
              <div key={gi} className="sb-group">
                {banner !== null && <h3 className="sb-beat">{banner}</h3>}
                <div className="sb-frames">
                  {g.frames.map((f) => (
                    <BoardTile key={String(f.shot["id"])} frame={f}
                               opts={opts} aspect={aspect} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Small frames, numbers only: the way into the viewer. */
function ContactSheet({ scenes, aspect, sceneHeads, onOpen }: {
  scenes: BoardScene[]; aspect: number; sceneHeads: boolean;
  onOpen: (i: number) => void;
}): JSX.Element {
  return (
    <div className="sb-contact">
      {scenes.map((s) => (
        <section key={String(s.scene["id"])}>
          {sceneHeads && <h2 className="sb-scene-head">{sceneTitle(s.scene)}</h2>}
          <div className="sb-contact-grid">
            {s.groups.flatMap((g) => g.frames).map((f) => (
              <button key={String(f.shot["id"])} className="sb-contact-cell"
                      onClick={() => onOpen(f.index)}
                      title={text(f.shot["description"]) ||
                             text(f.shot["name"])}>
                <ShotFrame identifier={f.identifier} aspect={aspect}
                           alt={text(f.shot["shot_number"])}
                           placeholder={text(f.shot["shot_number"]) || "—"} />
                <span>{text(f.shot["shot_number"])}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The viewer: the app dimmed behind one frame, large.
 *
 * ← → (and PageUp/PageDown, Space) step, Home and End jump, F goes
 * full screen, Esc or a click outside the frame closes. It stops at the
 * ends rather than wrapping. The frames either side are mounted out of
 * sight so the next step is already loaded.
 */
function Lightbox({ frames, index, aspect, onIndex, onClose }: {
  frames: BoardFrame[]; index: number; aspect: number;
  onIndex: (i: number) => void; onClose: () => void;
}): JSX.Element {
  const frame = frames[index]!;
  const count = frames.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const go = (i: number): void => { e.preventDefault(); onIndex(i); };
      switch (e.key) {
        case "ArrowRight": case "ArrowDown": case "PageDown": case " ":
          go(step(index, 1, count)); break;
        case "ArrowLeft": case "ArrowUp": case "PageUp":
          go(step(index, -1, count)); break;
        case "Home": go(0); break;
        case "End": go(count - 1); break;
        case "Escape":
          // In full screen the browser takes the first Esc to leave it.
          if (document.fullscreenElement === null) { e.preventDefault(); onClose(); }
          break;
        case "f": case "F":
          e.preventDefault();
          if (document.fullscreenElement === null) {
            void document.documentElement.requestFullscreen?.().catch(() => {});
          } else {
            void document.exitFullscreen();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onIndex, onClose]);

  // Leaving the viewer leaves full screen with it.
  useEffect(() => () => {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
  }, []);

  const number = text(frame.shot["shot_number"]);
  const name = text(frame.shot["name"]);
  const desc = text(frame.shot["description"]);
  const banner = frame.beat === null ? null
    : beatBanner({ beat: frame.beat, letter: frame.beatLetter, shots: [] });
  const neighbours = [frames[index - 1], frames[index + 1]]
    .filter((f): f is BoardFrame => f !== undefined);

  return createPortal(
    <div className="sb-lightbox" role="dialog" aria-modal="true"
         aria-label={`Shot ${number}, ${String(index + 1)} of ${String(count)}`}
         style={{ ["--sb-ar" as string]: String(aspect) }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sb-lb-top">
        <span className="sb-lb-scene">{sceneTitle(frame.scene)}</span>
        <span className="sb-lb-count">{index + 1} / {count}</span>
        <button className="ghost" onClick={onClose} aria-label="Close"
                title="Close (Esc)">×</button>
      </div>
      <button className="sb-lb-nav sb-lb-prev" aria-label="Previous frame"
              disabled={index === 0} onClick={() => onIndex(step(index, -1, count))}>
        ‹
      </button>
      <div className="sb-lb-stage"
           onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <ShotFrame key={String(frame.shot["id"])} className="sb-lb-frame"
                   identifier={frame.identifier} aspect={aspect} fit="contain"
                   alt={number} placeholder={`${number} — no frame yet`} />
      </div>
      <button className="sb-lb-nav sb-lb-next" aria-label="Next frame"
              disabled={index === count - 1}
              onClick={() => onIndex(step(index, 1, count))}>
        ›
      </button>
      <div className="sb-lb-caption">
        {banner !== null && <div className="sb-lb-beat">{banner}</div>}
        <div>
          <span className="sb-lb-number">{number}</span>
          {name !== "" && !desc.startsWith(name) &&
            <strong className="sb-lb-name">{name}</strong>}
        </div>
        {desc !== "" && <p>{desc}</p>}
        <p className="sb-lb-keys">← → step · F full screen · Esc close</p>
      </div>
      <div className="sb-lb-preload" aria-hidden="true">
        {neighbours.map((f) => (
          <ShotFrame key={String(f.shot["id"])} identifier={f.identifier}
                     alt="" />
        ))}
      </div>
    </div>,
    document.body);
}
