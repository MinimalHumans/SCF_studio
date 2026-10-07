// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { Row } from "@scf-core/db.ts";
import {
  actOutline, deriveStructure, sceneOrderHint,
} from "@scf-core/structure.ts";
import { shotCode } from "@scf-core/shots.ts";
import {
  addBeat, addShot, moveShot, removeBeat, removeShot, SCENE_SCRIPT_SQL,
  summarize, updateField,
} from "../editor/shootOps.ts";
import { sceneLabel } from "../state/displayName.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";
import { revealSceneInReader } from "./ScriptReader.tsx";

/**
 * ShootView — the shooting surface.
 *
 * The split that makes this worth a separate tab: the script tab owns
 * the narrative document, this one owns coverage. So scenes here are
 * READ-ONLY — they cannot be created, renamed, or reordered — while
 * beats and shots are authored here and nowhere else. One truth for the
 * spine, one place to plan against it.
 *
 * Acts, sequences and scene order are derived from the boundaries (see
 * scf-core/src/structure.ts); nothing in this file writes to them.
 */
export function ShootView(): JSX.Element {
  const { openEntityRow, revision } = useStore();
  const { open, showEmpty } = useStore((s) => s.shootView);
  const setShootView = useStore((s) => s.setShootView);
  const setOpen = (next: Set<string>): void => setShootView({ open: next });
  const setShowEmpty = (v: boolean): void =>
    setShootView({ showEmpty: v });
  const rootRef = useRef<HTMLDivElement>(null);
  useRestoredScroll(rootRef);

  const scenes = useQuery("SELECT id, scene_number, name FROM scene");
  const headings = useQuery(
    "SELECT scene_id, line_order FROM screenplay_lines " +
    "WHERE line_type = 'heading' ORDER BY line_order");
  const acts = useQuery(
    "SELECT id, name, act_number, start_scene_id FROM act");
  const sequences = useQuery(
    "SELECT id, name, sequence_number, start_scene_id FROM sequence");
  const beats = useQuery(
    "SELECT id, name, scene_id, beat_order, beat_type, description " +
    "FROM story_beat ORDER BY beat_order, id");
  const shots = useQuery(
    "SELECT id, name, scene_id, story_beat_id, shot_number, shot_order, " +
    "shot_size, camera_angle FROM shot ORDER BY shot_order, id");

  const structure = useMemo(
    () => deriveStructure(scenes, acts, sequences,
                          sceneOrderHint(headings)),
    [scenes, acts, sequences, headings]);
  const sceneById = useMemo(
    () => new Map(scenes.map((s) => [Number(s["id"]), s])), [scenes]);
  const beatsByScene = useMemo(() => groupBy(beats, "scene_id"), [beats]);
  const shotsByScene = useMemo(() => groupBy(shots, "scene_id"), [shots]);

  const bump = (): void => {
    useStore.setState((s) => ({ revision: s.revision + 1 }));
  };
  const toggle = (key: string): void => {
    const next = new Set(useStore.getState().shootView.open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  const run = async (op: Promise<void>): Promise<void> => {
    await op;
    bump();
  };

  if (scenes.length === 0) {
    return (
      // The ref here too: this is also the first render, before the
      // queries return, and the scroll hook finds the panel through it.
      <div className="shoot" ref={rootRef}>
        <p className="muted">
          No scenes yet. Coverage is planned against the script, so
          import or write one first.
        </p>
      </div>
    );
  }

  const sceneNode = (sceneId: number): JSX.Element | null => {
    const scene = sceneById.get(sceneId);
    const sceneShots = shotsByScene.get(sceneId) ?? [];
    const sceneBeats = beatsByScene.get(sceneId) ?? [];
    // A scene with beats and no shots is planned, not untouched — it
    // is exactly the scene you broke down and have yet to cover, so
    // hiding it is the opposite of useful.
    if (!showEmpty && sceneShots.length === 0 &&
        sceneBeats.length === 0) return null;
    const key = `scene:${String(sceneId)}`;
    const expanded = open.has(key);
    const loose = sceneShots.filter((r) => r["story_beat_id"] === null);

    return (
      <div key={key} className="shoot-scene">
        <div className="shoot-row shoot-row-scene">
          <button className="shoot-caret" onClick={() => toggle(key)}
                  aria-expanded={expanded}>
            {expanded ? "▾" : "▸"}
          </button>
          <button className="row-link shoot-label"
                  title="Show this scene in the script"
                  onClick={() => revealSceneInReader(sceneId)}>
            {sceneLabel(scene)}
          </button>
          <span className="shoot-count">
            {summarize(sceneBeats.length, sceneShots.length)}
          </span>
          <button className="ghost tiny"
                  onClick={() => void run(addBeat(exec, sceneId))}>+ beat</button>
          <button className="ghost tiny"
                  onClick={() => void run(addShot(exec, sceneId, null))}>
            + shot
          </button>
        </div>
        {expanded && (
          <div className="shoot-scene-body">
            <SceneText sceneId={sceneId} />
            {sceneBeats.map((beat) => {
              const beatId = Number(beat["id"]);
              const inBeat = sceneShots.filter(
                (r) => Number(r["story_beat_id"]) === beatId);
              return (
                <div key={beatId} className="shoot-beat">
                  <div className="shoot-row shoot-row-beat">
                    <span className="shoot-kind">beat</span>
                    <input className="shoot-input shoot-beat-name"
                           defaultValue={String(beat["name"] ?? "")}
                           onBlur={(e) => void run(updateField(
                             exec, "story_beat", beatId, "name",
                             e.target.value))} />
                    <input className="shoot-input shoot-beat-desc"
                           placeholder="what happens"
                           defaultValue={String(beat["description"] ?? "")}
                           onBlur={(e) => void run(updateField(
                             exec, "story_beat", beatId, "description",
                             e.target.value))} />
                    <button className="ghost tiny"
                            onClick={() => void run(addShot(exec, sceneId, beatId))}>
                      + shot
                    </button>
                    <button className="ghost tiny"
                            title="Open the full beat record"
                            onClick={() => void openEntityRow(
                              "story_beat", beatId)}>⋯</button>
                    <button className="ghost tiny"
                            title="Delete the beat; its shots stay on the scene"
                            onClick={() => void run(removeBeat(exec, beatId))}>
                      ×
                    </button>
                  </div>
                  {inBeat.map((shot) => shotRow(shot, sceneShots, scene))}
                </div>
              );
            })}
            {/* Named only beside beats: with none, every shot is on the
                scene and a label would say nothing. */}
            {loose.length > 0 && sceneBeats.length > 0 && (
              <div className="shoot-loose-head">on the scene, no beat</div>
            )}
            {loose.map((shot) => shotRow(shot, sceneShots, scene))}
            {sceneShots.length === 0 && sceneBeats.length === 0 && (
              <p className="muted shoot-empty">
                Nothing planned. Shots can sit straight on the scene —
                beats are optional.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  function shotRow(shot: Row, sceneShots: Row[],
                   scene: Row | undefined): JSX.Element {
    const id = Number(shot["id"]);
    const authored = String(shot["shot_number"] ?? "");
    const derived = shotCode(
      (scene?.["scene_number"] ?? null) as string | number | null,
      sceneShots.findIndex((r) => Number(r["id"]) === id));
    return (
      <div key={id} className="shoot-row shoot-row-shot">
        <input className="shoot-input shoot-number"
               defaultValue={authored}
               onBlur={(e) => void run(updateField(
                 exec, "shot", id, "shot_number", e.target.value))} />
        {authored !== "" && authored !== derived && (
          <span className="shoot-drift"
                title={"A shot number is an identifier issued to a crew, " +
                       "so it is never rewritten automatically. By " +
                       "position this shot would be " + derived + "."}>
            ≠ {derived}
          </span>
        )}
        <input className="shoot-input shoot-shot-name"
               placeholder="description"
               defaultValue={String(shot["name"] ?? "")}
               onBlur={(e) => void run(updateField(exec, "shot", id, "name", e.target.value))} />
        <FieldSelect field="shot_size" value={shot["shot_size"]}
                     onPick={(v) => void run(updateField(exec, "shot", id, "shot_size", v))} />
        <FieldSelect field="camera_angle" value={shot["camera_angle"]}
                     onPick={(v) =>
                       void run(updateField(exec, "shot", id, "camera_angle", v))} />
        <button className="ghost tiny" title="Move up"
                onClick={() => void run(moveShot(exec, id, sceneShots, -1))}>▲</button>
        <button className="ghost tiny" title="Move down"
                onClick={() => void run(moveShot(exec, id, sceneShots, 1))}>▼</button>
        <button className="ghost tiny" title="Open the full shot record"
                onClick={() => void openEntityRow("shot", id)}>⋯</button>
        <button className="ghost tiny"
                onClick={() => void run(removeShot(exec, id))}>×</button>
      </div>
    );
  }

  const placed = new Set<number>();
  // By scene rather than by size: the set also holds `script:` keys.
  const allOpen = structure.scenes.length > 0 &&
    structure.scenes.every((sc) => open.has(`scene:${String(sc.id)}`));
  return (
    <div className="shoot" data-revision={revision} ref={rootRef}>
      <div className="shoot-head">
        <h2>Shoot</h2>
        <span className="muted">
          {shots.length} shot{shots.length === 1 ? "" : "s"} across{" "}
          {shotsByScene.size} scene{shotsByScene.size === 1 ? "" : "s"}
        </span>
        <button className="ghost tiny"
                onClick={() => {
                  // Expanding all is the useful direction — collapse is
                  // just "clear", since a scene is closed by default.
                  const keys = structure.scenes.map(
                    (sc) => `scene:${String(sc.id)}`);
                  setOpen(allOpen ? new Set() : new Set(keys));
                }}>
          {allOpen
            ? "collapse all" : "expand all"}
        </button>
        <label className="shoot-toggle">
          <input type="checkbox" checked={showEmpty}
                 onChange={(e) => setShowEmpty(e.target.checked)} />
          untouched scenes
        </label>
      </div>

      {structure.acts.map((act) => {
        act.sceneIds.forEach((id) => placed.add(id));
        return (
          <div key={act.id} className="shoot-act">
            <div className="shoot-row shoot-row-act">
              <span className="shoot-kind">act</span>
              <span className="shoot-label">{act.name}</span>
            </div>
            {/* Runs, not "sequences starting here": a sequence may cross
                an act boundary, and grouping by start drew its later
                scenes under the wrong act as well as the right one. */}
            {actOutline(structure, act).map((group, i) => (
              group.sequence === null
                ? <div key={`bare:${String(i)}`}>
                    {group.sceneIds.map(sceneNode)}
                  </div>
                : <div key={group.sequence.id} className="shoot-seq">
                    <div className="shoot-row shoot-row-seq">
                      <span className="shoot-kind">sequence</span>
                      <span className="shoot-label">
                        {group.sequence.name}
                      </span>
                      {(group.continuesFrom || group.continuesInto) && (
                        <span className="shoot-count">
                          {group.continuesFrom
                            ? "continued from the previous act"
                            : "continues into the next act"}
                        </span>
                      )}
                    </div>
                    {group.sceneIds.map(sceneNode)}
                  </div>
            ))}
          </div>
        );
      })}

      {/* Scenes outside every act still need covering. */}
      {structure.scenes.filter((s) => !placed.has(s.id)).length > 0 && (
        <div className="shoot-act">
          <div className="shoot-row shoot-row-act">
            <span className="shoot-kind">unplaced</span>
            <span className="shoot-label">Outside any act</span>
          </div>
          {structure.scenes.filter((s) => !placed.has(s.id))
            .map((s) => sceneNode(s.id))}
        </div>
      )}
    </div>
  );
}

/**
 * The scene as written, read-only, inside the scene it belongs to.
 * Shot descriptions are written against the action, and switching tabs
 * to read it is how detail gets lost between the two.
 */
function SceneText({ sceneId }: { sceneId: number }): JSX.Element | null {
  const key = `script:${String(sceneId)}`;
  const open = useStore((s) => s.shootView.open.has(key));
  const setOpen = (v: boolean): void => {
    const next = new Set(useStore.getState().shootView.open);
    if (v) next.add(key);
    else next.delete(key);
    useStore.getState().setShootView({ open: next });
  };
  const lines = useQuery(open ? SCENE_SCRIPT_SQL : null,
                         [sceneId, sceneId, sceneId]);
  return (
    <div className="shoot-script">
      <button className="ghost tiny" onClick={() => setOpen(!open)}>
        {open ? "hide script" : "read scene"}
      </button>
      {open && (
        lines.length === 0
          ? <p className="muted shoot-empty">
              This scene's heading isn't linked to any script line —
              commit the script and it will appear here.
            </p>
          : <div className="shoot-script-body">
              {lines.map((l, i) => (
                <p key={i}
                   className={`sl sl-${String(l["line_type"])}`}>
                  {String(l["content"] ?? "")}
                </p>
              ))}
            </div>
      )}
    </div>
  );
}

/**
 * Keep the Shoot tab's scroll across a trip to a record and back.
 *
 * The scroller is the main panel, which outlives this view, so the
 * position is tracked as the user scrolls and handed to the store on
 * unmount.
 * Coming back, the rows arrive over several query round-trips. Until
 * they have, the page may be too short to hold the old position, and
 * rows landing above it make the browser's scroll anchoring push it
 * further down — stopping at the first render that reached the target
 * drifted lower on every round trip. So the restore re-applies on each
 * render for a short window, and stops when that ends or the user
 * scrolls for themselves.
 */
const RESTORE_WINDOW_MS = 1500;

function useRestoredScroll(rootRef: RefObject<HTMLDivElement>): void {
  const target = useRef(useStore.getState().shootView.scrollTop);
  // The position as the user left it, from scroll events. Not read from
  // the panel at unmount: by then the same commit is taking the script
  // pane away too, and the reflow has already moved the scroll.
  const pos = useRef(target.current);
  const settled = useRef(target.current === 0);

  useLayoutEffect(() => {
    if (settled.current) return;
    const panel = rootRef.current?.closest(".main-panel");
    if (panel !== null && panel !== undefined) {
      panel.scrollTop = target.current;
    }
  });

  useLayoutEffect(() => {
    if (settled.current) return;
    const t = window.setTimeout(
      () => { settled.current = true; }, RESTORE_WINDOW_MS);
    return () => window.clearTimeout(t);
    // Once per mount: the window opens when the view does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A layout effect, not a passive one, for its cleanup: it runs inside
  // the commit, before the scroll event of the browser clamping the panel
  // to the shorter record. A passive cleanup ran after it and saved the
  // clamped position.
  useLayoutEffect(() => {
    const panel = rootRef.current?.closest(".main-panel");
    if (panel === null || panel === undefined) return;
    // While restoring, the scroll is ours — clamps and anchoring — and
    // not where the user is; `pos` keeps the target until it settles.
    const onScroll = (): void => {
      if (settled.current) pos.current = panel.scrollTop;
    };
    const userScrolled = (): void => { settled.current = true; };
    panel.addEventListener("scroll", onScroll, { passive: true });
    panel.addEventListener("wheel", userScrolled, { passive: true });
    panel.addEventListener("pointerdown", userScrolled);
    panel.addEventListener("keydown", userScrolled);
    return () => {
      panel.removeEventListener("scroll", onScroll);
      panel.removeEventListener("wheel", userScrolled);
      panel.removeEventListener("pointerdown", userScrolled);
      panel.removeEventListener("keydown", userScrolled);
      useStore.getState().setShootView({ scrollTop: pos.current });
    };
    // The panel and the ref are fixed for the view's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function FieldSelect({ field, value, onPick }: {
  field: string;
  value: unknown;
  onPick: (value: string) => void;
}): JSX.Element {
  const options = registry.entities.get("shot")?.fields
    .find((f) => f.name === field)?.options ?? [];
  return (
    <select className="shoot-select"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onPick(e.target.value)}>
      <option value="">{field.replace("_", " ")}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function groupBy(rows: Row[], key: string): Map<number, Row[]> {
  const out = new Map<number, Row[]>();
  for (const r of rows) {
    const k = Number(r[key]);
    if (Number.isNaN(k)) continue;
    const list = out.get(k);
    if (list === undefined) out.set(k, [r]);
    else list.push(r);
  }
  return out;
}
