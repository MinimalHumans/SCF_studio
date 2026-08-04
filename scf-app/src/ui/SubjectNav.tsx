import { useMemo, useState } from "react";
import { useQuery } from "./useQuery.ts";
import { registry, rowName, useStore } from "../state/store.ts";
import {
  compareSubjects, subjectStatsSql, type SubjectSort, type SubjectStat,
} from "../state/subjectStats.ts";
import { NAVIGABLE_SUBJECTS, type NavigableSubject }
  from "../state/registryGraph.ts";
import { q } from "@scf-core/db.ts";

/**
 * Subject-oriented navigation — the default mode. Pick a subject type,
 * then an instance; the SubjectView shows everything addressed to it.
 */
export function SubjectNav(): JSX.Element {
  const { selectedSubject, selectSubject } = useStore();
  const [subjectType, setSubjectType] =
    useState<NavigableSubject>("character");
  const [sort, setSort] = useState<SubjectSort>("name");
  const edef = registry.entities.get(subjectType);
  const nameField = edef?.nameField ?? "name";
  // Scenes need their number to be identified at all, and list in story
  // order; SELECT id, name left every one of them reading "unnumbered".
  const rows = useQuery(
    subjectType === "scene"
      ? "SELECT id, scene_number, name FROM scene " +
        "ORDER BY (scene_number IS NULL), scene_number, id"
      : `SELECT id, ${q(nameField)} FROM ${q(subjectType)} ` +
        `ORDER BY ${q(nameField)}`);

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
      return { id, name: rowName(subjectType, r), stat: stats.get(id) };
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
        {items.map(({ id, name, stat }) => {
          const active = selectedSubject?.entity === subjectType &&
                         selectedSubject.id === id;
          return (
            <button key={id}
                    className={"subject-item" + (active ? " active" : "")}
                    onClick={() =>
                      selectSubject({ entity: subjectType, id, name })}>
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
