// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { q } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  addStage, STAGE_LABEL, STAGE_PARENT,
} from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import type { MarkLane, StripScene } from "./StoryStrip.tsx";

export interface PendingStage {
  table: string;
  parentId: number;
  sceneId: number;
  laneLabel: string;
}

/** The one-field form a click on the strip opens: name the stage. */
export function AddStageForm({ pending, scenes, onDone, onCancel }: {
  pending: PendingStage;
  scenes: StripScene[];
  onDone: (id: number) => void;
  onCancel: () => void;
}): JSX.Element {
  const [label, setLabel] = useState("");
  const scene = scenes.find((s) => s.id === pending.sceneId);
  useEffect(() => { setLabel(""); }, [pending.sceneId, pending.parentId]);
  return (
    <form className="ws-add-row strip-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            addStage(exec, pending.table, pending.parentId, pending.sceneId,
                     label).then((id) => {
              useStore.getState().noteWrite();
              onDone(id);
            }).catch((err: unknown) => useStore.setState({
              errorMessage: `Could not add the stage: ${
                err instanceof Error ? err.message : String(err)}` }));
          }}>
      <label htmlFor="ws-new-stage">
        New stage in <strong>{pending.laneLabel}</strong>, from sc{" "}
        {scene?.number}
      </label>
      <input id="ws-new-stage" autoFocus value={label}
             placeholder="A short label, e.g. “walls up”"
             onChange={(e) => setLabel(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <button type="submit" disabled={label.trim() === ""}>Add stage</button>
      <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}

/**
 * Edit one stage: its label, where it starts, and the rest of its own
 * fields. Read from the registry, so a prop's state shows who holds it
 * and where it is, and an arc stage its description, without a list
 * per table.
 */
export function StageEditor({ table, id, onRemoved }: {
  table: string; id: number; onRemoved: () => void;
}): JSX.Element | null {
  const { deleteRow, openEntityRow } = useStore();
  const row = useQuery(`SELECT * FROM ${q(table)} WHERE id = ?`, [id])[0];
  if (row === undefined) return null;
  const labelField = STAGE_LABEL[table] ?? "stage_label";
  const others = (registry.entities.get(table)?.fields ?? []).filter((f) =>
    f.autoInjected !== true && f.hidden !== true &&
    f.name !== labelField && f.name !== "scene_id" && f.name !== "name" &&
    f.name !== STAGE_PARENT[table]);
  const short = others.filter((f) => f.fieldType !== "textarea");
  const long = others.filter((f) => f.fieldType === "textarea");
  return (
    <article className="ws-card strip-stage-editor">
      <div className="ws-grid">
        <AutoField entity={table} id={id} field={labelField}
                   value={row[labelField] ?? null} label="Stage"
                   showHelp={false} />
        <AutoField entity={table} id={id} field="scene_id"
                   value={row["scene_id"] ?? null} label="Starts at"
                   showHelp={false} />
        {short.map((f) => (
          <AutoField key={f.name} entity={table} id={id} field={f.name}
                     value={row[f.name] ?? null} showHelp={false} />
        ))}
      </div>
      <div className="ws-stack">
        {long.map((f) => (
          <AutoField key={f.name} entity={table} id={id} field={f.name}
                     value={row[f.name] ?? null} showHelp={false} />
        ))}
      </div>
      <div className="ws-row-actions">
        <button className="ghost tiny"
                onClick={() => void openEntityRow(table, id)}>
          Open record
        </button>
        <button className="ghost tiny" onClick={() => {
          void deleteRow(table, id).then(onRemoved);
        }}>Remove stage</button>
      </div>
    </article>
  );
}

const STRONG = new Set(["featured", "supporting"]);

/**
 * Where a character is, as a marks lane: solid where they are on screen
 * in a featured or supporting role, faint where they are background,
 * only mentioned, or only heard (§2.4.1).
 */
export function usePresenceLane(characterId: number, label: string):
    MarkLane {
  const rows = useQuery(
    "SELECT sc.scene_id, sc.role_in_scene, v.name AS variant " +
    "FROM scene_character sc LEFT JOIN character_variant v " +
    "ON v.id = sc.variant_id AND v.character_id = sc.character_id " +
    "WHERE sc.character_id = ?", [characterId]);
  return useMemo(() => {
    const marks: MarkLane["marks"] = new Map();
    for (const r of rows) {
      const role = r["role_in_scene"] === null ||
        r["role_in_scene"] === undefined ? "in scene" : String(r["role_in_scene"]);
      const variant = r["variant"] === null || r["variant"] === undefined
        ? "" : ` as ${String(r["variant"])}`;
      marks.set(Number(r["scene_id"]), {
        text: role + variant,
        strength: r["role_in_scene"] === null ||
          r["role_in_scene"] === undefined ||
          STRONG.has(String(r["role_in_scene"])) ? "strong" : "weak",
      });
    }
    return { kind: "marks", key: `presence-${String(characterId)}`,
             label, marks };
  }, [rows, characterId, label]);
}

/**
 * Performance shifts of one modality as a marks lane: solid at the
 * scene a state is keyed to, faint across the scenes an until-resolved
 * state persists into (§4.5 pattern 2).
 */
export function useShiftLane(characterId: number, modality: string,
                             label: string, scenes: StripScene[]): MarkLane {
  const rows = useQuery(
    "SELECT scene_id, persistence, resolved_at_scene_id, " +
    "state_description, name FROM performance_state " +
    "WHERE character_id = ? AND modality = ? AND scene_id IS NOT NULL " +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut')",
    [characterId, modality]);
  return useMemo(() => {
    const marks: MarkLane["marks"] = new Map();
    const index = new Map(scenes.map((s, i) => [s.id, i]));
    for (const r of rows) {
      const text = String(r["state_description"] ?? r["name"] ?? modality);
      const start = index.get(Number(r["scene_id"]));
      if (start === undefined) continue;
      if (r["persistence"] === "until_resolved") {
        const stop = r["resolved_at_scene_id"] === null
          ? scenes.length
          : index.get(Number(r["resolved_at_scene_id"])) ?? scenes.length;
        for (let i = start + 1; i < stop; i += 1) {
          const id = scenes[i]?.id;
          if (id !== undefined && !marks.has(id)) {
            marks.set(id, { text: `${text} (persisting)`, strength: "weak" });
          }
        }
      }
      const sceneId = scenes[start]?.id;
      if (sceneId !== undefined) marks.set(sceneId, { text, strength: "strong" });
    }
    return { kind: "marks", key: `${modality}-${String(characterId)}`,
             label, marks };
  }, [rows, scenes, characterId, modality, label]);
}
