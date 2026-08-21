// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { useQuery } from "./useQuery.ts";
import { registry, rowName, useStore } from "../state/store.ts";
import {
  compareSubjects, subjectStatsSql, type SubjectSort, type SubjectStat,
} from "../state/subjectStats.ts";
import { useRefNames } from "./useRefNames.ts";
import { NAVIGABLE_SUBJECTS, type NavigableSubject }
  from "../state/registryGraph.ts";
import { q } from "@scf-core/db.ts";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN,
} from "@scf-core/structure.ts";

/**
 * Subject-oriented navigation — the default mode. Pick a subject type,
 * then an instance; the SubjectView shows everything addressed to it.
 */
export function SubjectNav(): JSX.Element {
  const { selectedSubject, selectSubject } = useStore();
  const { subjectType, setSubjectType } = useStore();
  const [sort, setSort] = useState<SubjectSort>("name");
  const edef = registry.entities.get(subjectType);
  const nameField = edef?.nameField ?? "name";
  // SELECT * rather than id+name: a row's label may live in another
  // column entirely (a scene's number, a shot's shot_number), and
  // fetching two columns is what made every scene read "unnumbered"
  // and every shot "Shot #1".
  const rows = useQuery(
    subjectType === "scene"
      ? `SELECT s.* FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`
      : subjectType === "shot"
        ? "SELECT * FROM shot ORDER BY scene_id, shot_order, id"
        : `SELECT * FROM ${q(subjectType)} ORDER BY ${q(nameField)}`);

  // Anything that sits in a scene says which one, on the left where it
  // reads as part of the name.
  const scenePlaced = edef !== undefined && subjectType !== "scene" &&
    edef.fields.some((f) => f.name === "scene_id");
  const sceneNames = useRefNames(scenePlaced ? ["scene"] : []);

  // Only fetched when a mode needs it — A–Z costs nothing extra.
  const statsSql = useMemo(
    () => subjectStatsSql(registry, subjectType), [subjectType]);
  const statRows = useQuery(sort === "name" ? null : statsSql);
  const stats = useMemo(() => {
    const map = new Map<number, SubjectStat>();
    for (const r of statRows) {
      map.set(Number(r["sid"]), {
        uses: Number(r["uses"]),
        scenes: Number(r["scenes"]),
        firstNumber: Number(r["first_number"]),
        firstSceneId: Number(r["first_scene_id"]),
      });
    }
    return map;
  }, [statRows]);

  const items = useMemo(() => rows
    .map((r) => {
      const id = r["id"] as number;
      return { id, row: r, name: rowName(subjectType, r),
               stat: stats.get(id) };
    })
    .sort((a, b) => compareSubjects(sort, a, b)),
    [rows, stats, sort, subjectType]);

  return (
    <div className="subject-nav">
      <select className="subject-type"
              value={subjectType}
              onChange={(e) => {
                setSubjectType(e.target.value as NavigableSubject);
                selectSubject(null);
              }}>
        {NAVIGABLE_SUBJECTS.filter((s) => registry.entities.has(s))
          .map((s) => (
            <option key={s} value={s}>
              {registry.entities.get(s)?.labelPlural ?? s}
            </option>
          ))}
      </select>
      <select className="subject-sort" value={sort}
              onChange={(e) => setSort(e.target.value as SubjectSort)}
              title={statsSql === null
                ? "Nothing ties these to a scene, so only A–Z applies"
                : "Order of the list below"}>
        <option value="name">A–Z</option>
        <option value="story" disabled={statsSql === null}>
          first appearance
        </option>
        <option value="uses" disabled={statsSql === null}>
          most used
        </option>
      </select>
      <div className="subject-list">
        {items.map(({ id, row: r, name, stat }) => {
          const active = selectedSubject?.entity === subjectType &&
                         selectedSubject.id === id;
          return (
            <button key={id}
                    className={"subject-item" + (active ? " active" : "")}
                    onClick={() =>
                      selectSubject({ entity: subjectType, id, name })}>
              {scenePlaced && (
                <span className="subject-item-scene">
                  {sceneNames("scene", r["scene_id"]) ?? "—"}
                </span>
              )}
              <span className="subject-item-name">{name}</span>
              {sort !== "name" && stat !== undefined && (
                <span className="subject-item-stat">
                  {sort === "uses"
                    ? `${String(stat.scenes)} sc`
                    : stat.firstNumber >= 1e9
                      ? "—" : `sc ${String(stat.firstNumber)}`}
                </span>
              )}
            </button>
          );
        })}
        {items.length === 0 && (
          <p className="rail-empty">
            No {edef?.labelPlural.toLowerCase() ?? subjectType} yet.
          </p>
        )}
      </div>
    </div>
  );
}
