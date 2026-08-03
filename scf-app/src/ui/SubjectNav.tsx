import { useState } from "react";
import { useQuery } from "./useQuery.ts";
import { registry, rowName, useStore } from "../state/store.ts";
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
      <div className="subject-list">
        {rows.map((r) => {
          const id = r["id"] as number;
          const name = rowName(subjectType, r);
          const active = selectedSubject?.entity === subjectType &&
                         selectedSubject.id === id;
          return (
            <button key={id}
                    className={"subject-item" + (active ? " active" : "")}
                    onClick={() =>
                      selectSubject({ entity: subjectType, id, name })}>
              {name}
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="rail-empty">
            No {edef?.labelPlural.toLowerCase() ?? subjectType} yet.
          </p>
        )}
      </div>
    </div>
  );
}
