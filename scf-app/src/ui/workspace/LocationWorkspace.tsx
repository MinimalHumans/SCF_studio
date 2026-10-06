// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { variantInForce } from "@scf-core/resolution.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { LOCATION_TABS } from "../../state/subjectKinds.ts";
import { setField } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { MainRowFields, VariantsTab } from "./ElementTabs.tsx";
import { ProfileRowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import { StoryStrip, useStoryScenes, type MarkLane } from "./StoryStrip.tsx";
import { SubjectShell, words } from "./SubjectShell.tsx";
import { useSceneIndex } from "./useSceneIndex.ts";

const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/** Everything about one location: what it is, how it looks and sounds,
 *  its variants, and the scenes set there. */
export function LocationWorkspace(): JSX.Element {
  const { selectedLocationId, locationTab, setTabOf } = useStore();
  return (
    <SubjectShell kind="location" id={selectedLocationId}
                  tabs={LOCATION_TABS} tab={locationTab}
                  onTab={(t) => setTabOf("location", t)}
                  empty={"No locations yet. Use New location to make one, or " +
                         "write a scene heading — the locations you link from " +
                         "the script show up here."}
                  chips={(row) => [words(row["location_type"]),
                                   words(row["realization_status"])]
                    .filter((c): c is string => c !== null)}>
      {(id) => locationTab === "Profile"
        ? <MainRowFields key={id} kind="location" id={id}
                         gridTabs={["General"]}
                         titles={{ General: "The place", Details: "Details" }} />
        : locationTab === "Look" ? <LocationLook key={id} id={id} />
        : locationTab === "Sound" ? <LocationSound key={id} id={id} />
        : locationTab === "Variants"
          ? <VariantsTab key={id} kind="location" id={id}
                         note={"Other states of this place — night, after the " +
                               "storm, in winter. A scene gets the variant whose " +
                               "time of day, weather and season best match it " +
                               "(§12.17); the baseline variant is the fallback."} />
        : <LocationScenes key={id} id={id} />}
    </SubjectShell>
  );
}

function LocationLook({ id }: { id: number }): JSX.Element {
  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-lboard">
        <h3 id="ws-s-lboard">Reference board</h3>
        <p className="ws-section-note">
          Point at photos, plates and concept art, and say what each is for.
          Exceptions can apply by variant, time of day or scene.
        </p>
        <ReferenceBoard owner={{ kind: "location", id }} board="look" />
      </section>
      <section className="ws-section" aria-labelledby="ws-s-ldesign">
        <h3 id="ws-s-ldesign">Design</h3>
        <ProfileRowFields entity="location_design" characterId={id}
                          ownerColumn="location_id"
                          gridTabs={["Architecture"]}
                          titles={{ General: "Concept", Architecture: "Architecture",
                                    Materials: "Materials", Spatial: "Space",
                                    Lighting: "Light", Notes: "Notes" }} />
      </section>
      <section className="ws-section" aria-labelledby="ws-s-lcolor">
        <h3 id="ws-s-lcolor">Color</h3>
        <ProfileRowFields entity="location_color_scheme" characterId={id}
                          ownerColumn="location_id" gridTabs={["General"]}
                          titles={{ General: "Palette", Notes: "Notes" }} />
      </section>
    </div>
  );
}

function LocationSound({ id }: { id: number }): JSX.Element {
  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-lsboard">
        <h3 id="ws-s-lsboard">Sound reference</h3>
        <p className="ws-section-note">
          Point at room tone, ambience and recordings, and say what each is for.
        </p>
        <ReferenceBoard owner={{ kind: "location", id }} board="sound" />
      </section>
      <section className="ws-section" aria-labelledby="ws-s-lsound">
        <h3 id="ws-s-lsound">How it sounds</h3>
        <ProfileRowFields entity="location_sound_profile" characterId={id}
                          ownerColumn="location_id"
                          titles={{ General: "The room", Ambience: "Ambience",
                                    Notes: "Notes" }} />
      </section>
    </div>
  );
}

/**
 * The scenes set here, in story order, each with the variant §12.17
 * picks for it — the same answer Q04 gives — and who is in it.
 */
function LocationScenes({ id }: { id: number }): JSX.Element {
  const { openScriptAt, asOfSceneId, revision } = useStore();
  const scenes = useStoryScenes();
  const index = useSceneIndex();
  const here = useQuery(
    "SELECT id, time_of_day, season, weather_conditions FROM scene " +
    "WHERE location_id = ?", [id]);
  const cast = useQuery(
    "SELECT sc.scene_id, c.name FROM scene_character sc " +
    "JOIN character c ON c.id = sc.character_id " +
    "JOIN scene s ON s.id = sc.scene_id WHERE s.location_id = ? ORDER BY c.name",
    [id]);
  const [variants, setVariants] = useState<Map<number, string>>(new Map());
  const [pick, setPick] = useState("");
  const hereIds = new Set(here.map((s) => Number(s["id"])));
  const ordered = scenes.filter((s) => hereIds.has(s.id));
  const key = ordered.map((s) => s.id).join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out = new Map<number, string>();
      for (const s of ordered) {
        const v = await variantInForce({ exec, registry }, "location", id, s.id);
        if (v !== null) out.set(s.id, String(v["name"]));
      }
      if (!cancelled) setVariants(out);
    })();
    return () => { cancelled = true; };
  }, [id, key, revision]);  // eslint-disable-line react-hooks/exhaustive-deps

  const marks: MarkLane["marks"] = new Map();
  for (const s of ordered) {
    marks.set(s.id, { text: variants.get(s.id) ?? "set here", strength: "strong" });
  }
  const sceneRow = (sid: number) => here.find((s) => Number(s["id"]) === sid);

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-lscenes">
        <h3 id="ws-s-lscenes">Scenes set here</h3>
        <StoryStrip scenes={scenes}
                    lanes={[{ kind: "marks", key: "set-here", label: "Set here",
                              marks }]}
                    caption="Scenes set in this location" />
        <table className="scn-table">
          <thead>
            <tr>
              <th scope="col">Scene</th>
              <th scope="col">When</th>
              <th scope="col">Variant in force</th>
              <th scope="col">Who is there</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((s) => {
              const r = sceneRow(s.id);
              const when = [r?.["time_of_day"], r?.["weather_conditions"],
                            r?.["season"]]
                .filter((v) => v !== null && v !== undefined && v !== "")
                .map(String).join(", ");
              const heading = index?.headingLine.get(s.id);
              return (
                <tr key={s.id} className={s.id === asOfSceneId ? "scn-asof" : undefined}>
                  <th scope="row">
                    <span className="scn-num">{s.number}</span>
                    <span className="scn-name">{s.name}</span>
                  </th>
                  <td className="scn-detail">{when || "—"}</td>
                  <td>{variants.get(s.id) ?? <span className="muted">—</span>}</td>
                  <td className="scn-detail">
                    {cast.filter((c) => Number(c["scene_id"]) === s.id)
                      .map((c) => String(c["name"])).join(", ") || "—"}
                  </td>
                  <td className="scn-actions">
                    {heading !== undefined && (
                      <button className="ghost tiny"
                              onClick={() => openScriptAt(heading)}>
                        Open in script
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <select aria-label="Set another scene here" value={pick}
                className="ws-add-select"
                onChange={(e) => {
                  const v = e.target.value;
                  setPick("");
                  if (v === "") return;
                  setField(exec, registry, "scene", Number(v), "location_id", id)
                    .then(() => useStore.getState().noteWrite())
                    .catch((err: unknown) => fail("Could not set the location", err));
                }}>
          <option value="">+ set another scene here</option>
          {scenes.filter((s) => !hereIds.has(s.id)).map((s) => (
            <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
          ))}
        </select>
      </section>
    </div>
  );
}
