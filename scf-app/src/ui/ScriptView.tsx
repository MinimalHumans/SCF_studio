/**
 * ScriptView — Part 3's editing surface.
 *
 * The CM6 view mounts over lineState; this component owns the lifecycle:
 * load rows → blocks → editor; debounced commit (idle/blur/Cmd-S) via
 * commitPlan — a pure projection, no parsing; stale-scene notices with
 * an OFFERED sync (heading edits never mutate scenes on keystroke);
 * Fountain export with derived spacing; and the import flow entry.
 */

import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { exec, useStore } from "../state/store.ts";
import { readScreenplay, writeScreenplay, type TitlePageRow }
  from "@scf-core/screenplay/rowModel.ts";
import { withTransaction } from "@scf-core/db.ts";
import { loadLines } from "../editor/lineState.ts";
import {
  blocksToDoc, blocksToFountain, commitPlan, rowsToBlocks,
  sceneSyncFromHeading, type Block,
} from "../editor/screenplayDoc.ts";
import {
  screenplayExtensions, setAnnotations, type LineAnnotation,
} from "../editor/extensions.ts";
import { lineEntries, lineEvents, type LineEvent }
  from "../editor/lineState.ts";
import {
  createBeatForLine, diffVersionAgainstCurrent, publishVersion,
  reanchorForEvents, tagPropRange, validateTags,
} from "../editor/features.ts";
import { ImportFlow } from "./ImportFlow.tsx";
import { useQuery } from "./useQuery.ts";

const touch = (): void => {
  useStore.setState((s) => ({ revision: s.revision + 1 }));
};

/** Cross-component handle for the scene rail's jump-to-line. */
export const scriptViewHandle: {
  scrollToLineOrder: ((order: number) => void) | null;
} = { scrollToLineOrder: null };

interface StaleNotice {
  uuid: string;
  sceneId: number;
  headingText: string;
}

export function ScriptView(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const prevBlocksRef = useRef<Map<string, Block>>(new Map());
  const titlePageRef = useRef<TitlePageRow[]>([]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stale, setStale] = useState<StaleNotice[]>([]);
  const [cursorBlock, setCursorBlock] = useState<Block | null>(null);
  const [selection, setSelection] =
    useState<{ lineId: string; from: number; to: number;
               text: string } | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [detachedTags, setDetachedTags] = useState(0);
  const pendingEvents = useRef<LineEvent[]>([]);
  const { openEntityRow } = useStore();

  const refreshAnnotations = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null) return;
    const map = new Map<string, LineAnnotation>();
    const entries = lineEntries(view.state);
    const textById = new Map<string, string>();
    entries.forEach((e, i) => {
      textById.set(e.id, view.state.doc.line(i + 1).text);
    });
    // Entity chips from the committed blocks' links.
    const sceneIds = new Set<number>();
    const charIds = new Set<number>();
    for (const b of prevBlocksRef.current.values()) {
      if (b.type === "heading" && b.sceneId !== null) {
        sceneIds.add(b.sceneId);
      }
      if (b.type === "character" && b.characterId !== null) {
        charIds.add(b.characterId);
      }
    }
    const nameOf = async (table: string, ids: Set<number>):
        Promise<Map<number, string>> => {
      if (ids.size === 0) return new Map();
      const rows = await exec(
        `SELECT id, name FROM ${table} WHERE id IN ` +
        `(${[...ids].map(() => "?").join(",")})`, [...ids]);
      return new Map(rows.map((r) =>
        [r["id"] as number, String(r["name"])]));
    };
    const sceneNames = await nameOf("scene", sceneIds);
    const charNames = await nameOf("character", charIds);
    for (const b of prevBlocksRef.current.values()) {
      if (b.type === "heading" && b.sceneId !== null) {
        const label = sceneNames.get(b.sceneId);
        if (label !== undefined) {
          map.set(b.id, { chip: { label: "⛭ scene", entity: "scene",
                                  entityId: b.sceneId } });
        }
      } else if (b.type === "character" && b.characterId !== null) {
        const label = charNames.get(b.characterId);
        if (label !== undefined) {
          map.set(b.id, { chip: { label, entity: "character",
                                  entityId: b.characterId } });
        }
      }
    }
    // Beat dots.
    const beatRows = await exec(
      "SELECT line_ref, COUNT(*) AS n FROM performance_beat " +
      "WHERE line_ref IS NOT NULL GROUP BY line_ref");
    for (const r of beatRows) {
      const id = String(r["line_ref"]);
      map.set(id, { ...(map.get(id) ?? {}), beats: r["n"] as number });
    }
    // Prop-tag ranges with honest validation.
    const tags = await validateTags(exec, textById);
    let detached = 0;
    for (const t of tags) {
      if (t.status === "detached") {
        detached += 1;
        continue;
      }
      const ann = map.get(t.lineId) ?? {};
      map.set(t.lineId, {
        ...ann,
        tags: [...(ann.tags ?? []),
               { from: t.startOffset, to: t.endOffset,
                 status: t.status, propName: t.propName }],
      });
    }
    setDetachedTags(detached);
    view.dispatch({ effects: setAnnotations.of(map) });
  };

  const commit = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null) return;
    const plan = commitPlan(view.state, prevBlocksRef.current);
    await withTransaction(exec, () => writeScreenplay(exec, {
      bom: false,
      titlePage: titlePageRef.current,
      lines: plan.rows,
    }));
    prevBlocksRef.current = new Map(plan.rows.map((r) => [r.uuid!, {
      id: r.uuid!, type: r.lineType as Block["type"], text: r.content,
      sceneId: r.sceneId, characterId: r.characterId,
      locationId: r.locationId, metadata: r.metadata,
    }]));
    const events = pendingEvents.current;
    pendingEvents.current = [];
    if (events.length > 0) {
      await reanchorForEvents(exec, events);
    }
    if (plan.staleScenes.length > 0) {
      setStale((old) => {
        const merged = new Map(old.map((s) => [s.uuid, s]));
        for (const s of plan.staleScenes) {
          if (s.sceneId !== null) {
            merged.set(s.uuid, { uuid: s.uuid, sceneId: s.sceneId,
                                 headingText: s.headingText });
          }
        }
        return [...merged.values()];
      });
    }
    touch();
    await refreshAnnotations();
  };

  const scheduleCommit = (): void => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      void commit();
    }, 1200);
  };

  const loadIntoEditor = (blocks: Block[]): void => {
    const view = viewRef.current;
    if (view === null) return;
    const { doc, entries } = blocksToDoc(blocks);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      effects: loadLines.of(entries),
    });
    prevBlocksRef.current = new Map(blocks.map((b) => [b.id, b]));
    setEmpty(blocks.length === 0);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          screenplayExtensions({
            onCommitRequest: () => void commit(),
            onChipClick: (entity, entityId) =>
              void openEntityRow(entity, entityId),
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              pendingEvents.current.push(...lineEvents(u.state));
              scheduleCommit();
            }
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              const entry = lineEntries(u.state)[line.number - 1];
              setCursorBlock(entry !== undefined
                ? prevBlocksRef.current.get(entry.id) ?? {
                    id: entry.id, type: entry.type, text: line.text,
                    sceneId: null, characterId: null, locationId: null,
                    metadata: null,
                  }
                : null);
              const sel = u.state.selection.main;
              if (!sel.empty && entry !== undefined &&
                  sel.from >= line.from && sel.to <= line.to) {
                setSelection({
                  lineId: entry.id,
                  from: sel.from - line.from,
                  to: sel.to - line.from,
                  text: u.state.doc.sliceString(sel.from, sel.to),
                });
              } else {
                setSelection(null);
              }
            }
          }),
          EditorView.domEventHandlers({
            blur: () => { void commit(); },
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    scriptViewHandle.scrollToLineOrder = (order: number) => {
      const line = view.state.doc.line(
        Math.min(order + 1, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
      view.focus();
    };

    void (async () => {
      const sp = await readScreenplay(exec);
      titlePageRef.current = sp.titlePage;
      loadIntoEditor(rowsToBlocks(sp.lines));
      setLoaded(true);
      await refreshAnnotations();
    })();

    return () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
      scriptViewHandle.scrollToLineOrder = null;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncScene = async (notice: StaleNotice): Promise<void> => {
    const fields = sceneSyncFromHeading(notice.headingText);
    await exec(
      "UPDATE scene SET name = ?, " +
      "int_ext = COALESCE(?, int_ext), " +
      "time_of_day = COALESCE(?, time_of_day), " +
      "updated_at = datetime('now') WHERE id = ?",
      [fields.name,
       fields.int_ext !== null
         ? { INT: "interior", EXT: "exterior",
             "INT/EXT": "int/ext" }[fields.int_ext] ?? null : null,
       fields.time_of_day !== null
         ? fields.time_of_day.toLowerCase() : null,
       notice.sceneId]);
    setStale((old) => old.filter((s) => s.uuid !== notice.uuid));
    touch();
  };

  const exportFountain = (): void => {
    const view = viewRef.current;
    if (view === null) return;
    const plan = commitPlan(view.state, prevBlocksRef.current);
    const blocks: Block[] = plan.rows.map((r) => ({
      id: r.uuid!, type: r.lineType as Block["type"], text: r.content,
      sceneId: r.sceneId, characterId: r.characterId,
      locationId: r.locationId, metadata: r.metadata,
    }));
    let text = "";
    for (const tp of titlePageRef.current) {
      text += `${tp.key}: ${tp.value.split("\n").join("\n   ")}\n`;
    }
    if (titlePageRef.current.length > 0) text += "\n";
    text += blocksToFountain(blocks);
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "screenplay.fountain";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="script-view">
      <div className="script-toolbar">
        <span className="script-title">Script</span>
        <span className="flex-spacer" />
        <BeatControl block={cursorBlock} onCreated={() =>
          void refreshAnnotations()} />
        <TagControl selection={selection} onTagged={() =>
          void refreshAnnotations()} />
        {detachedTags > 0 && (
          <span className="detached-note"
                title="Prop tags whose text no longer exists on their line. Rows are kept, not deleted.">
            {detachedTags} detached tag{detachedTags > 1 ? "s" : ""}
          </span>
        )}
        <button onClick={() => setShowVersions(!showVersions)}
                aria-pressed={showVersions}>Versions</button>
        <button onClick={() => setImporting(true)}>Import…</button>
        <button onClick={exportFountain} disabled={empty}>
          Export .fountain
        </button>
        <button onClick={() => void commit()} title="Cmd/Ctrl-S">
          Commit
        </button>
      </div>
      {stale.length > 0 && (
        <div className="stale-bar">
          {stale.map((s) => (
            <span key={s.uuid} className="stale-notice">
              Heading changed — linked scene may be out of date:
              <em> {s.headingText}</em>
              <button onClick={() => void syncScene(s)}>Sync scene</button>
              <button onClick={() =>
                void openEntityRow("scene", s.sceneId)}>Open</button>
              <button onClick={() => setStale((old) =>
                old.filter((x) => x.uuid !== s.uuid))}>Dismiss</button>
            </span>
          ))}
        </div>
      )}
      {loaded && empty && !importing && (
        <div className="script-empty">
          <p>No screenplay in this project yet.</p>
          <button className="primary" onClick={() => setImporting(true)}>
            Import Fountain / FDX
          </button>
          <button onClick={() => {
            loadIntoEditor([{
              id: crypto.randomUUID(), type: "heading",
              text: "INT. ", sceneId: null, characterId: null,
              locationId: null, metadata: null,
            }]);
            viewRef.current?.focus();
          }}>
            Start blank
          </button>
        </div>
      )}
      <div className="script-body">
        <div ref={hostRef}
             className={"script-editor" + (empty ? " hidden" : "")} />
        {showVersions && (
          <VersionsPanel onPublished={() => touch()} />
        )}
      </div>
      {importing && (
        <ImportFlow
          onClose={() => setImporting(false)}
          onDone={async () => {
            setImporting(false);
            const sp = await readScreenplay(exec);
            titlePageRef.current = sp.titlePage;
            loadIntoEditor(rowsToBlocks(sp.lines));
            touch();
          }}
        />
      )}
    </div>
  );
}


function BeatControl({ block, onCreated }: {
  block: Block | null;
  onCreated: () => void;
}): JSX.Element {
  const enabled = block !== null && block.sceneId !== null &&
                  block.characterId !== null;
  return (
    <select className="beat-control" value=""
            disabled={!enabled}
            title={enabled
              ? "Anchor a performance beat to this line"
              : "Beats need a line with scene + character context " +
                "(dialogue under an accepted cue)"}
            onChange={(e) => {
              const modality = e.target.value as
                "physical" | "vocal" | "facial" | "";
              e.target.value = "";
              if (modality === "" || block === null) return;
              void createBeatForLine(exec, block, modality, block.text)
                .then(onCreated);
            }}>
      <option value="" disabled>＋ beat</option>
      <option value="vocal">vocal</option>
      <option value="physical">physical</option>
      <option value="facial">facial</option>
    </select>
  );
}

function TagControl({ selection, onTagged }: {
  selection: { lineId: string; from: number; to: number;
               text: string } | null;
  onTagged: () => void;
}): JSX.Element {
  const props = useQuery("SELECT id, name FROM prop ORDER BY name");
  const enabled = selection !== null && selection.text.trim() !== "" &&
                  props.length > 0;
  return (
    <select className="tag-control" value=""
            disabled={!enabled}
            title={selection === null
              ? "Select text within one line to tag it as a prop"
              : props.length === 0
                ? "No props exist yet — create one first"
                : `Tag “${selection.text}” as a prop`}
            onChange={(e) => {
              const propId = Number(e.target.value);
              e.target.value = "";
              if (!Number.isFinite(propId) || selection === null) return;
              void tagPropRange(exec, selection.lineId, propId,
                                selection.text, selection.from,
                                selection.to).then(onTagged);
            }}>
      <option value="" disabled>⌁ tag prop</option>
      {props.map((p) => (
        <option key={String(p["id"])} value={String(p["id"])}>
          {String(p["name"])}
        </option>
      ))}
    </select>
  );
}

function VersionsPanel({ onPublished }: {
  onPublished: () => void;
}): JSX.Element {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [diffs, setDiffs] = useState<Map<number,
    { kept: number; added: number; removed: number }>>(new Map());
  const versions = useQuery(
    "SELECT * FROM screenplay_versions ORDER BY version_number DESC");

  return (
    <aside className="versions-panel">
      <h3>Versions</h3>
      <div className="version-publish">
        <input placeholder="description…" value={description}
               onChange={(e) => setDescription(e.target.value)} />
        <button className="primary" disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void publishVersion(exec, description).then(() => {
                    setDescription("");
                    setBusy(false);
                    onPublished();
                  });
                }}>
          Publish
        </button>
      </div>
      <ul className="version-list">
        {versions.map((v) => {
          const id = v["id"] as number;
          const d = diffs.get(id);
          return (
            <li key={id}>
              <div className="version-head">
                <b>v{String(v["version_number"])}</b>
                <span className="muted">
                  {String(v["published_at"] ?? "")}
                </span>
              </div>
              {String(v["description"] ?? "") !== "" && (
                <div className="version-desc">
                  {String(v["description"])}
                </div>
              )}
              <div className="muted version-counts">
                {String(v["line_count"])} lines ·{" "}
                {String(v["scene_count"])} scenes ·{" "}
                {String(v["word_count"])} words
              </div>
              {d !== undefined ? (
                <div className="version-diff">
                  vs current: {d.kept} kept, {d.added} added,{" "}
                  {d.removed} removed
                </div>
              ) : (
                <button className="linkish" onClick={() => {
                  void diffVersionAgainstCurrent(exec, id).then((r) => {
                    setDiffs((old) => new Map(old).set(id, {
                      kept: r.kept, added: r.added, removed: r.removed,
                    }));
                  });
                }}>
                  diff vs current
                </button>
              )}
            </li>
          );
        })}
        {versions.length === 0 && (
          <li className="muted">No versions published yet.</li>
        )}
      </ul>
    </aside>
  );
}
