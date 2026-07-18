import { useMemo, useState } from "react";
import { q } from "@scf-core/db.ts";
import type { Row } from "@scf-core/db.ts";
import type { EntityDef } from "@scf-core/registry.ts";
import { referenceGraph, registry, rowName, useStore }
  from "../state/store.ts";
import { scopeRank } from "../state/registryGraph.ts";
import { useQuery } from "./useQuery.ts";
import { PositionPicker, ReadinessPanel } from "./ReadinessPanel.tsx";
import { JunctionQuickAdd } from "./fields/JunctionQuickAdd.tsx";

/**
 * SubjectView — "all things Eleanor": every row addressed to the selected
 * subject, grouped by scope, global -> moment. The default navigation
 * mode; the view the Phase A ontology was built for.
 *
 * Position-aware: a position picker sets the scene in context. Readiness
 * findings for the subject render at that position (Q02/Q05/Q06 for
 * characters, Q07/Q08 for scenes), and position-keyed sections render the
 * scene spine with in-force spans — keyed cells solid, reach dimmed,
 * current position outlined.
 */
export function SubjectView(): JSX.Element | null {
  const { selectedSubject, openEntityRow } = useStore();
  const subject = selectedSubject;
  const scenes = useQuery(
    "SELECT id, scene_number, name FROM scene " +
    "ORDER BY (scene_number IS NULL), scene_number, id");
  const [pickedScene, setPickedScene] = useState<number | null>(null);
  const [pickedShot, setPickedShot] = useState<number | null>(null);
  const shots = useQuery(
    subject?.entity === "scene"
      ? "SELECT id, name FROM shot WHERE scene_id = ? " +
        "ORDER BY (shot_order IS NULL), shot_order, id"
      : null,
    subject?.entity === "scene" ? [subject.id] : []);
  if (subject === null) return null;

  // For scene subjects the position IS the subject.
  const sceneId = subject.entity === "scene" ? subject.id
    : pickedScene ?? (scenes[0]?.["id"] as number | undefined) ?? null;

  const refs = referenceGraph.get(subject.entity) ?? [];
  const grouped = [...refs].sort((a, b) => {
    const ea = registry.entities.get(a.fromEntity);
    const eb = registry.entities.get(b.fromEntity);
    return scopeRank(ea?.scope ?? null) - scopeRank(eb?.scope ?? null) ||
           (ea?.tier ?? 9) - (eb?.tier ?? 9) ||
           a.fromEntity.localeCompare(b.fromEntity);
  });

  return (
    <div className="subject-view">
      <header className="subject-header">
        <span className="subject-kind">
          {registry.entities.get(subject.entity)?.label}
        </span>
        <h2>{subject.name}</h2>
        {subject.entity === "character" && (
          <PositionPicker scenes={scenes} sceneId={sceneId}
                          onChange={setPickedScene} />
        )}
        {subject.entity === "scene" && shots.length > 0 && (
          <label className="position-picker">
            <span>shot</span>
            <select value={pickedShot === null ? "" : String(pickedShot)}
                    onChange={(e) =>
                      setPickedShot(e.target.value === ""
                        ? null : Number(e.target.value))}>
              <option value="">scene-level</option>
              {shots.map((s) => (
                <option key={String(s["id"])} value={String(s["id"])}>
                  {String(s["name"])}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="ghost"
                onClick={() =>
                  void openEntityRow(subject.entity, subject.id)}>
          Edit {registry.entities.get(subject.entity)?.label.toLowerCase()}
        </button>
      </header>

      <ReadinessPanel subjectEntity={subject.entity} subjectId={subject.id}
                      sceneId={sceneId} shotId={pickedShot} />

      {grouped.map(({ fromEntity, field }) => (
        <SubjectSection key={`${fromEntity}.${field}`}
                        entity={fromEntity} field={field}
                        subjectId={subject.id} scenes={scenes}
                        currentSceneId={sceneId} />
      ))}
      {grouped.length === 0 && (
        <p className="muted">Nothing in the format points at
           {" "}{registry.entities.get(subject.entity)?.labelPlural
             .toLowerCase()}.</p>
      )}
    </div>
  );
}

interface Span { start: number; end: number; keyed: number; }

function SubjectSection({ entity, field, subjectId, scenes,
                          currentSceneId }: {
  entity: string; field: string; subjectId: number; scenes: Row[];
  currentSceneId: number | null;
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  const { openEntityRow, deleteRow } = useStore();
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE ${q(field)} = ?`, [subjectId]);

  const positionKeyed = edef !== undefined &&
    edef.positionPattern !== "none" &&
    edef.fields.some((f) => f.name === "scene_id");
  const isJunction = edef?.subject === "link";

  const pos = useMemo(
    () => new Map(scenes.map((s, i) => [s["id"], i])), [scenes]);

  const ordered = useMemo(() => {
    if (!positionKeyed) return rows;
    return [...rows].sort((a, b) =>
      (pos.get(a["scene_id"]) as number ?? 1e9) -
      (pos.get(b["scene_id"]) as number ?? 1e9));
  }, [rows, pos, positionKeyed]);

  const spans = useMemo<Span[]>(() => {
    if (!positionKeyed || edef === undefined) return [];
    return computeSpans(edef, ordered, pos, scenes.length);
  }, [positionKeyed, edef, ordered, pos, scenes.length]);

  if (edef === undefined) return null;
  if (rows.length === 0 && !isJunction) return null;

  return (
    <section className="subject-section">
      <h3>
        <span className="tree-icon">{edef.icon}</span>
        {edef.labelPlural}
        <span className="scope-tag">{edef.scope ?? "global"}</span>
        {edef.positionPattern !== "none" && (
          <span className="pattern-tag">{edef.positionPattern}</span>
        )}
      </h3>
      {positionKeyed && scenes.length > 0 && rows.length > 0 && (
        <SceneSpine scenes={scenes} spans={spans}
                    currentSceneId={currentSceneId} />
      )}
      <ul className="subject-rows">
        {ordered.map((r) => (
          <li key={String(r["id"])}>
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(entity, r["id"] as number)}>
              {rowName(entity, r)}
            </button>
            {positionKeyed && (
              <span className="row-scene">
                {sceneLabel(scenes, r["scene_id"])}
                {spanSuffix(edef, r, scenes)}
              </span>
            )}
            {isJunction && (
              <button className="ghost tiny" title="Remove link"
                      aria-label="Remove link"
                      onClick={() =>
                        void deleteRow(entity, r["id"] as number)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {isJunction && (
        <JunctionQuickAdd edef={edef} anchorField={field}
                          anchorId={subjectId} />
      )}
    </section>
  );
}

/**
 * In-force reach per row, in story-position indices:
 *  - sparse_persistence: until_resolved rows reach to resolved_at
 *    (exclusive) or the end; scene_only rows are a single cell.
 *  - latest_wins: each row reaches until the next row takes over; the
 *    last row reaches the end.
 *  - explicit: one cell per row (pattern 1 is explicit rows only).
 */
function computeSpans(edef: EntityDef, ordered: Row[],
                      pos: Map<unknown, number>,
                      sceneCount: number): Span[] {
  const spans: Span[] = [];
  const last = sceneCount - 1;
  ordered.forEach((r, i) => {
    const keyed = pos.get(r["scene_id"]);
    if (keyed === undefined) return;
    let end = keyed;
    if (edef.positionPattern === "sparse_persistence") {
      const persistence = r["persistence"] ?? "scene_only";
      if (persistence === "until_resolved") {
        const resolved = pos.get(r["resolved_at_scene_id"]);
        end = resolved !== undefined ? Math.max(keyed, resolved - 1) : last;
      }
    } else if (edef.positionPattern === "latest_wins") {
      const next = ordered[i + 1];
      const nextPos = next !== undefined
        ? pos.get(next["scene_id"]) : undefined;
      end = nextPos !== undefined ? Math.max(keyed, nextPos - 1) : last;
    }
    spans.push({ start: keyed, end, keyed });
  });
  return spans;
}

function spanSuffix(edef: EntityDef, r: Row, scenes: Row[]): string {
  if (edef.positionPattern === "sparse_persistence" &&
      (r["persistence"] ?? "") === "until_resolved") {
    const resolved = scenes.find((s) => s["id"] === r["resolved_at_scene_id"]);
    return resolved !== undefined
      ? ` → resolved ${sceneLabel(scenes, resolved["id"])}`
      : " → open";
  }
  return "";
}

function sceneLabel(scenes: Row[], sceneId: unknown): string {
  const s = scenes.find((x) => x["id"] === sceneId);
  if (s === undefined) return "";
  const n = s["scene_number"];
  return n !== null && n !== undefined ? `sc ${String(n)}` : "unplaced";
}

/**
 * The scene spine — one cell per story position. Solid cells are keyed
 * rows, dimmed cells are in-force reach, the outlined cell is the
 * position in context.
 */
function SceneSpine({ scenes, spans, currentSceneId }: {
  scenes: Row[]; spans: Span[]; currentSceneId: number | null;
}): JSX.Element {
  const keyed = new Set(spans.map((s) => s.keyed));
  const inSpan = (i: number): boolean =>
    spans.some((s) => i > s.start && i <= s.end);
  return (
    <div className="spine" role="img"
         aria-label={`${spans.length} row(s) across ${scenes.length} scenes`}>
      {scenes.map((s, i) => (
        <span key={String(s["id"])}
              title={`sc ${String(s["scene_number"] ?? "?")} — ` +
                     `${String(s["name"] ?? "")}`}
              className={"spine-cell" +
                (keyed.has(i) ? " keyed" : inSpan(i) ? " reach" : "") +
                (s["id"] === currentSceneId ? " here" : "")} />
      ))}
    </div>
  );
}
