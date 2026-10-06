// SPDX-License-Identifier: Apache-2.0
import { rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import { ProfileRowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import { ShiftList } from "./ShiftList.tsx";

/** How they sound: references, the profile, and how the voice shifts. */
export function VoiceTab({ characterId }: { characterId: number }):
    JSX.Element {
  const { openEntityRow, setDraftValue } = useStore();
  const voiceovers = useQuery(
    "SELECT * FROM voiceover_design WHERE character_id = ? ORDER BY id",
    [characterId]);
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
        <ReferenceBoard owner={{ kind: "character", id: characterId }}
                        board="voice" />
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
        <ShiftList characterId={characterId} modality="vocal" />
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
