// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { exec, registry, useStore } from "../../state/store.ts";
import { PROP_TABS } from "../../state/subjectKinds.ts";
import { layoutStages, stageAt } from "../../state/storyStrip.ts";
import { linkPropToScene, setField } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { MainRowFields, VariantsTab } from "./ElementTabs.tsx";
import { ProfileRowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";
import {
  StoryStrip, useStoryScenes, type Lane, type MarkLane,
} from "./StoryStrip.tsx";
import { AddStageForm, StageEditor, type PendingStage } from "./StageParts.tsx";
import { SubjectShell, words } from "./SubjectShell.tsx";
import { useSceneIndex } from "./useSceneIndex.ts";

const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/** Everything about one prop: what it is, how it looks, its versions,
 *  what happens to it, and where it is. */
export function PropWorkspace(): JSX.Element {
  const { selectedPropId, propTab, setTabOf } = useStore();
  return (
    <SubjectShell kind="prop" id={selectedPropId} tabs={PROP_TABS} tab={propTab}
                  onTab={(t) => setTabOf("prop", t)}
                  empty={"No props yet. Use New prop to make one, or tag one " +
                         "in the script."}
                  chips={(row) => [words(row["prop_type"]),
                                   words(row["story_function"]),
                                   words(row["realization_status"])]
                    .filter((c): c is string => c !== null)}>
      {(id) => propTab === "Profile"
        ? <MainRowFields key={id} kind="prop" id={id}
                         titles={{ General: "The prop", Story: "In the story",
                                   Notes: "Notes" }} />
        : propTab === "Look" ? <PropLook key={id} id={id} />
        : propTab === "Variants"
          ? <VariantsTab key={id} kind="prop" id={id}
                         note={"Other versions of this prop that are built or " +
                               "dressed separately — broken, aged, a hero and a " +
                               "stunt copy. A scene says which version appears."} />
        : propTab === "Through the story" ? <PropStory key={id} id={id} />
        : <PropScenes key={id} id={id} />}
    </SubjectShell>
  );
}

function PropLook({ id }: { id: number }): JSX.Element {
  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-pboard">
        <h3 id="ws-s-pboard">Reference board</h3>
        <p className="ws-section-note">
          Point at photos, scans and concept art, and say what each is for.
        </p>
        <ReferenceBoard owner={{ kind: "prop", id }} board="look" />
      </section>
      <section className="ws-section" aria-labelledby="ws-s-psurface">
        <h3 id="ws-s-psurface">Surface</h3>
        <ProfileRowFields entity="prop_surface_profile" characterId={id}
                          ownerColumn="prop_id"
                          gridTabs={["General", "Color", "Surface"]}
                          titles={{ General: "Material and size", Color: "Color",
                                    Surface: "Surface", Condition: "Condition",
                                    Identity: "What makes it this one",
                                    Notes: "Notes" }} />
      </section>
    </div>
  );
}

/**
 * What happens to the prop: its states (§4.5 latest wins) as stages on
 * the strip, who holds it as a lane of its own, and where it appears.
 */
function PropStory({ id }: { id: number }): JSX.Element {
  const scenes = useStoryScenes();
  const states = useQuery(
    "SELECT ps.*, c.name AS holder FROM prop_state ps " +
    "LEFT JOIN character c ON c.id = ps.custody_character_id " +
    "WHERE ps.prop_id = ?", [id]);
  const present = useQuery(
    "SELECT sp.scene_id, sp.significance, v.name AS variant FROM scene_prop sp " +
    "LEFT JOIN prop_variant v ON v.id = sp.variant_id AND v.prop_id = sp.prop_id " +
    "WHERE sp.prop_id = ?", [id]);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const label = (s: Record<string, unknown>): string =>
    [s["name"], s["condition"]].map((v) =>
      v === null || v === undefined || v === "" ? null : String(v))
      .find((v) => v !== null) ?? "state";
  const lane: Lane = {
    kind: "stages", key: "prop-states", label: "States",
    stages: states.map((s) => ({
      id: Number(s["id"]),
      sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
      label: label(s),
    })),
    onAddAt: (sceneId) => {
      setSelected(null);
      setPending({ table: "prop_state", parentId: id, sceneId,
                   laneLabel: "the prop" });
    },
    onSelect: (s) => { setPending(null); setSelected(s); },
  };
  // Who holds it is the state in force's custody: the same latest-wins
  // reach, labelled by the holder.
  const holders: Lane = {
    kind: "stages", key: "prop-holder", label: "Held by",
    stages: states.map((s) => ({
      id: Number(s["id"]),
      sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
      // An empty custody column says nothing about who has it — it is
      // not "nobody", and the strip must not claim it is.
      label: s["holder"] === null || s["holder"] === undefined
        ? "not said" : String(s["holder"]),
    })),
  };
  const presence: MarkLane = useMemo(() => {
    const marks: MarkLane["marks"] = new Map();
    for (const p of present) {
      const sig = p["significance"] === null || p["significance"] === undefined
        ? "present" : String(p["significance"]);
      marks.set(Number(p["scene_id"]), {
        text: sig + (p["variant"] === null || p["variant"] === undefined
          ? "" : `, as ${String(p["variant"])}`),
        strength: sig === "background" || sig === "mentioned" ? "weak" : "strong",
      });
    }
    return { kind: "marks", key: "prop-present", label: "In the scene", marks };
  }, [present]);

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-pstory">
        <h3 id="ws-s-pstory">Through the story</h3>
        <p className="ws-section-note">
          Click a scene in the States row to say what has happened to it by
          then — its condition, where it is, who has it. Each state holds
          until the next.
        </p>
        <StoryStrip scenes={scenes} lanes={[lane, holders, presence]}
                    selectedStage={selected}
                    caption="The prop across the scenes" />
        {pending !== null && (
          <AddStageForm pending={pending} scenes={scenes}
                        onCancel={() => setPending(null)}
                        onDone={(s) => { setPending(null); setSelected(s); }} />
        )}
        {selected !== null && states.some((s) => Number(s["id"]) === selected) && (
          <StageEditor table="prop_state" id={selected}
                       onRemoved={() => setSelected(null)} />
        )}
      </section>
    </div>
  );
}

/** The scenes it is in — linked, and tagged in the script. */
function PropScenes({ id }: { id: number }): JSX.Element {
  const { deleteRow, openScriptAt, asOfSceneId } = useStore();
  const scenes = useStoryScenes();
  const index = useSceneIndex();
  const links = useQuery("SELECT * FROM scene_prop WHERE prop_id = ?", [id]);
  const variants = useQuery(
    "SELECT id, name FROM prop_variant WHERE prop_id = ? AND " +
    "(lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id", [id]);
  const tags = useQuery(
    "SELECT id, tagged_text, line_uuid FROM screenplay_prop_tags WHERE prop_id = ?",
    [id]);
  const states = useQuery(
    "SELECT id, scene_id, name, condition FROM prop_state WHERE prop_id = ?", [id]);
  const [pick, setPick] = useState("");
  const significance = registry.entities.get("scene_prop")?.fields
    .find((f) => f.name === "significance")?.options ?? [];
  const order = scenes.map((s) => s.id);
  const layout = layoutStages(order, states.map((s) => ({
    id: Number(s["id"]),
    sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]) })));
  const stateIn = (sceneId: number): string | null => {
    const sid = stageAt(layout, order.indexOf(sceneId));
    const st = states.find((s) => Number(s["id"]) === sid);
    return st === undefined ? null
      : String(st["name"] ?? st["condition"] ?? "a state");
  };
  const linked = [...links].sort((a, b) =>
    order.indexOf(Number(a["scene_id"])) - order.indexOf(Number(b["scene_id"])));
  const linkedIds = new Set(links.map((l) => Number(l["scene_id"])));
  const save = (linkId: number, field: string, value: string): void => {
    setField(exec, registry, "scene_prop", linkId, field,
             value === "" ? null : field === "variant_id" ? Number(value) : value)
      .then(() => useStore.getState().noteWrite())
      .catch((e: unknown) => fail("Could not save", e));
  };

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-pscenes">
        <h3 id="ws-s-pscenes">Scenes</h3>
        <table className="scn-table">
          <thead>
            <tr>
              <th scope="col">Scene</th>
              <th scope="col">How it matters</th>
              {variants.length > 0 && <th scope="col">Version</th>}
              <th scope="col">State there</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {linked.map((l) => {
              const sid = Number(l["scene_id"]);
              const s = scenes.find((x) => x.id === sid);
              const linkId = Number(l["id"]);
              const heading = index?.headingLine.get(sid);
              return (
                <tr key={linkId} className={sid === asOfSceneId ? "scn-asof" : undefined}>
                  <th scope="row">
                    <span className="scn-num">{s?.number ?? "?"}</span>
                    <span className="scn-name">{s?.name}</span>
                  </th>
                  <td>
                    <select aria-label={`Significance in scene ${s?.number ?? ""}`}
                            value={String(l["significance"] ?? "")}
                            onChange={(e) => save(linkId, "significance",
                                                  e.target.value)}>
                      <option value="">—</option>
                      {significance.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  {variants.length > 0 && (
                    <td>
                      <select aria-label={`Version in scene ${s?.number ?? ""}`}
                              value={l["variant_id"] === null ||
                                l["variant_id"] === undefined
                                ? "" : String(l["variant_id"])}
                              onChange={(e) => save(linkId, "variant_id",
                                                    e.target.value)}>
                        <option value="">as itself</option>
                        {variants.map((v) => (
                          <option key={String(v["id"])} value={String(v["id"])}>
                            {String(v["name"])}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="scn-detail">{stateIn(sid) ?? "—"}</td>
                  <td className="scn-actions">
                    {heading !== undefined && (
                      <button className="ghost tiny"
                              onClick={() => openScriptAt(heading)}>
                        Open in script
                      </button>
                    )}
                    <button className="ghost tiny"
                            onClick={() => void deleteRow("scene_prop", linkId)}>
                      Unlink
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <select aria-label="Add to a scene" value={pick} className="ws-add-select"
                onChange={(e) => {
                  const v = e.target.value;
                  setPick("");
                  if (v === "") return;
                  linkPropToScene(exec, id, Number(v))
                    .then(() => useStore.getState().noteWrite())
                    .catch((err: unknown) => fail("Could not link", err));
                }}>
          <option value="">+ add to a scene</option>
          {scenes.filter((s) => !linkedIds.has(s.id)).map((s) => (
            <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
          ))}
        </select>
      </section>

      <section className="ws-section" aria-labelledby="ws-s-ptags">
        <h3 id="ws-s-ptags">Tagged in the script</h3>
        {tags.length === 0 ? (
          <p className="muted">
            Not tagged yet. Select its words in the Script and use “tag prop”.
          </p>
        ) : (
          <ul className="ws-records">
            {tags.map((t) => {
              const lineId = String(t["line_uuid"] ?? "");
              const sid = index?.sceneOfLine.get(lineId);
              const s = scenes.find((x) => x.id === sid);
              return (
                <li key={String(t["id"])}>
                  <button className="row-link" onClick={() => openScriptAt(lineId)}>
                    “{String(t["tagged_text"] ?? "")}”
                    <span className="muted"> — {s === undefined
                      ? "line no longer in the script" : `sc ${s.number}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
