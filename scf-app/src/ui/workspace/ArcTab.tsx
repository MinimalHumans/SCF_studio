// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { exec, useStore } from "../../state/store.ts";
import { addArc, cleanName } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { StoryStrip, useStoryScenes, type Lane } from "./StoryStrip.tsx";
import {
  AddStageForm, StageEditor, usePresenceLane, useShiftLane,
  type PendingStage,
} from "./StageParts.tsx";

const NOT_CUT = "(lifecycle_status IS NULL OR lifecycle_status <> 'cut')";

/** An arc's display label: its axis, else its name, else a placeholder. */
export function arcLabel(row: Record<string, unknown>): string {
  for (const k of ["axis", "name"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "Untitled arc";
}

/**
 * How the character changes. The summary on top, then every arc as a
 * lane across the scenes, with a stage starting wherever the writer
 * clicks. The other ways the character changes — relationships and
 * performance shifts — can be laid underneath, read-only, so the whole
 * of a character's change can be seen at once.
 */
export function ArcTab({ characterId }: { characterId: number }):
    JSX.Element {
  const { deleteRow, openEntityRow } = useStore();
  const scenes = useStoryScenes();
  const character = useQuery(
    "SELECT name, arc_description FROM character WHERE id = ?",
    [characterId])[0];
  const arcs = useQuery(
    `SELECT * FROM character_arc WHERE character_id = ? AND ${NOT_CUT} ` +
    "ORDER BY id", [characterId]);
  const stages = useQuery(
    "SELECT s.id, s.character_arc_id, s.scene_id, s.stage_label, s.name " +
    "FROM character_arc_state s JOIN character_arc a " +
    "ON a.id = s.character_arc_id WHERE a.character_id = ? " +
    `AND (s.lifecycle_status IS NULL OR s.lifecycle_status <> 'cut')`,
    [characterId]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [newAxis, setNewAxis] = useState("");

  const name = String(character?.["name"] ?? "");
  const presence = usePresenceLane(characterId, "In the scene");
  const others = useOtherLanes(characterId, scenes, showOthers);

  const lanes: Lane[] = [
    ...arcs.map((a): Lane => {
      const arcId = Number(a["id"]);
      return {
        kind: "stages", key: `arc-${String(arcId)}`, label: arcLabel(a),
        stages: stages.filter((s) => Number(s["character_arc_id"]) === arcId)
          .map((s) => ({
            id: Number(s["id"]),
            sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
            label: String(s["stage_label"] ?? s["name"] ?? "stage"),
          })),
        onAddAt: (sceneId) => {
          setSelected(null);
          setPending({ table: "character_arc_state", parentId: arcId,
                       sceneId, laneLabel: arcLabel(a) });
        },
        onSelect: (id) => { setPending(null); setSelected(id); },
      };
    }),
    presence,
    ...others,
  ];

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-arcsum">
        <h3 id="ws-s-arcsum">{name === "" ? "How they change" : `How ${name} changes`}</h3>
        <div className="ws-stack">
          <AutoField entity="character" id={characterId}
                     field="arc_description"
                     value={character?.["arc_description"] ?? null}
                     label="Arc summary" showHelp={false} />
        </div>
      </section>

      <section className="ws-section" aria-labelledby="ws-s-arcs">
        <div className="strip-head">
          <h3 id="ws-s-arcs">Through the story</h3>
          <label className="strip-toggle">
            <input type="checkbox" checked={showOthers}
                   onChange={(e) => setShowOthers(e.target.checked)} />
            Show relationships and performance shifts
          </label>
        </div>
        <p className="ws-section-note">
          {arcs.length === 0
            ? "Add an arc below, then click a scene in its row to start a stage there."
            : "Click a scene in an arc's row to start a stage there; click a stage to edit it. Each stage holds until the next one starts."}
        </p>
        <StoryStrip scenes={scenes} lanes={lanes} selectedStage={selected}
                    caption={`${name}'s arcs across the scenes`} />
        {pending !== null && (
          <AddStageForm pending={pending} scenes={scenes}
                        onCancel={() => setPending(null)}
                        onDone={(id) => { setPending(null); setSelected(id); }} />
        )}
        {selected !== null && stages.some((s) => Number(s["id"]) === selected) && (
          <StageEditor table="character_arc_state" id={selected}
                       onRemoved={() => setSelected(null)} />
        )}
      </section>

      <section className="ws-section" aria-labelledby="ws-s-arclist">
        <h3 id="ws-s-arclist">Arcs</h3>
        <div className="ws-variants">
          {arcs.map((a) => {
            const id = Number(a["id"]);
            return (
              <article key={id} className="ws-card">
                <div className="ws-grid">
                  <AutoField entity="character_arc" id={id} field="axis"
                             value={a["axis"] ?? null} label="What changes"
                             showHelp={false} />
                  <AutoField entity="character_arc" id={id} field="direction"
                             value={a["direction"] ?? null} showHelp={false} />
                </div>
                <div className="ws-stack">
                  <AutoField entity="character_arc" id={id} field="description"
                             value={a["description"] ?? null} showHelp={false} />
                </div>
                <div className="ws-row-actions">
                  <button className="ghost tiny"
                          onClick={() => void openEntityRow("character_arc", id)}>
                    Open record
                  </button>
                  <button className="ghost tiny"
                          onClick={() => void deleteRow("character_arc", id)}>
                    Remove arc
                  </button>
                </div>
              </article>
            );
          })}
          <form className="ws-add-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  addArc(exec, characterId, newAxis).then(() => {
                    useStore.getState().noteWrite();
                    setNewAxis("");
                  }).catch((err: unknown) => useStore.setState({
                    errorMessage: `Could not add the arc: ${
                      err instanceof Error ? err.message : String(err)}` }));
                }}>
            <label htmlFor="ws-add-arc" className="visually-hidden">
              What changes in the new arc
            </label>
            <input id="ws-add-arc" value={newAxis}
                   placeholder="What changes? e.g. “trust → betrayal”"
                   onChange={(e) => setNewAxis(e.target.value)} />
            <button type="submit" disabled={cleanName(newAxis) === null}>
              Add arc
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

/** The read-only lanes laid under the arcs when asked for. */
function useOtherLanes(characterId: number,
                       scenes: ReturnType<typeof useStoryScenes>,
                       on: boolean): Lane[] {
  const rels = useQuery(on
    ? "SELECT r.*, c.name AS other_name FROM character_relationship r " +
      "JOIN character c ON c.id = CASE WHEN r.character_a_id = ? " +
      "THEN r.character_b_id ELSE r.character_a_id END " +
      "WHERE (r.character_a_id = ? OR r.character_b_id = ?) " +
      "AND (r.lifecycle_status IS NULL OR r.lifecycle_status <> 'cut') " +
      "ORDER BY c.name"
    : null, [characterId, characterId, characterId]);
  const relStages = useQuery(on
    ? "SELECT s.id, s.character_relationship_id, s.scene_id, s.stage_label, " +
      "s.name FROM relationship_state s JOIN character_relationship r " +
      "ON r.id = s.character_relationship_id " +
      "WHERE (r.character_a_id = ? OR r.character_b_id = ?) " +
      "AND (s.lifecycle_status IS NULL OR s.lifecycle_status <> 'cut')"
    : null, [characterId, characterId]);
  const physical = useShiftLane(characterId, "physical", "Physical shifts",
                                scenes);
  const vocal = useShiftLane(characterId, "vocal", "Vocal shifts", scenes);
  return useMemo(() => {
    if (!on) return [];
    // Only relationships that change: a relationship with no stages is
    // an empty row here, and the Relationships tab already lists it.
    const relLanes: Lane[] = rels.filter((r) => relStages.some((st) =>
      Number(st["character_relationship_id"]) === Number(r["id"])))
      .map((r) => {
      const id = Number(r["id"]);
      return {
        kind: "stages", key: `rel-${String(id)}`,
        label: `With ${String(r["other_name"])}`,
        stages: relStages
          .filter((s) => Number(s["character_relationship_id"]) === id)
          .map((s) => ({
            id: Number(s["id"]),
            sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
            label: String(s["stage_label"] ?? s["name"] ?? "stage"),
          })),
      };
    });
    return [...relLanes, physical, vocal];
  }, [on, rels, relStages, physical, vocal, characterId]);
}
