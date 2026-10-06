// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  compareSubjects, subjectStatsSql, type SubjectSort, type SubjectStat,
} from "../../state/subjectStats.ts";
import { useQuery } from "../useQuery.ts";
import { CharacterFace } from "./CharacterFace.tsx";
import {
  charactersNamed, cleanName, createCharacter,
} from "../../editor/elementOps.ts";

/**
 * Every character, with a way to make another at the top.
 *
 * Creating asks only for a name — the workspace opens on the new
 * character with the rest to fill in. A name that already exists is
 * asked about rather than refused: two characters may share one, but a
 * duplicate made by accident splits every cue match and scene link.
 */
export function CharacterRail(): JSX.Element {
  const { selectedCharacterId, selectCharacter, setCharacterTab } =
    useStore();
  const [sort, setSort] = useState<SubjectSort>("story");
  const [filter, setFilter] = useState("");
  const [showCut, setShowCut] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [clash, setClash] = useState<Array<{ id: number; name: string }>>([]);

  const rows = useQuery(
    "SELECT id, name, role, lifecycle_status FROM character ORDER BY name");
  const statsSql = useMemo(() => subjectStatsSql(registry, "character"), []);
  const statRows = useQuery(statsSql);
  const stats = useMemo(() => {
    const map = new Map<number, SubjectStat>();
    for (const r of statRows) {
      map.set(Number(r["sid"]), {
        uses: Number(r["uses"]), scenes: Number(r["scenes"]),
        firstNumber: Number(r["first_number"]),
        firstSceneId: Number(r["first_scene_id"]),
      });
    }
    return map;
  }, [statRows]);

  const cutCount = rows.filter((r) => r["lifecycle_status"] === "cut").length;
  const needle = filter.trim().toLowerCase();
  const items = rows
    .filter((r) => showCut || r["lifecycle_status"] !== "cut")
    .map((r) => ({
      id: Number(r["id"]), name: String(r["name"] ?? ""),
      role: r["role"] === null ? null : String(r["role"]),
      cut: r["lifecycle_status"] === "cut",
      stat: stats.get(Number(r["id"])),
    }))
    .filter((c) => needle === "" || c.name.toLowerCase().includes(needle))
    .sort((a, b) => compareSubjects(sort, a, b));

  const finishCreate = async (force: boolean): Promise<void> => {
    const name = cleanName(draftName);
    if (name === null) return;
    if (!force) {
      const same = await charactersNamed(exec, name);
      if (same.length > 0) {
        setClash(same.map((r) => ({ id: Number(r["id"]),
                                    name: String(r["name"]) })));
        return;
      }
    }
    try {
      const id = await createCharacter(exec, name);
      useStore.getState().noteWrite();
      setCreating(false);
      setDraftName("");
      setClash([]);
      setCharacterTab("Profile");
      selectCharacter(id);
    } catch (e) {
      useStore.setState({ errorMessage: `Could not create the character: ${
        e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className="ws-rail">
      {creating ? (
        <form className="ws-create"
              onSubmit={(e) => { e.preventDefault(); void finishCreate(false); }}>
          <label htmlFor="ws-new-character">Name the new character</label>
          <input id="ws-new-character" autoFocus value={draftName}
                 onChange={(e) => { setDraftName(e.target.value); setClash([]); }}
                 onKeyDown={(e) => {
                   if (e.key === "Escape") {
                     setCreating(false); setDraftName(""); setClash([]);
                   }
                 }} />
          {clash.length > 0 ? (
            <div className="ws-clash" role="alert">
              <p>A character with this name already exists.</p>
              <button type="button" onClick={() => {
                const first = clash[0];
                if (first !== undefined) selectCharacter(first.id);
                setCreating(false); setDraftName(""); setClash([]);
              }}>Open {clash[0]?.name}</button>
              <button type="button" className="ghost"
                      onClick={() => void finishCreate(true)}>
                Create another
              </button>
            </div>
          ) : (
            <div className="ws-create-actions">
              <button type="submit" className="primary"
                      disabled={cleanName(draftName) === null}>Create</button>
              <button type="button" className="ghost" onClick={() => {
                setCreating(false); setDraftName("");
              }}>Cancel</button>
            </div>
          )}
        </form>
      ) : (
        <button className="primary ws-new" onClick={() => setCreating(true)}>
          New character
        </button>
      )}

      <div className="ws-rail-tools">
        <input type="search" placeholder="Filter" value={filter}
               aria-label="Filter characters"
               onChange={(e) => setFilter(e.target.value)} />
        <select value={sort} aria-label="Order"
                onChange={(e) => setSort(e.target.value as SubjectSort)}>
          <option value="story">First appearance</option>
          <option value="uses">Most used</option>
          <option value="name">A–Z</option>
        </select>
      </div>

      <ul className="ws-list" aria-label="Characters">
        {items.map((c) => (
          <li key={c.id}>
            <button className={"ws-list-item" +
                               (c.id === selectedCharacterId ? " active" : "") +
                               (c.cut ? " cut" : "")}
                    aria-current={c.id === selectedCharacterId
                                  ? "true" : undefined}
                    onClick={() => selectCharacter(c.id)}>
              <CharacterFace id={c.id} name={c.name} />
              <span className="ws-list-text">
                <span className="ws-list-name">{c.name}</span>
                <span className="ws-list-meta">
                  {c.cut ? "cut" : c.role ?? "no role yet"}
                </span>
              </span>
              <span className="ws-list-count"
                    title="Scenes this character is tied to">
                {c.stat?.scenes ?? 0}
              </span>
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="rail-empty">
            {rows.length === 0
              ? "No characters yet."
              : "Nobody matches that filter."}
          </li>
        )}
      </ul>
      {cutCount > 0 && (
        <label className="ws-show-cut">
          <input type="checkbox" checked={showCut}
                 onChange={(e) => setShowCut(e.target.checked)} />
          Show {cutCount} cut
        </label>
      )}
    </div>
  );
}
