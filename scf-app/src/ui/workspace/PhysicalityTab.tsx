// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { exec, useStore } from "../../state/store.ts";
import { addHabit, addPlaceFor, cleanName } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { ProfileRowFields, RowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import { ShiftList } from "./ShiftList.tsx";

const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/** How they move: references, the profile, habits, shifts, and places. */
export function PhysicalityTab({ characterId }: { characterId: number }):
    JSX.Element {
  const { deleteRow } = useStore();
  const habits = useQuery(
    "SELECT * FROM physical_habit WHERE character_id = ? " +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id",
    [characterId]);
  const places = useQuery(
    "SELECT p.*, l.name AS location_name FROM character_environment_physicality p " +
    "JOIN location l ON l.id = p.location_id WHERE p.character_id = ? " +
    "ORDER BY l.name", [characterId]);
  const locations = useQuery(
    "SELECT id, name FROM location WHERE " +
    "(lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY name");
  const [habit, setHabit] = useState("");
  const [place, setPlace] = useState("");
  const taken = new Set(places.map((p) => Number(p["location_id"])));

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-mboard">
        <h3 id="ws-s-mboard">Motion reference</h3>
        <p className="ws-section-note">
          Point at video of how they move, and say what each one is for.
        </p>
        <ReferenceBoard owner={{ kind: "character", id: characterId }}
                        board="motion" />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-phys">
        <h3 id="ws-s-phys">The body</h3>
        <ProfileRowFields entity="physical_character_profile"
                          characterId={characterId}
                          gridTabs={["General", "Movement", "Presence"]}
                          titles={{ General: "Posture and energy",
                                    Movement: "Movement", Face: "Face",
                                    Presence: "Presence",
                                    Emotion: "How emotion shows",
                                    History: "What the body carries" }} />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-habits">
        <h3 id="ws-s-habits">Habits</h3>
        <div className="ws-variants">
          {habits.map((h) => (
            <details key={String(h["id"])} className="ws-card costume-card"
                     open={habits.length === 1}>
              <summary>
                <strong>{String(h["name"] ?? "Habit")}</strong>
                {h["frequency"] !== null && h["frequency"] !== undefined &&
                  <span className="ws-card-meta">{String(h["frequency"])}</span>}
              </summary>
              <div className="costume-body">
                <div className="ws-grid">
                  <AutoField entity="physical_habit" id={Number(h["id"])}
                             field="name" value={h["name"] ?? null}
                             showHelp={false} />
                </div>
                <RowFields entity="physical_habit" row={h}
                           exclude={["name", "character_id"]} />
                <div className="ws-row-actions">
                  <button className="ghost tiny" onClick={() =>
                    void deleteRow("physical_habit", Number(h["id"]))}>
                    Remove habit
                  </button>
                </div>
              </div>
            </details>
          ))}
          <form className="ws-add-row" onSubmit={(e) => {
            e.preventDefault();
            addHabit(exec, characterId, habit).then(() => {
              useStore.getState().noteWrite(); setHabit("");
            }).catch((err: unknown) => fail("Could not add the habit", err));
          }}>
            <label htmlFor="ws-add-habit" className="visually-hidden">
              New habit
            </label>
            <input id="ws-add-habit" value={habit}
                   placeholder="Name a habit, e.g. “wipes dry hands on her apron”"
                   onChange={(e) => setHabit(e.target.value)} />
            <button type="submit" disabled={cleanName(habit) === null}>
              Add habit
            </button>
          </form>
        </div>
      </section>

      <section className="ws-section" aria-labelledby="ws-s-pshifts">
        <h3 id="ws-s-pshifts">Shifts</h3>
        <p className="ws-section-note">
          Where the body changes from its baseline, in story order.
        </p>
        <ShiftList characterId={characterId} modality="physical" />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-places">
        <h3 id="ws-s-places">In particular places</h3>
        <p className="ws-section-note">
          How they are in a location — at home, on guard, out of place.
        </p>
        <div className="ws-variants">
          {places.map((p) => (
            <details key={String(p["id"])} className="ws-card costume-card">
              <summary>
                <strong>{String(p["location_name"])}</strong>
                {p["comfort_level"] !== null && p["comfort_level"] !== undefined &&
                  <span className="ws-card-meta">{String(p["comfort_level"])}</span>}
              </summary>
              <div className="costume-body">
                <RowFields entity="character_environment_physicality" row={p}
                           exclude={["name", "character_id", "location_id"]} />
                <div className="ws-row-actions">
                  <button className="ghost tiny" onClick={() => void deleteRow(
                    "character_environment_physicality", Number(p["id"]))}>
                    Remove
                  </button>
                </div>
              </div>
            </details>
          ))}
          <select aria-label="Add a place" value={place} className="ws-add-select"
                  onChange={(e) => {
                    const v = e.target.value;
                    setPlace("");
                    if (v === "") return;
                    addPlaceFor(exec, characterId, Number(v))
                      .then(() => useStore.getState().noteWrite())
                      .catch((err: unknown) => fail("Could not add it", err));
                  }}>
            <option value="">+ a place</option>
            {locations.filter((l) => !taken.has(Number(l["id"]))).map((l) => (
              <option key={String(l["id"])} value={String(l["id"])}>
                {String(l["name"])}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}
