// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { exec, useStore } from "../../state/store.ts";
import {
  addCostume, addMakeupFor, cleanName, ensureProgression, wearIn,
} from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { ProfileRowFields, RowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import {
  StoryStrip, useStoryScenes, type Lane, type MarkLane, type StripScene,
} from "./StoryStrip.tsx";
import {
  AddStageForm, StageEditor, usePresenceLane, type PendingStage,
} from "./StageParts.tsx";

const NOT_CUT = "(lifecycle_status IS NULL OR lifecycle_status <> 'cut')";
const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/** What they wear and how they are made up, and how that changes. */
export function WardrobeTab({ characterId }: { characterId: number }):
    JSX.Element {
  const scenes = useStoryScenes();
  const costumes = useQuery(
    `SELECT * FROM costume WHERE character_id = ? AND ${NOT_CUT} ORDER BY id`,
    [characterId]);
  const worn = useQuery(
    "SELECT cs.id, cs.costume_id, cs.scene_id, cs.condition_in_scene " +
    "FROM costume_scene cs JOIN costume c ON c.id = cs.costume_id " +
    "WHERE c.character_id = ?", [characterId]);
  const [newName, setNewName] = useState("");

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-costumes">
        <h3 id="ws-s-costumes">Costumes</h3>
        <p className="ws-section-note">
          Each costume has its own references, and says which scenes it is
          worn in.
        </p>
        <div className="ws-variants">
          {costumes.map((c) => (
            <CostumeCard key={String(c["id"])} costume={c} scenes={scenes}
                         worn={worn.filter((w) =>
                           Number(w["costume_id"]) === Number(c["id"]))}
                         open={costumes.length === 1} />
          ))}
          <form className="ws-add-row" onSubmit={(e) => {
            e.preventDefault();
            addCostume(exec, characterId, newName).then(() => {
              useStore.getState().noteWrite(); setNewName("");
            }).catch((err: unknown) => fail("Could not add the costume", err));
          }}>
            <label htmlFor="ws-add-costume" className="visually-hidden">
              New costume's name
            </label>
            <input id="ws-add-costume" value={newName}
                   placeholder="Name a costume, e.g. “mourning dress”"
                   onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" disabled={cleanName(newName) === null}>
              Add costume
            </button>
          </form>
        </div>
      </section>

      <WardrobeStory characterId={characterId} scenes={scenes}
                     costumes={costumes} worn={worn} />

      <Makeup characterId={characterId} scenes={scenes} />
    </div>
  );
}

function CostumeCard({ costume, scenes, worn, open }: {
  costume: Row; scenes: StripScene[]; worn: Row[]; open: boolean;
}): JSX.Element {
  const { deleteRow, openEntityRow, asOfSceneId } = useStore();
  const id = Number(costume["id"]);
  const [pick, setPick] = useState("");
  const order = new Map(scenes.map((s, i) => [s.id, i]));
  const wornSorted = [...worn].sort((a, b) =>
    (order.get(Number(a["scene_id"])) ?? 1e9) -
    (order.get(Number(b["scene_id"])) ?? 1e9));
  const sceneOf = (sid: unknown): StripScene | undefined =>
    scenes.find((s) => s.id === Number(sid));
  const wornHere = asOfSceneId !== null &&
    worn.some((w) => Number(w["scene_id"]) === asOfSceneId);
  const wornIds = new Set(worn.map((w) => Number(w["scene_id"])));

  return (
    <details className="ws-card costume-card" open={open}>
      <summary>
        <strong>{String(costume["name"] ?? "Costume")}</strong>
        <span className="ws-card-meta">
          {worn.length === 0 ? "not worn in any scene yet"
            : `worn in ${String(worn.length)} scene${worn.length === 1 ? "" : "s"}`}
        </span>
        {wornHere && <span className="ws-chip exc-live">worn here</span>}
      </summary>
      <div className="costume-body">
        <div className="ws-grid">
          <AutoField entity="costume" id={id} field="name"
                     value={costume["name"] ?? null} showHelp={false} />
        </div>
        <RowFields entity="costume" row={costume}
                   exclude={["name", "character_id"]}
                   gridTabs={["Color"]}
                   titles={{ General: "The costume", Color: "Color",
                             Material: "Material", Narrative: "What it says",
                             Notes: "Continuity" }} />

        <div className="rel-group">
          <h4>Worn in</h4>
          <div className="costume-worn">
            {wornSorted.map((w) => {
              const s = sceneOf(w["scene_id"]);
              return (
                <span key={String(w["id"])}
                      className={"ws-chip costume-scene" +
                                 (Number(w["scene_id"]) === asOfSceneId
                                   ? " exc-live" : "")}>
                  sc {s?.number ?? "?"}
                  <button className="ghost tiny"
                          aria-label={`Not worn in scene ${s?.number ?? ""}`}
                          onClick={() => void deleteRow("costume_scene",
                                                        Number(w["id"]))}>
                    ×
                  </button>
                </span>
              );
            })}
            <select aria-label="Worn in another scene" value={pick}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPick("");
                      if (v === "") return;
                      wearIn(exec, id, Number(v))
                        .then(() => useStore.getState().noteWrite())
                        .catch((err: unknown) => fail("Could not add the scene", err));
                    }}>
              <option value="">+ scene</option>
              {scenes.filter((s) => !wornIds.has(s.id)).map((s) => (
                <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rel-group">
          <h4>References</h4>
          <ReferenceBoard owner={{ kind: "costume", id }} board="look" />
        </div>

        <div className="ws-row-actions">
          <button className="ghost tiny"
                  onClick={() => void openEntityRow("costume", id)}>
            Open record
          </button>
          <button className="ghost tiny"
                  onClick={() => void deleteRow("costume", id)}>
            Remove costume
          </button>
        </div>
      </div>
    </details>
  );
}

/** The wardrobe's arc: its summary, its stages, and where each costume is. */
function WardrobeStory({ characterId, scenes, costumes, worn }: {
  characterId: number; scenes: StripScene[]; costumes: Row[]; worn: Row[];
}): JSX.Element {
  const progression = useQuery(
    `SELECT id FROM costume_progression WHERE character_id = ? AND ${NOT_CUT} ` +
    "ORDER BY id LIMIT 1", [characterId])[0];
  const progressionId = progression === undefined
    ? null : Number(progression["id"]);
  const stages = useQuery(progressionId === null ? null
    : "SELECT id, scene_id, stage_label, name FROM costume_progression_state " +
      `WHERE costume_progression_id = ? AND ${NOT_CUT}`, [progressionId ?? 0]);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const presence = usePresenceLane(characterId, "In the scene");

  const costumeLanes: MarkLane[] = useMemo(() => costumes.map((c) => {
    const marks: MarkLane["marks"] = new Map();
    for (const w of worn) {
      if (Number(w["costume_id"]) !== Number(c["id"])) continue;
      marks.set(Number(w["scene_id"]), {
        text: w["condition_in_scene"] === null ||
          w["condition_in_scene"] === undefined || w["condition_in_scene"] === ""
          ? "worn" : `worn, ${String(w["condition_in_scene"])}`,
        strength: "strong",
      });
    }
    return { kind: "marks", key: `costume-${String(c["id"])}`,
             label: String(c["name"] ?? "costume"), marks };
  }), [costumes, worn]);

  const lane: Lane = {
    kind: "stages", key: "wardrobe-stages", label: "Wardrobe stages",
    stages: stages.map((s) => ({
      id: Number(s["id"]),
      sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
      label: String(s["stage_label"] ?? s["name"] ?? "stage"),
    })),
    onAddAt: (sceneId) => {
      setSelected(null);
      // The progression the stages hang from is made on first need.
      ensureProgression(exec, characterId).then((id) => {
        if (progressionId === null) useStore.getState().noteWrite();
        setPending({ table: "costume_progression_state", parentId: id,
                     sceneId, laneLabel: "the wardrobe" });
      }).catch((e: unknown) => fail("Could not start the stage", e));
    },
    onSelect: (id) => { setPending(null); setSelected(id); },
  };

  return (
    <section className="ws-section" aria-labelledby="ws-s-wstory">
      <h3 id="ws-s-wstory">Wardrobe through the story</h3>
      <ProfileRowFields entity="costume_progression" characterId={characterId}
                        titles={{ General: "How the wardrobe changes",
                                  Notes: "Notes" }} />
      <p className="ws-section-note">
        Click a scene in the Wardrobe stages row to start a stage there.
        Each costume's row shows the scenes it is worn in.
      </p>
      <StoryStrip scenes={scenes} lanes={[lane, ...costumeLanes, presence]}
                  selectedStage={selected}
                  caption="The wardrobe across the scenes" />
      {pending !== null && (
        <AddStageForm pending={pending} scenes={scenes}
                      onCancel={() => setPending(null)}
                      onDone={(id) => { setPending(null); setSelected(id); }} />
      )}
      {selected !== null && stages.some((s) => Number(s["id"]) === selected) && (
        <StageEditor table="costume_progression_state" id={selected}
                     onRemoved={() => setSelected(null)} />
      )}
    </section>
  );
}

/** The baseline design, then the scenes that differ from it. */
function Makeup({ characterId, scenes }: {
  characterId: number; scenes: StripScene[];
}): JSX.Element {
  const { deleteRow, asOfSceneId } = useStore();
  const designs = useQuery(
    "SELECT * FROM makeup_hair_design WHERE character_id = ? " +
    "AND scene_id IS NOT NULL", [characterId]);
  const [pick, setPick] = useState("");
  const order = new Map(scenes.map((s, i) => [s.id, i]));
  const sorted = [...designs].sort((a, b) =>
    (order.get(Number(a["scene_id"])) ?? 1e9) -
    (order.get(Number(b["scene_id"])) ?? 1e9));
  const taken = new Set(designs.map((d) => Number(d["scene_id"])));
  const titles = { General: "Makeup", Hair: "Hair", Effects: "Effects" };

  return (
    <section className="ws-section" aria-labelledby="ws-s-makeup">
      <h3 id="ws-s-makeup">Makeup & hair</h3>
      <div className="rel-group"><h4>Baseline</h4></div>
      <ProfileRowFields entity="makeup_hair_design" characterId={characterId}
                        where="scene_id IS NULL" exclude={["scene_id"]}
                        titles={titles} />
      <div className="rel-group">
        <h4>Scenes that differ</h4>
        <div className="ws-variants">
          {sorted.map((d) => {
            const s = scenes.find((x) => x.id === Number(d["scene_id"]));
            const here = Number(d["scene_id"]) === asOfSceneId;
            return (
              <details key={String(d["id"])}
                       className={"ws-card costume-card" + (here ? " live" : "")}
                       open={here}>
                <summary>
                  <strong>sc {s?.number ?? "?"}</strong>
                  <span className="ws-card-meta">{s?.name}</span>
                  {here && <span className="ws-chip exc-live">this scene</span>}
                </summary>
                <div className="costume-body">
                  <RowFields entity="makeup_hair_design" row={d}
                             exclude={["character_id", "scene_id", "name"]}
                             titles={titles} />
                  <div className="ws-row-actions">
                    <button className="ghost tiny" onClick={() =>
                      void deleteRow("makeup_hair_design", Number(d["id"]))}>
                      Remove
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
          <select aria-label="A scene whose makeup differs" value={pick}
                  className="ws-add-select"
                  onChange={(e) => {
                    const v = e.target.value;
                    setPick("");
                    if (v === "") return;
                    addMakeupFor(exec, characterId, Number(v))
                      .then(() => useStore.getState().noteWrite())
                      .catch((err: unknown) => fail("Could not add it", err));
                  }}>
            <option value="">+ a scene where it differs</option>
            {scenes.filter((s) => !taken.has(s.id)).map((s) => (
              <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
