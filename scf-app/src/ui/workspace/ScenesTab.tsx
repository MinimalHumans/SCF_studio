// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { statesInForce } from "@scf-core/resolution.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  presenceByScene, readScriptPresence, type ScriptPresence,
} from "../../editor/characterPresence.ts";
import { linkToScene, setField } from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import {
  StoryStrip, useStoryScenes, type MarkLane, type StripScene,
} from "./StoryStrip.tsx";
import { usePresenceLane } from "./StageParts.tsx";

const NOT_CUT = (a: string): string =>
  `(${a}.lifecycle_status IS NULL OR ${a}.lifecycle_status <> 'cut')`;
const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/** The script's view of this character, re-read on every write. */
function useScriptPresence(characterId: number): ScriptPresence | null {
  const revision = useStore((s) => s.revision);
  const [p, setP] = useState<ScriptPresence | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readScriptPresence(exec, characterId).then((r) => {
      if (!cancelled) setP(r);
    });
    return () => { cancelled = true; };
  }, [characterId, revision]);
  return p;
}

/**
 * The character's footprint in the film: where they are, what they say,
 * the shots they are in, what they carry, what they stand for. Mostly a
 * read view; scene links are edited here because this is where a writer
 * looks at them.
 */
export function ScenesTab({ characterId }: { characterId: number }):
    JSX.Element {
  const scenes = useStoryScenes();
  const script = useScriptPresence(characterId);
  const links = useQuery(
    "SELECT * FROM scene_character WHERE character_id = ?", [characterId]);
  const rows = useMemo(() => script === null ? []
    : presenceByScene(scenes.map((s) => s.id), links, script),
    [scenes, links, script]);
  const presence = usePresenceLane(characterId, "In the scene");
  const speaks: MarkLane = useMemo(() => {
    const marks: MarkLane["marks"] = new Map();
    for (const r of rows) {
      if (r.speeches > 0) {
        marks.set(r.sceneId, { text: `${String(r.speeches)} speech` +
          `${r.speeches === 1 ? "" : "es"}`, strength: "strong" });
      }
    }
    return { kind: "marks", key: "speaks", label: "Speaks", marks };
  }, [rows]);
  const silent = rows.filter((r) => r.mismatch === "silent").length;
  const unlinked = rows.filter((r) => r.mismatch === "unlinked").length;

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-presence">
        <h3 id="ws-s-presence">Through the film</h3>
        <p className="ws-section-note">
          {rows.length === 0
            ? "Not in any scene yet."
            : `In ${String(rows.filter((r) => r.link !== null).length)} ` +
              `scene${rows.filter((r) => r.link !== null).length === 1 ? "" : "s"}, ` +
              `speaking in ${String(rows.filter((r) => r.speeches > 0).length)}.` +
              (unlinked > 0 ? ` Speaks in ${String(unlinked)} not linked.` : "") +
              (silent > 0 ? ` Silent in ${String(silent)} written scene` +
                `${silent === 1 ? "" : "s"} they are linked to.` : "")}
        </p>
        <StoryStrip scenes={scenes} lanes={[presence, speaks]}
                    caption="Where this character is, and where they speak" />
      </section>

      <SceneList characterId={characterId} scenes={scenes} rows={rows}
                 script={script} />
      <Lines scenes={scenes} script={script} />
      <Shots characterId={characterId} scenes={scenes} />
      <Carries characterId={characterId} />
      <Themes characterId={characterId} />
    </div>
  );
}

function SceneList({ characterId, scenes, rows, script }: {
  characterId: number; scenes: StripScene[];
  rows: ReturnType<typeof presenceByScene>; script: ScriptPresence | null;
}): JSX.Element {
  const { deleteRow, openScriptAt, asOfSceneId } = useStore();
  const [pick, setPick] = useState("");
  const variants = useQuery(
    "SELECT id, name FROM character_variant v WHERE character_id = ? AND " +
    `${NOT_CUT("v")} ORDER BY id`, [characterId]);
  const worn = useQuery(
    "SELECT cs.scene_id, c.name FROM costume_scene cs JOIN costume c " +
    `ON c.id = cs.costume_id WHERE c.character_id = ? AND ${NOT_CUT("c")}`,
    [characterId]);
  const roles = registry.entities.get("scene_character")?.fields
    .find((f) => f.name === "role_in_scene")?.options ?? [];
  const linked = new Set(rows.filter((r) => r.link !== null)
    .map((r) => r.sceneId));
  const states = useStatesByScene(characterId, rows.map((r) => r.sceneId));

  const save = (linkId: number, field: string, value: string): void => {
    setField(exec, registry, "scene_character", linkId, field,
             value === "" ? null : field === "variant_id" ? Number(value) : value)
      .then(() => useStore.getState().noteWrite())
      .catch((e: unknown) => fail("Could not save", e));
  };

  return (
    <section className="ws-section" aria-labelledby="ws-s-scenes">
      <h3 id="ws-s-scenes">Scenes</h3>
      <table className="scn-table">
        <thead>
          <tr>
            <th scope="col">Scene</th>
            <th scope="col">As</th>
            {variants.length > 0 && <th scope="col">Version</th>}
            <th scope="col">Lines</th>
            <th scope="col">Wearing, and in what state</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = scenes.find((x) => x.id === r.sceneId);
            const link = r.link;
            const linkId = link === null ? null : Number(link["id"]);
            const wearing = worn.filter((w) => Number(w["scene_id"]) === r.sceneId)
              .map((w) => String(w["name"]));
            const inForce = states.get(r.sceneId) ?? [];
            const heading = script?.headingLine.get(r.sceneId);
            return (
              <tr key={r.sceneId}
                  className={r.sceneId === asOfSceneId ? "scn-asof" : undefined}>
                <th scope="row">
                  <span className="scn-num">{s?.number ?? "?"}</span>
                  <span className="scn-name">{s?.name}</span>
                  {r.mismatch === "unlinked" && (
                    <span className="scn-flag" title="They speak here, but nothing links them to the scene.">
                      speaks, not linked
                    </span>
                  )}
                  {r.mismatch === "silent" && (
                    <span className="scn-flag quiet"
                          title="Linked and the scene is written, but they never speak. Fine for a silent presence.">
                      silent here
                    </span>
                  )}
                </th>
                <td>
                  {link === null || linkId === null ? (
                    <button className="tiny" onClick={() => {
                      linkToScene(exec, characterId, r.sceneId)
                        .then(() => useStore.getState().noteWrite())
                        .catch((e: unknown) => fail("Could not link", e));
                    }}>Link to scene</button>
                  ) : (
                    <select aria-label={`Role in scene ${s?.number ?? ""}`}
                            value={String(link["role_in_scene"] ?? "")}
                            onChange={(e) => save(linkId, "role_in_scene",
                                                  e.target.value)}>
                      <option value="">seen</option>
                      {roles.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </td>
                {variants.length > 0 && (
                  <td>
                    {linkId !== null && link !== null && (
                      <select aria-label={`Version in scene ${s?.number ?? ""}`}
                              value={link["variant_id"] === null ||
                                link["variant_id"] === undefined
                                ? "" : String(link["variant_id"])}
                              onChange={(e) => save(linkId, "variant_id",
                                                    e.target.value)}>
                        <option value="">as themselves</option>
                        {variants.map((v) => (
                          <option key={String(v["id"])} value={String(v["id"])}>
                            {String(v["name"])}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                )}
                <td className="scn-count">{r.speeches === 0 ? "—" : r.speeches}</td>
                <td className="scn-detail">
                  {[...wearing, ...inForce].join(" · ") || <span className="muted">—</span>}
                </td>
                <td className="scn-actions">
                  {heading !== undefined && (
                    <button className="ghost tiny"
                            onClick={() => openScriptAt(heading)}>
                      Open in script
                    </button>
                  )}
                  {linkId !== null && (
                    <button className="ghost tiny"
                            onClick={() => void deleteRow("scene_character", linkId)}>
                      Unlink
                    </button>
                  )}
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
                linkToScene(exec, characterId, Number(v))
                  .then(() => useStore.getState().noteWrite())
                  .catch((err: unknown) => fail("Could not link", err));
              }}>
        <option value="">+ add to a scene</option>
        {scenes.filter((s) => !linked.has(s.id)).map((s) => (
          <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
        ))}
      </select>
    </section>
  );
}

/** Performance states in force per scene, by name — Q05/Q06's rule. */
function useStatesByScene(characterId: number,
                          sceneIds: number[]): Map<number, string[]> {
  const revision = useStore((s) => s.revision);
  const [map, setMap] = useState<Map<number, string[]>>(new Map());
  const key = sceneIds.join(",");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out = new Map<number, string[]>();
      for (const id of sceneIds) {
        const states = await statesInForce({ exec, registry }, characterId, id);
        if (states.length > 0) {
          out.set(id, states.map((st) => String(st["name"] ?? "a state")));
        }
      }
      if (!cancelled) setMap(out);
    })();
    return () => { cancelled = true; };
  }, [characterId, key, revision]);  // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}

function Lines({ scenes, script }: {
  scenes: StripScene[]; script: ScriptPresence | null;
}): JSX.Element {
  const { openScriptAt, asOfSceneId } = useStore();
  if (script === null) return <section className="ws-section" />;
  const groups = new Map<number | null, typeof script.speeches>();
  for (const s of script.speeches) {
    const list = groups.get(s.sceneId) ?? [];
    list.push(s);
    groups.set(s.sceneId, list);
  }
  const order = [...scenes.map((s) => s.id), null]
    .filter((id) => groups.has(id));
  return (
    <section className="ws-section" aria-labelledby="ws-s-lines">
      <h3 id="ws-s-lines">Lines</h3>
      {script.speeches.length === 0 ? (
        <p className="muted">
          No lines yet. Lines appear here once a cue in the script is
          linked to this character.
        </p>
      ) : (
        <div className="lines">
          {order.map((sceneId) => {
            const s = scenes.find((x) => x.id === sceneId);
            return (
              <div key={String(sceneId)}
                   className={"lines-scene" + (sceneId === asOfSceneId
                                               ? " scn-asof" : "")}>
                <h4>{s === undefined ? "Before the first scene"
                  : `sc ${s.number} — ${s.name}`}</h4>
                {(groups.get(sceneId) ?? []).map((sp) => (
                  <button key={sp.cueOrder} className="speech"
                          title="Open the script at this line"
                          onClick={() => openScriptAt(sp.cueUuid)}>
                    <span className="speech-cue">{sp.cue}</span>
                    {sp.parts.map((p, i) => (
                      <span key={i} className={`speech-${p.kind}`}>{p.text}</span>
                    ))}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Shots({ characterId, scenes }: {
  characterId: number; scenes: StripScene[];
}): JSX.Element | null {
  const { openEntityRow } = useStore();
  const shots = useQuery(
    "SELECT sc.id AS link_id, sc.framing, sc.facing, s.id, s.name, " +
    "s.shot_number, s.scene_id FROM shot_character sc " +
    "JOIN shot s ON s.id = sc.shot_id WHERE sc.character_id = ? " +
    `AND ${NOT_CUT("s")} ORDER BY s.scene_id, s.shot_order, s.id`,
    [characterId]);
  if (shots.length === 0) return null;
  const order = new Map(scenes.map((s, i) => [s.id, i]));
  const sorted = [...shots].sort((a, b) =>
    (order.get(Number(a["scene_id"])) ?? 1e9) -
    (order.get(Number(b["scene_id"])) ?? 1e9));
  return (
    <section className="ws-section" aria-labelledby="ws-s-shots">
      <h3 id="ws-s-shots">Shots</h3>
      <ul className="ws-records">
        {sorted.map((r) => {
          const s = scenes.find((x) => x.id === Number(r["scene_id"]));
          const how = [r["framing"], r["facing"]]
            .filter((v) => v !== null && v !== undefined && v !== "")
            .map(String).join(", ");
          return (
            <li key={String(r["link_id"])}>
              <button className="row-link" onClick={() =>
                void openEntityRow("shot", Number(r["id"]))}>
                <strong>{String(r["shot_number"] ?? r["name"] ?? "shot")}</strong>
                {" "}<span className="muted">sc {s?.number ?? "?"}</span>
                {how !== "" && <> — {how}</>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Props that are theirs, and props they hold at some point. */
function Carries({ characterId }: { characterId: number }): JSX.Element | null {
  const { openEntityRow } = useStore();
  const owned = useQuery(
    `SELECT p.id, p.name, p.prop_type FROM prop p WHERE ` +
    `p.associated_character_id = ? AND ${NOT_CUT("p")} ORDER BY p.name`,
    [characterId]);
  const held = useQuery(
    "SELECT ps.id, ps.name AS state_name, p.id AS prop_id, p.name, " +
    "s.scene_number FROM prop_state ps JOIN prop p ON p.id = ps.prop_id " +
    "LEFT JOIN scene s ON s.id = ps.scene_id " +
    "WHERE ps.custody_character_id = ? ORDER BY s.id", [characterId]);
  if (owned.length === 0 && held.length === 0) return null;
  return (
    <section className="ws-section" aria-labelledby="ws-s-carries">
      <h3 id="ws-s-carries">Things they carry</h3>
      <ul className="ws-records">
        {owned.map((p: Row) => (
          <li key={`o${String(p["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("prop", Number(p["id"]))}>
              <strong>{String(p["name"])}</strong>
              <span className="muted"> — theirs{p["prop_type"] !== null &&
                p["prop_type"] !== undefined ? `, ${String(p["prop_type"])}` : ""}</span>
            </button>
          </li>
        ))}
        {held.map((p: Row) => (
          <li key={`h${String(p["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("prop_state", Number(p["id"]))}>
              <strong>{String(p["name"])}</strong>
              <span className="muted"> — holds it from sc{" "}
                {String(p["scene_number"] ?? "?")}
                {p["state_name"] !== null && p["state_name"] !== undefined
                  ? ` (${String(p["state_name"])})` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Themes({ characterId }: { characterId: number }): JSX.Element | null {
  const { openEntityRow } = useStore();
  const themes = useQuery(
    "SELECT tc.id, tc.nature_of_connection, t.name FROM thematic_connection tc " +
    "JOIN theme t ON t.id = tc.theme_id WHERE tc.entity_type = 'character' " +
    `AND tc.entity_id = ? AND ${NOT_CUT("tc")} ORDER BY t.name`, [characterId]);
  const motifs = useQuery(
    "SELECT ma.id, m.name, s.scene_number, ma.domain FROM motif_appearance ma " +
    "JOIN motif m ON m.id = ma.motif_id LEFT JOIN scene s ON s.id = ma.scene_id " +
    "WHERE ma.entity_type = 'character' AND ma.entity_id = ? ORDER BY s.id",
    [characterId]);
  if (themes.length === 0 && motifs.length === 0) return null;
  return (
    <section className="ws-section" aria-labelledby="ws-s-themes">
      <h3 id="ws-s-themes">What they stand for</h3>
      <ul className="ws-records">
        {themes.map((t) => (
          <li key={`t${String(t["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("thematic_connection", Number(t["id"]))}>
              <strong>{String(t["name"])}</strong>
              <span className="muted"> — {String(t["nature_of_connection"] ??
                "connected")}</span>
            </button>
          </li>
        ))}
        {motifs.map((m) => (
          <li key={`m${String(m["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("motif_appearance", Number(m["id"]))}>
              <strong>{String(m["name"])}</strong>
              <span className="muted"> — motif, sc {String(m["scene_number"] ?? "?")}
                {m["domain"] !== null && m["domain"] !== undefined
                  ? `, ${String(m["domain"])}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
