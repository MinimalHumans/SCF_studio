// SPDX-License-Identifier: Apache-2.0
/**
 * BundleReach — on a bundle: who it resolves for, and a way to say so.
 *
 * A bundle with assets in it looks finished and reaches nobody until a
 * binding names a subject (spec §7). That state was invisible in the
 * editor and cost the first MCP session its most useful framing plate,
 * so the bundle form now answers "resolves for whom?" directly and
 * offers the binding in place.
 *
 * Only the scene range is offered as scoping. The binding tables carry
 * other filters (variant, time of day, conditions) that the media
 * cascade does not read today; authoring a column nothing resolves
 * would produce a binding that looks scoped and applies everywhere.
 */

import { useEffect, useState } from "react";
import {
  BINDING_SUBJECTS, bindBundle, bundleReach,
  type BindingSubject, type BundleReach as Reach,
} from "@scf-core/bundling.ts";
import { sceneOrder } from "@scf-core/resolution.ts";
import { q } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../state/store.ts";

interface SceneOption { id: number; label: string }

/** Active scenes in story order (§4.1), labelled by number and name. */
async function scenesInStoryOrder(): Promise<SceneOption[]> {
  const order = await sceneOrder({ exec, registry });
  const rows = await exec(
    `SELECT id, scene_number, name FROM ${q("scene")}`);
  return rows
    .filter((r) => order.has(Number(r["id"])))
    .sort((a, b) => (order.get(Number(a["id"])) ?? 0)
                  - (order.get(Number(b["id"])) ?? 0))
    .map((r) => ({
      id: Number(r["id"]),
      label: `${r["scene_number"] === null ? "—" : String(r["scene_number"])}` +
        `${r["name"] === null ? "" : ` · ${String(r["name"])}`}`,
    }));
}

function rangeText(reach: Reach, scenes: readonly SceneOption[]): string {
  const name = (id: number | null): string | null => id === null
    ? null : scenes.find((s) => s.id === id)?.label.split(" · ")[0]
      ?? `#${id}`;
  if (reach.shotId !== null) return `shot override`;
  const start = name(reach.sceneRangeStartId);
  const end = name(reach.sceneRangeEndId);
  if (start === null && end === null) {
    return reach.isBaseline === true ? "baseline, every scene"
      : "every scene, not a baseline";
  }
  if (start !== null && start === end) return `scene ${start} only`;
  return `scenes ${start ?? "start"}–${end ?? "end"}`;
}

export function BundleReachSection({ bundleId }: {
  bundleId: number;
}): JSX.Element {
  const { openEntityRow, noteWrite, revision } = useStore();
  const [reach, setReach] = useState<Reach[] | null>(null);
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    void (async () => {
      setReach(await bundleReach(exec, registry, bundleId));
      setScenes(await scenesInStoryOrder());
    })();
  }, [bundleId, revision]);

  if (reach === null) return <section className="bundle-reach" />;

  return (
    <section className="bundle-reach">
      <h4>Resolves for</h4>
      {reach.length === 0 && (
        <p className="bundle-unbound">
          Bound to nothing — this bundle resolves for no subject at any
          scene, so no media query will return its assets.
        </p>
      )}
      <ul className="bundle-member-list">
        {reach.map((r) => (
          <li key={`${r.entity}-${r.rowId}`}>
            <button className="ghost tiny bundle-member-name"
                    onClick={() => { void openEntityRow(r.entity, r.rowId); }}>
              {r.subjectName ?? `${r.subjectType} #${r.subjectId ?? "?"}`}
            </button>
            <span className="muted">{r.subjectType}</span>
            <span className={
              r.shotId === null && r.isBaseline !== true
              && r.sceneRangeStartId === null && r.sceneRangeEndId === null
                ? "bundle-reach-wide" : "muted"}>
              {rangeText(r, scenes)}
            </span>
            {r.rowName !== null && (
              <span className="mono muted bundle-member-id">{r.rowName}</span>
            )}
          </li>
        ))}
      </ul>
      {!binding && (
        <button className="tiny" onClick={() => setBinding(true)}>
          Bind to…
        </button>
      )}
      {binding && (
        <BindForm bundleId={bundleId} scenes={scenes}
                  onDone={(wrote) => {
                    setBinding(false);
                    if (wrote) noteWrite();
                  }} />
      )}
    </section>
  );
}

function BindForm({ bundleId, scenes, onDone }: {
  bundleId: number;
  scenes: readonly SceneOption[];
  onDone: (wrote: boolean) => void;
}): JSX.Element {
  const [subjectType, setSubjectType] = useState<BindingSubject>("character");
  const [subjects, setSubjects] = useState<{ id: number; name: string }[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [baseline, setBaseline] = useState(true);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const rows = await exec(
        `SELECT id, name FROM ${q(subjectType)} ` +
        `WHERE lifecycle_status IS NULL OR lifecycle_status <> 'cut' ` +
        `ORDER BY name, id`);
      const list = rows.map((r) => ({
        id: Number(r["id"]),
        name: r["name"] === null ? `#${String(r["id"])}` : String(r["name"]),
      }));
      setSubjects(list);
      setSubjectId(list[0]?.id ?? null);
    })();
  }, [subjectType]);

  // A scoped binding is a state, not a baseline: a scene-less query asks
  // for baselines only, and would otherwise return this state as the
  // subject's default look.
  const ranged = start !== null || end !== null;

  const submit = (): void => {
    if (subjectId === null) return;
    void (async () => {
      const id = await bindBundle(exec, subjectType, subjectId, bundleId, {
        isBaseline: ranged ? false : baseline,
        sceneRangeStartId: start, sceneRangeEndId: end,
        precedence: ranged ? 1 : 0,
      });
      if (id === null) {
        setNote("Already bound to that subject over that range.");
        return;
      }
      onDone(true);
    })();
  };

  const sceneSelect = (value: number | null,
                       set: (v: number | null) => void,
                       open: string): JSX.Element => (
    <select value={value ?? ""}
            onChange={(e) => set(e.target.value === ""
              ? null : Number(e.target.value))}>
      <option value="">{open}</option>
      {scenes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );

  return (
    <div className="bundle-bind-form">
      <select value={subjectType}
              onChange={(e) =>
                setSubjectType(e.target.value as BindingSubject)}>
        {BINDING_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={subjectId ?? ""}
              onChange={(e) => setSubjectId(Number(e.target.value))}>
        {subjects.length === 0 && <option value="">none in this file</option>}
        {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <span className="muted">from</span>
      {sceneSelect(start, setStart, "the start")}
      <span className="muted">to</span>
      {sceneSelect(end, setEnd, "the end")}
      <label className="muted" title={ranged
        ? "A binding scoped to scenes is a state, not the subject's baseline."
        : "In force at every scene, and returned when no scene is asked."}>
        <input type="checkbox" checked={ranged ? false : baseline}
               disabled={ranged}
               onChange={(e) => setBaseline(e.target.checked)} />
        baseline
      </label>
      <button className="tiny primary" disabled={subjectId === null}
              onClick={submit}>
        Bind
      </button>
      <button className="ghost tiny" onClick={() => onDone(false)}>
        Cancel
      </button>
      {note !== null && <span className="invalid-note">{note}</span>}
      <p className="help">
        Story order runs by the script, not by scene number. Other binding
        filters (variant, time of day) are not offered: nothing resolves
        them yet.
      </p>
    </div>
  );
}
