// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, type ReactNode } from "react";
import { useStore } from "../../state/store.ts";
import { KINDS, type SubjectKind } from "../../state/subjectKinds.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { CharacterFace } from "./CharacterFace.tsx";
import { useStoryScenes } from "./StoryStrip.tsx";

/** Where each subject's tab was scrolled to, so "open record" and back
 *  lands where the writer was. Per session; not worth persisting. */
const scrollMemory = new Map<string, number>();

/** Values as words, not tokens: "int/ext", "digital double". */
export const words = (v: unknown): string | null =>
  v === null || v === undefined || v === ""
    ? null : String(v).replace(/_/g, " ");

/**
 * The frame every narrative-element workspace shares: the subject's
 * face and name, chips, the "as of scene" control, "Open record", and
 * the subtabs. The kind decides the tabs and their contents; the frame
 * is the same, so a writer moving from a character to a location finds
 * everything where they left it.
 */
export function SubjectShell({ kind, id, tabs, tab, onTab, chips, empty,
                               children }: {
  kind: SubjectKind;
  id: number | null;
  tabs: readonly string[];
  tab: string;
  onTab: (tab: string) => void;
  /** Chips under the name, worked out from the subject's row. */
  chips: (row: Record<string, unknown>) => string[];
  /** What the empty main panel says when nothing exists yet. */
  empty: string;
  /** The open tab's content. */
  children: (id: number) => ReactNode;
}): JSX.Element {
  const spec = KINDS[kind];
  const openEntityRow = useStore((s) => s.openEntityRow);
  const count = useQuery(`SELECT COUNT(*) AS n FROM ${kind}`);
  const row = useQuery(id === null ? null
    : `SELECT * FROM ${kind} WHERE id = ?`, id === null ? [] : [id])[0];
  const variants = useQuery(id === null ? null
    : `SELECT id, name FROM ${spec.variantEntity} WHERE ${kind}_id = ? ` +
      "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id",
    id === null ? [] : [id]);

  const memoryKey = `${kind}:${String(id)}:${tab}`;
  useLayoutEffect(() => {
    const pane = document.querySelector(".main-panel");
    if (pane === null) return;
    pane.scrollTop = scrollMemory.get(memoryKey) ?? 0;
    const remember = (): void => {
      scrollMemory.set(memoryKey, pane.scrollTop);
    };
    pane.addEventListener("scroll", remember, { passive: true });
    return () => pane.removeEventListener("scroll", remember);
  }, [memoryKey]);

  if (id === null || row === undefined) {
    const none = Number(count[0]?.["n"] ?? 0) === 0;
    return (
      <div className="empty-main">
        <p>{none ? empty
          : `Pick a ${spec.noun} on the left, or make a new one.`}</p>
      </div>
    );
  }

  const label = spec.noun.charAt(0).toUpperCase() + spec.noun.slice(1);
  return (
    <div className="ws">
      <header className="ws-header">
        <CharacterFace id={id} name={String(row["name"] ?? "")} size="md"
                       kind={kind} />
        <div className="ws-header-main">
          <div className="ws-name">
            <AutoField key={`name-${kind}-${String(id)}`} entity={kind} id={id}
                       field="name" value={(row["name"] ?? null) as never}
                       label={`${label} name`} showHelp={false} />
          </div>
          <div className="ws-chips">
            {row["lifecycle_status"] === "cut" && (
              <span className="ws-chip ws-chip-cut">cut</span>
            )}
            {chips(row).map((c) => <span key={c} className="ws-chip">{c}</span>)}
            {variants.map((v) => (
              <span key={String(v["id"])} className="ws-chip ws-chip-variant"
                    title={`A variant of this ${spec.noun}`}>
                {String(v["name"])}
              </span>
            ))}
          </div>
        </div>
        <div className="ws-header-side">
          <AsOfScene kind={kind} id={id} />
          <button className="ghost tiny ws-open-record"
                  onClick={() => void openEntityRow(kind, id)}>
            Open record
          </button>
        </div>
      </header>

      <div className="ws-tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab}
                  className={t === tab ? "active" : ""}
                  onClick={() => onTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tab}>{children(id)}</div>
    </div>
  );
}

/**
 * "As of scene": pick a scene and every tab shows what is in force there
 * using the same resolution the queries use. Off by default, so the tabs
 * show baselines. Kept across subjects. Scenes this one is in are marked.
 */
function AsOfScene({ kind, id }: { kind: SubjectKind; id: number }):
    JSX.Element {
  const { asOfSceneId, setAsOfScene } = useStore();
  const scenes = useStoryScenes();
  const present = new Set(useQuery(KINDS[kind].presenceSql, [id])
    .map((r) => Number(r["scene_id"])));
  return (
    <label className={"ws-asof" + (asOfSceneId !== null ? " on" : "")}>
      <span>As of</span>
      <select value={asOfSceneId === null ? "" : String(asOfSceneId)}
              onChange={(e) => setAsOfScene(e.target.value === ""
                ? null : Number(e.target.value))}>
        <option value="">no scene — baselines</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {present.has(s.id) ? "● " : " "}sc {s.number} — {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
