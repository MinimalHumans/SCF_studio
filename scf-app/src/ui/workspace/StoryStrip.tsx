// SPDX-License-Identifier: Apache-2.0
import { Fragment, useState } from "react";
import { SCENE_ORDER_BY, SCENE_ORDER_JOIN } from "@scf-core/structure.ts";
import { layoutStages } from "../../state/storyStrip.ts";
import { useQuery } from "../useQuery.ts";
import { useStore } from "../../state/store.ts";

export interface StripScene {
  id: number;
  number: string;
  name: string;
}

/** Every scene that is in the film, in story order (§4.1). */
export function useStoryScenes(): StripScene[] {
  return useQuery(
    "SELECT s.id, s.scene_number, s.name FROM scene s " +
    `${SCENE_ORDER_JOIN} ` +
    "WHERE (s.lifecycle_status IS NULL OR s.lifecycle_status <> 'cut') " +
    SCENE_ORDER_BY).map((r) => ({
      id: Number(r["id"]),
      number: r["scene_number"] === null || r["scene_number"] === undefined
        ? "·" : String(r["scene_number"]),
      name: String(r["name"] ?? ""),
    }));
}

export interface StripStage {
  id: number;
  sceneId: number | null;
  label: string;
}

/** A lane of stages, each in force until the next starts. */
export interface StageLane {
  kind: "stages";
  key: string;
  label: string;
  stages: StripStage[];
  /** Clicking a scene starts a stage there. Read-only when absent. */
  onAddAt?: (sceneId: number) => void;
  onSelect?: (stageId: number) => void;
}

/** A lane of marks: scenes where something is true, nothing in between. */
export interface MarkLane {
  kind: "marks";
  key: string;
  label: string;
  marks: Map<number, { text: string; strength: "strong" | "weak" }>;
}

export type Lane = StageLane | MarkLane;

/**
 * The story strip: scenes left to right in story order, one row per
 * lane. Arc, Relationships and later Wardrobe all draw on it, so how a
 * stage's reach is shown is decided once.
 *
 * Stages are drawn as spans from the scene they start at to the scene
 * before the next one (latest wins, §4.5). Every scene in an editable
 * lane is a button: clicking one starts a stage there, inside an
 * existing span or not. Clicking a stage's label selects it.
 */
export function StoryStrip({ scenes, lanes, selectedStage,
                             caption }: {
  scenes: StripScene[];
  lanes: Lane[];
  selectedStage?: number | null;
  caption: string;
}): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  // The "as of" scene from the character header, drawn as a column.
  const asOf = useStore((st) => st.asOfSceneId);
  const ids = scenes.map((s) => s.id);
  const asOfIndex = asOf === null ? -1 : ids.indexOf(asOf);
  if (scenes.length === 0) {
    return <p className="muted">There are no scenes yet to place stages on.</p>;
  }
  const cols = `minmax(140px, 180px) repeat(${String(scenes.length)}, ` +
    "minmax(30px, 1fr))";

  return (
    <div className="strip-wrap">
      <div className="strip" role="grid" aria-label={caption}
           style={{ gridTemplateColumns: cols }}
           onMouseLeave={() => setHover(null)}>
        {/* Every cell is placed explicitly: the "as of" highlight spans a
            column, and anything auto-placed would flow around it. */}
        <div className="strip-corner" role="columnheader"
             style={{ gridRow: 1, gridColumn: 1 }}>Scene</div>
        {scenes.map((s, i) => (
          <div key={s.id} role="columnheader" title={s.name}
               style={{ gridRow: 1, gridColumn: i + 2 }}
               className={"strip-scene" + (hover === i ? " hover" : "") +
                          (asOfIndex === i ? " asof" : "")}>
            {s.number}
          </div>
        ))}

        {asOfIndex >= 0 && (
          <div className="strip-asof" aria-hidden="true"
               style={{ gridColumn: asOfIndex + 2,
                        gridRow: `1 / ${String(lanes.length + 2)}` }} />
        )}
        {lanes.map((lane, row) => {
          const gridRow = row + 2;
          if (lane.kind === "marks") {
            return (
              <Fragment key={lane.key}>
                <div className="strip-lane-label strip-lane-quiet"
                     style={{ gridRow, gridColumn: 1 }}>{lane.label}</div>
                {scenes.map((s, i) => {
                  const m = lane.marks.get(s.id);
                  return (
                    <div key={s.id} style={{ gridRow, gridColumn: i + 2 }}
                         className={"strip-cell strip-mark-cell" +
                                    (hover === i ? " hover" : "")}
                         onMouseEnter={() => setHover(i)}
                         title={m === undefined ? undefined
                           : `sc ${s.number}: ${m.text}`}>
                      {m !== undefined && (
                        <span className={`strip-mark strip-mark-${m.strength}`} />
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          }

          const layout = layoutStages(ids, lane.stages.map((s) => ({
            id: s.id, sceneId: s.sceneId })));
          const byId = new Map(lane.stages.map((s) => [s.id, s]));
          const editable = lane.onAddAt !== undefined;
          return (
            <Fragment key={lane.key}>
              <div className="strip-lane-label" style={{ gridRow, gridColumn: 1 }}>
                {lane.label}
              </div>
              {scenes.map((s, i) => (
                editable ? (
                  <button key={s.id} type="button"
                          style={{ gridRow, gridColumn: i + 2 }}
                          className={"strip-cell strip-add" +
                                     (hover === i ? " hover" : "")}
                          onMouseEnter={() => setHover(i)}
                          onFocus={() => setHover(i)}
                          title={`Start a stage at sc ${s.number}`}
                          aria-label={`${lane.label}: start a stage at ` +
                                      `scene ${s.number}`}
                          onClick={() => lane.onAddAt?.(s.id)} />
                ) : (
                  <div key={s.id} style={{ gridRow, gridColumn: i + 2 }}
                       onMouseEnter={() => setHover(i)}
                       className={"strip-cell" + (hover === i ? " hover" : "")} />
                )
              ))}
              {layout.placed.map((p) => {
                const stage = byId.get(p.id);
                const selected = selectedStage === p.id && editable;
                return (
                  <div key={p.id}
                       className={"strip-span" +
                                  (editable ? "" : " strip-span-quiet") +
                                  (selected ? " selected" : "")}
                       style={{ gridRow, gridColumnStart: p.start + 2,
                                gridColumnEnd: p.end + 3 }}>
                    {lane.onSelect === undefined ? (
                      <span className="strip-span-label"
                            title={stage?.label}>{stage?.label}</span>
                    ) : (
                      <button type="button" className="strip-span-label"
                              title={`${stage?.label ?? ""} — from sc ` +
                                     `${scenes[p.start]?.number ?? ""}`}
                              aria-pressed={selected}
                              onClick={() => lane.onSelect?.(p.id)}>
                        {stage?.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <StripProblems lanes={lanes} sceneIds={ids} />
    </div>
  );
}

/**
 * Stages the strip cannot draw, named rather than dropped: one keyed at
 * no scene or a cut one, and one that loses a tie at its scene and so is
 * never in force.
 */
function StripProblems({ lanes, sceneIds }: {
  lanes: Lane[]; sceneIds: number[];
}): JSX.Element | null {
  const notes: Array<{ key: string; lane: StageLane; id: number;
                       why: string }> = [];
  for (const lane of lanes) {
    if (lane.kind !== "stages") continue;
    const layout = layoutStages(sceneIds, lane.stages.map((s) => ({
      id: s.id, sceneId: s.sceneId })));
    for (const id of layout.unplaced) {
      notes.push({ key: `${lane.key}:u${String(id)}`, lane, id,
                   why: "starts at no scene the film still has" });
    }
    for (const id of layout.hidden) {
      notes.push({ key: `${lane.key}:h${String(id)}`, lane, id,
                   why: "starts at the same scene as a later stage, so it " +
                        "is never in force" });
    }
  }
  if (notes.length === 0) return null;
  return (
    <ul className="strip-problems">
      {notes.map((n) => {
        const label = n.lane.stages.find((s) => s.id === n.id)?.label ?? "";
        return (
          <li key={n.key}>
            {n.lane.onSelect === undefined
              ? <strong>{label}</strong>
              : <button type="button" className="row-link"
                        onClick={() => n.lane.onSelect?.(n.id)}>
                  {label}
                </button>}
            {" "}({n.lane.label}) {n.why}.
          </li>
        );
      })}
    </ul>
  );
}
