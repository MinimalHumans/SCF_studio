// SPDX-License-Identifier: Apache-2.0
import { rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import { ProfileRowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import { useStoryScenes } from "./StoryStrip.tsx";

/** How they sound: references, the profile, and how the voice shifts. */
export function VoiceTab({ characterId }: { characterId: number }):
    JSX.Element {
  const { openEntityRow, setDraftValue } = useStore();
  const scenes = useStoryScenes();
  const shifts = useQuery(
    "SELECT p.*, s.scene_number AS at_n, r.scene_number AS until_n " +
    "FROM performance_state p LEFT JOIN scene s ON s.id = p.scene_id " +
    "LEFT JOIN scene r ON r.id = p.resolved_at_scene_id " +
    "WHERE p.character_id = ? AND p.modality = 'vocal' " +
    "AND (p.lifecycle_status IS NULL OR p.lifecycle_status <> 'cut')",
    [characterId]);
  const voiceovers = useQuery(
    "SELECT * FROM voiceover_design WHERE character_id = ? ORDER BY id",
    [characterId]);
  const order = new Map(scenes.map((s, i) => [s.id, i]));
  const sorted = [...shifts].sort((a, b) =>
    (order.get(Number(a["scene_id"])) ?? 1e9) -
    (order.get(Number(b["scene_id"])) ?? 1e9));
  const createWith = (entity: string, values: Record<string, string | number>) => {
    void openEntityRow(entity, null).then(() => {
      for (const [k, v] of Object.entries(values)) setDraftValue(k, v);
    });
  };

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-vboard">
        <h3 id="ws-s-vboard">Voice reference</h3>
        <p className="ws-section-note">
          Point at recordings, and say what each one is for.
        </p>
        <ReferenceBoard characterId={characterId} board="voice" />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-voice">
        <h3 id="ws-s-voice">The voice</h3>
        <ProfileRowFields entity="vocal_profile" characterId={characterId}
                          gridTabs={["General", "Speech", "Accent", "Delivery"]}
                          titles={{ General: "Voice", Speech: "Speech",
                                    Accent: "Accent", Delivery: "Delivery",
                                    Habits: "Habits", Notes: "Notes" }} />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-vshifts">
        <h3 id="ws-s-vshifts">Shifts</h3>
        <p className="ws-section-note">
          Where the voice changes from its baseline, in story order.
        </p>
        {sorted.length === 0
          ? <p className="muted">None yet.</p>
          : (
            <ul className="ws-records">
              {sorted.map((p) => {
                const at = p["at_n"] === null || p["at_n"] === undefined
                  ? "no scene yet" : `scene ${String(p["at_n"])}`;
                const lasts = p["persistence"] === "until_resolved"
                  ? (p["until_n"] === null || p["until_n"] === undefined
                    ? "until resolved" : `until scene ${String(p["until_n"])}`)
                  : "that scene only";
                return (
                  <li key={String(p["id"])}>
                    <button className="row-link" onClick={() =>
                      void openEntityRow("performance_state", Number(p["id"]))}>
                      <strong>{String(p["state_description"] ?? p["name"] ??
                                      "shift")}</strong> — from {at}, {lasts}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        <button className="ghost tiny" onClick={() => createWith(
          "performance_state", { character_id: characterId, modality: "vocal" })}>
          New vocal shift
        </button>
      </section>

      <section className="ws-section" aria-labelledby="ws-s-vo">
        <h3 id="ws-s-vo">Voiceover</h3>
        {voiceovers.length === 0
          ? <p className="muted">None.</p>
          : (
            <ul className="ws-records">
              {voiceovers.map((v) => (
                <li key={String(v["id"])}>
                  <button className="row-link" onClick={() =>
                    void openEntityRow("voiceover_design", Number(v["id"]))}>
                    {rowName("voiceover_design", v)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        <button className="ghost tiny" onClick={() => createWith(
          "voiceover_design", { character_id: characterId })}>
          New voiceover
        </button>
      </section>
    </div>
  );
}
