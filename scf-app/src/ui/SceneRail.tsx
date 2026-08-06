/**
 * SceneRail — the script surface's nav rail.
 *
 * The script is a flat document, but it has a structure over it, so the
 * rail shows both: acts and sequences where they are defined, scenes
 * under them, in screenplay order. Structure here is derived from the
 * boundaries exactly as everywhere else (scf-core/src/structure.ts), so
 * a sequence that crosses an act boundary shows in both acts as the
 * part of it that belongs there — grouped by run, not by where it
 * starts.
 *
 * The filters answer the question the rail is usually being scanned
 * for: "which scenes have X in them". A scene is kept when it holds the
 * chosen character, prop, or location; an act or sequence is kept when
 * any of its scenes survive, so the tree collapses to just the places
 * that matter rather than going blank.
 */

import { useMemo, useState } from "react";
import { actOutline, deriveStructure } from "@scf-core/structure.ts";
import { sceneLabel } from "../state/displayName.ts";
import { useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";
import { scriptViewHandle } from "./ScriptView.tsx";

type FilterKind = "character" | "prop" | "location";

const FILTER_SQL: Record<FilterKind, { list: string; scenes: string }> = {
  character: {
    list: "SELECT DISTINCT c.id, c.name FROM character c " +
          "JOIN scene_character sc ON sc.character_id = c.id ORDER BY c.name",
    scenes: "SELECT scene_id FROM scene_character WHERE character_id = ?",
  },
  prop: {
    list: "SELECT DISTINCT p.id, p.name FROM prop p " +
          "JOIN scene_prop sp ON sp.prop_id = p.id ORDER BY p.name",
    scenes: "SELECT scene_id FROM scene_prop WHERE prop_id = ?",
  },
  location: {
    list: "SELECT DISTINCT l.id, l.name FROM location l " +
          "JOIN scene s ON s.location_id = l.id ORDER BY l.name",
    scenes: "SELECT id AS scene_id FROM scene WHERE location_id = ?",
  },
};

export function SceneRail(): JSX.Element {
  const { openEntityRow } = useStore();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<FilterKind>("character");
  const [subjectId, setSubjectId] = useState<string>("");

  const headings = useQuery(
    "SELECT sl.line_order, sl.content, sl.scene_id " +
    "FROM screenplay_lines sl WHERE sl.line_type = 'heading' " +
    "ORDER BY sl.line_order");
  const scenes = useQuery("SELECT id, scene_number, name FROM scene");
  const acts = useQuery(
    "SELECT id, name, act_number, start_scene_id FROM act");
  const sequences = useQuery(
    "SELECT id, name, sequence_number, start_scene_id FROM sequence");

  const choices = useQuery(FILTER_SQL[kind].list);
  const matching = useQuery(
    subjectId === "" ? null : FILTER_SQL[kind].scenes, [Number(subjectId)]);
  const allowed = useMemo(
    () => subjectId === ""
      ? null : new Set(matching.map((r) => Number(r["scene_id"]))),
    [subjectId, matching]);

  const structure = useMemo(
    () => deriveStructure(scenes, acts, sequences),
    [scenes, acts, sequences]);
  const sceneById = useMemo(
    () => new Map(scenes.map((s) => [Number(s["id"]), s])), [scenes]);
  const headingFor = useMemo(() => {
    const map = new Map<number, number>();
    for (const h of headings) {
      const id = h["scene_id"];
      if (id !== null && !map.has(Number(id))) {
        map.set(Number(id), Number(h["line_order"]));
      }
    }
    return map;
  }, [headings]);

  const keep = (sceneId: number): boolean =>
    allowed === null || allowed.has(sceneId);
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const act of structure.acts) {
      keys.push(`act:${String(act.id)}`);
      for (const group of actOutline(structure, act)) {
        if (group.sequence !== null) {
          keys.push(`act:${String(act.id)}:seq:${String(group.sequence.id)}`);
        }
      }
    }
    return keys;
  }, [structure]);
  const allCollapsed = collapsed.size >= allKeys.length && allKeys.length > 0;

  const sceneRow = (sceneId: number): JSX.Element | null => {
    if (!keep(sceneId)) return null;
    const scene = sceneById.get(sceneId);
    const lineOrder = headingFor.get(sceneId);
    const number = scene?.["scene_number"];
    return (
      <li key={sceneId} className="rail-scene">
        <span className="rail-number">
          {number === null || number === undefined ? "—" : String(number)}
        </span>
        <button className="scene-jump"
                disabled={lineOrder === undefined}
                title={lineOrder === undefined
                  ? "This scene has no heading in the script yet" : ""}
                onClick={() => {
                  if (lineOrder !== undefined) {
                    scriptViewHandle.scrollToLineOrder?.(lineOrder);
                  }
                }}>
          {String(scene?.["name"] ?? sceneLabel(scene))}
        </button>
        <button className="scene-chip" title="Open the scene record"
                onClick={() => void openEntityRow("scene", sceneId)}>
          ⛭
        </button>
      </li>
    );
  };

  // Headings the structure knows nothing about: no scene link yet, or a
  // scene sitting before the first act boundary.
  const placed = new Set(structure.acts.flatMap((a) => a.sceneIds));
  const loose = headings
    .map((h) => (h["scene_id"] === null ? null : Number(h["scene_id"])))
    .filter((id): id is number => id !== null && !placed.has(id));
  const unlinked = headings.filter((h) => h["scene_id"] === null);

  return (
    <nav className="scene-rail" aria-label="scenes">
      <div className="rail-head">
        <span>Scenes ({headings.length})</span>
        {allKeys.length > 0 && (
          <button className="ghost tiny"
                  onClick={() => setCollapsed(
                    allCollapsed ? new Set() : new Set(allKeys))}>
            {allCollapsed ? "expand all" : "collapse all"}
          </button>
        )}
      </div>

      <div className="rail-filter">
        <select value={kind}
                onChange={(e) => {
                  setKind(e.target.value as FilterKind);
                  setSubjectId("");
                }}>
          <option value="character">character</option>
          <option value="prop">prop</option>
          <option value="location">location</option>
        </select>
        <select value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">all scenes</option>
          {choices.map((c) => (
            <option key={String(c["id"])} value={String(c["id"])}>
              {String(c["name"])}
            </option>
          ))}
        </select>
      </div>
      {allowed !== null && (
        <div className="rail-filter-note">
          {allowed.size} scene{allowed.size === 1 ? "" : "s"}
        </div>
      )}

      <ul className="rail-tree">
        {structure.acts.map((act) => {
          const visible = act.sceneIds.filter(keep);
          if (visible.length === 0) return null;
          const key = `act:${String(act.id)}`;
          const open = !collapsed.has(key);
          return (
            <li key={key}>
              <div className="rail-span rail-act">
                <button className="rail-caret" onClick={() => toggle(key)}
                        aria-expanded={open}>{open ? "▾" : "▸"}</button>
                <span className="rail-number">
                  {act.number === null ? "—" : String(act.number)}
                </span>
                <span className="rail-span-name">{act.name}</span>
                <button className="scene-chip" title="Open the act record"
                        onClick={() => void openEntityRow("act", act.id)}>
                  ⛭
                </button>
              </div>
              {open && (
                <ul>
                  {actOutline(structure, act).map((group, i) => {
                    const inGroup = group.sceneIds.filter(keep);
                    if (inGroup.length === 0) return null;
                    if (group.sequence === null) {
                      // No sequence over these scenes: list them at the
                      // act's level rather than indenting for an empty
                      // grouping.
                      return (
                        <li key={`bare:${String(i)}`} className="rail-flat">
                          {group.sceneIds.map(sceneRow)}
                        </li>
                      );
                    }
                    const seq = group.sequence;
                    const seqKey = `${key}:seq:${String(seq.id)}`;
                    const seqOpen = !collapsed.has(seqKey);
                    return (
                      <li key={seqKey}>
                        <div className="rail-span rail-seq">
                          <button className="rail-caret"
                                  onClick={() => toggle(seqKey)}
                                  aria-expanded={seqOpen}>
                            {seqOpen ? "▾" : "▸"}
                          </button>
                          <span className="rail-number">
                            {seq.number === null ? "—" : String(seq.number)}
                          </span>
                          <span className="rail-span-name">
                            {seq.name}
                            {group.continuesFrom && " …cont"}
                            {group.continuesInto && " cont…"}
                          </span>
                          <button className="scene-chip"
                                  title="Open the sequence record"
                                  onClick={() => void openEntityRow(
                                    "sequence", seq.id)}>⛭</button>
                        </div>
                        {seqOpen && <ul>{group.sceneIds.map(sceneRow)}</ul>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}

        {loose.length > 0 && loose.some(keep) && (
          <li>
            <div className="rail-span rail-loose">
              <span className="rail-span-name">
                {structure.acts.length === 0
                  ? "No structure yet" : "Before the first act"}
              </span>
            </div>
            <ul>{loose.map(sceneRow)}</ul>
          </li>
        )}

        {allowed === null && unlinked.map((h) => (
          <li key={`u${String(h["line_order"])}`} className="rail-scene">
            <span className="rail-number">·</span>
            <button className="scene-jump"
                    title="This heading is not linked to a scene yet"
                    onClick={() => scriptViewHandle.scrollToLineOrder?.(
                      h["line_order"] as number)}>
              {String(h["content"])}
            </button>
          </li>
        ))}

        {headings.length === 0 && (
          <li className="muted rail-empty">no screenplay yet</li>
        )}
      </ul>
    </nav>
  );
}
