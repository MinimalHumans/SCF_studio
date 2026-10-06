// SPDX-License-Identifier: Apache-2.0
import { useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import { useStoryScenes } from "./StoryStrip.tsx";

/**
 * A character's performance shifts of one modality, in story order and
 * in plain words: from which scene, and for how long. With an "as of"
 * scene set, the shifts in force there are marked — the same rule Q05
 * and Q06 use (§4.5 pattern 2).
 */
export function ShiftList({ characterId, modality }: {
  characterId: number; modality: "physical" | "vocal";
}): JSX.Element {
  const { openEntityRow, setDraftValue, asOfSceneId } = useStore();
  const scenes = useStoryScenes();
  const shifts = useQuery(
    "SELECT p.*, s.scene_number AS at_n, r.scene_number AS until_n " +
    "FROM performance_state p LEFT JOIN scene s ON s.id = p.scene_id " +
    "LEFT JOIN scene r ON r.id = p.resolved_at_scene_id " +
    "WHERE p.character_id = ? AND p.modality = ? " +
    "AND (p.lifecycle_status IS NULL OR p.lifecycle_status <> 'cut')",
    [characterId, modality]);
  const order = new Map(scenes.map((s, i) => [s.id, i]));
  const at = (id: unknown): number =>
    id === null || id === undefined ? 1e9 : order.get(Number(id)) ?? 1e9;
  const sorted = [...shifts].sort((a, b) => at(a["scene_id"]) - at(b["scene_id"]));
  const here = asOfSceneId === null ? null : order.get(asOfSceneId) ?? null;
  const inForce = (p: Record<string, unknown>): boolean => {
    if (here === null) return false;
    const start = at(p["scene_id"]);
    if (p["persistence"] !== "until_resolved") return start === here;
    const stop = p["resolved_at_scene_id"] === null ||
      p["resolved_at_scene_id"] === undefined ? 1e9 : at(p["resolved_at_scene_id"]);
    return start <= here && here < stop;
  };

  return (
    <>
      {sorted.length === 0
        ? <p className="muted">None yet.</p>
        : (
          <ul className="ws-records">
            {sorted.map((p) => {
              const from = p["at_n"] === null || p["at_n"] === undefined
                ? "no scene yet" : `scene ${String(p["at_n"])}`;
              const lasts = p["persistence"] === "until_resolved"
                ? (p["until_n"] === null || p["until_n"] === undefined
                  ? "until resolved" : `until scene ${String(p["until_n"])}`)
                : "that scene only";
              return (
                <li key={String(p["id"])}>
                  <button className="row-link" onClick={() =>
                    void openEntityRow("performance_state", Number(p["id"]))}>
                    <strong>{String(p["name"] ?? "shift")}</strong>
                    {p["state_description"] !== null &&
                     p["state_description"] !== undefined &&
                      <> — {String(p["state_description"])}</>}
                    {" "}<span className="muted">({from}, {lasts})</span>
                  </button>
                  {inForce(p) && <span className="ws-chip exc-live">in force here</span>}
                </li>
              );
            })}
          </ul>
        )}
      <button className="ghost tiny" onClick={() => {
        void openEntityRow("performance_state", null).then(() => {
          setDraftValue("character_id", characterId);
          setDraftValue("modality", modality);
          if (asOfSceneId !== null) setDraftValue("scene_id", asOfSceneId);
        });
      }}>
        New {modality} shift
      </button>
    </>
  );
}
