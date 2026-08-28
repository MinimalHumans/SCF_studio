// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { q } from "@scf-core/db.ts";
import type { Row } from "@scf-core/db.ts";
import type { EntityDef } from "@scf-core/registry.ts";
import { referenceGraph, registry, rowName, useStore }
  from "../state/store.ts";
import {
  isComposedLink, linkLabel, linkQualifiers, referenceFields,
  sceneLabel, sceneShort, shotLabel,
} from "../state/displayName.ts";
import { useRefNames } from "./useRefNames.ts";
import { ANCHOR_SUBJECTS, AnchorThumb } from "./AnchorThumb.tsx";
import { scopeRank } from "../state/registryGraph.ts";
import { useQuery } from "./useQuery.ts";
import { PositionPicker, ReadinessPanel } from "./ReadinessPanel.tsx";
import { JunctionQuickAdd } from "./fields/JunctionQuickAdd.tsx";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN,
} from "@scf-core/structure.ts";

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
    `SELECT s.id, s.scene_number, s.name FROM scene s ` +
    `${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`);
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
        {ANCHOR_SUBJECTS.includes(subject.entity) && (
          <AnchorThumb subjectType={subject.entity} subjectId={subject.id}
                       size="lg" />
        )}
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
                  {shotLabel(s)}
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

      <SubjectFacts entity={subject.entity} id={subject.id} />

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

/**
 * The subject's OWN authored fields, read-only.
 *
 * Until now this page showed only what points AT the subject, which is
 * right for a character (their scenes, their costumes) and useless for
 * a shot, whose whole substance — size, angle, movement, lens — lives
 * on the row itself. A shot page was a title and an Edit button.
 */
function SubjectFacts({ entity, id }: {
  entity: string; id: number;
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
  const row = rows[0];
  const refs = useMemo(() => edef === undefined ? []
    : referenceFields(edef).map((f) => f.referenceEntity as string),
    [edef]);
  const refNames = useRefNames(refs);
  if (edef === undefined || row === undefined) return null;

  const shown = edef.fields.filter((f) => {
    if (f.hidden === true || f.name === edef.nameField) return false;
    if (f.autoInjected) return false;
    const v = row[f.name];
    return v !== null && v !== undefined && v !== "";
  });
  if (shown.length === 0) return null;

  return (
    <section className="subject-facts">
      <dl className="kv-out">
        {shown.map((f) => (
          <div key={f.name}>
            <dt>{f.label}</dt>
            <dd>
              {f.fieldType === "reference" && f.referenceEntity !== undefined
                ? refNames(f.referenceEntity, row[f.name])
                  ?? String(row[f.name])
                : String(row[f.name])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SubjectSection({ entity, field, subjectId, scenes,
                          currentSceneId }: {
  entity: string; field: string; subjectId: number; scenes: Row[];
  currentSceneId: number | null;
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  const { openEntityRow, deleteRow } = useStore();
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE ${q(field)} = ?`, [subjectId]);

  const isJunction = edef?.subject === "link";
  const composed = isComposedLink(edef);
  // The far ends of a link — the near end is the subject we are looking
  // from, and repeating it on every row says nothing.
  const targets = useMemo(() => edef === undefined || !composed ? []
    : referenceFields(edef)
        .filter((f) => f.name !== field)
        .map((f) => f.referenceEntity as string),
    [edef, composed, field]);
  const refNames = useRefNames(targets);

  // Which column ties a row to a story position. Position pattern
  // governs SPAN semantics, not this: a link has no pattern but still
  // sits at a scene. And a scene row IS a position — it keys on its own
  // id, which is what gives a location its spine.
  const sceneKey = edef === undefined ? null
    : edef.name === "scene" ? "id"
    : edef.fields.some((f) => f.name === "scene_id") ? "scene_id"
    : null;
  const scenePlaced = sceneKey !== null;
  const positionKeyed = edef !== undefined &&
    edef.positionPattern !== "none" && scenePlaced;

  const pos = useMemo(
    () => new Map(scenes.map((s, i) => [s["id"], i])), [scenes]);

  const ordered = useMemo(() => {
    if (sceneKey === null) return rows;
    return [...rows].sort((a, b) =>
      (pos.get(a[sceneKey]) as number ?? 1e9) -
      (pos.get(b[sceneKey]) as number ?? 1e9));
  }, [rows, pos, sceneKey]);

  const spans = useMemo<Span[]>(() => {
    if (sceneKey === null || edef === undefined) return [];
    return computeSpans(edef, ordered, pos, scenes.length, sceneKey);
  }, [edef, ordered, pos, scenes.length, sceneKey]);

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
      {scenePlaced && scenes.length > 0 && rows.length > 0 && (
        <SceneSpine scenes={scenes} spans={spans}
                    currentSceneId={currentSceneId} />
      )}
      <ul className="subject-rows">
        {ordered.map((r) => (
          <li key={String(r["id"])}>
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(entity, r["id"] as number)}>
              {(composed
                ? linkLabel(edef, r, refNames, field) : null)
                ?? rowName(entity, r)}
            </button>
            {isJunction && linkQualifiers(edef, r).map((qual) => (
              <span key={qual} className="scope-tag">{qual}</span>
            ))}
            {positionKeyed && (
              <span className="row-scene">
                {sceneShort(scenes.find((s) => s["id"] === r["scene_id"]))}
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
                      sceneCount: number, sceneKey: string): Span[] {
  const spans: Span[] = [];
  const last = sceneCount - 1;
  ordered.forEach((r, i) => {
    const keyed = pos.get(r[sceneKey]);
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
        ? pos.get(next[sceneKey]) : undefined;
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
      ? ` → resolved ${sceneShort(resolved)}`
      : " → open";
  }
  return "";
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
              title={sceneLabel(s)}
              className={"spine-cell" +
                (keyed.has(i) ? " keyed" : inSpan(i) ? " reach" : "") +
                (s["id"] === currentSceneId ? " here" : "")} />
      ))}
    </div>
  );
}
