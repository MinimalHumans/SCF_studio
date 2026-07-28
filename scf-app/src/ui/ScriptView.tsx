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
  createBeatForLine, diffVersionAgainstCurrent, linkAndCreateAtCommit,
  planCommitLinks, publishVersion, reanchorForEvents, tagPropRange,
  validateTags, type CommitPlanInfo,
} from "../editor/features.ts";
import { paginationFor } from "../editor/extensions.ts";
import { ImportFlow } from "./ImportFlow.tsx";
import { useQuery } from "./useQuery.ts";

const touch = (): void => {
  useStore.setState((s) => ({ revision: s.revision + 1 }));
};

/** Cross-component handle for the scene rail's jump-to-line. */
export const scriptViewHandle: {
  scrollToLineOrder: ((order: number) => void) | null;
} = { scrollToLineOrder: null };

/** Editing position survives leaving the Script tab (opening an entity
 * from a chip unmounts the editor; coming back should not mean "top of
 * the screenplay"). */
let savedPosition: { head: number; scrollTop: number } | null = null;

interface StaleNotice {
  uuid: string;
  sceneId: number;
  headingText: string;
}

function smartTitleLocal(x: string): string {
  return x.toLowerCase().replace(/(^|[\s\-'/(])\p{L}/gu,
                                 (c) => c.toUpperCase());
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
  const entityNamesRef = useRef<{ locations: string[];
                                  characters: string[] }>(
    { locations: [], characters: [] });
  const [commitNote, setCommitNote] = useState("");
  const [review, setReview] = useState<CommitPlanInfo | null>(null);
  const [resolutions, setResolutions] =
    useState<Map<string, "create" | "rename">>(new Map());
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 1 });
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
    const locationNames = await exec("SELECT name FROM location");
    const characterNames = await exec("SELECT name FROM character");
    entityNamesRef.current = {
      locations: locationNames.map((r) => String(r["name"])),
      characters: characterNames.map((r) => String(r["name"])),
    };
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

  const commitBusy = useRef(false);
  const commitAgain = useRef(false);

  const commit = async (): Promise<void> => {
    // Coalesce: blur + click (or debounce + Cmd-S) fire near-together;
    // one runs, a trailing rerun picks up anything newer.
    if (commitBusy.current) {
      commitAgain.current = true;
      return;
    }
    commitBusy.current = true;
    try {
      await commitInner();
    } finally {
      commitBusy.current = false;
      if (commitAgain.current) {
        commitAgain.current = false;
        void commit();
      }
    }
  };

  const commitInner = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null) return;
    const plan = commitPlan(view.state, prevBlocksRef.current);
    const created = await withTransaction(exec, async () => {
      const link = await linkAndCreateAtCommit(
        exec, plan.rows, { createNew: false });
      await writeScreenplay(exec, {
        bom: false,
        titlePage: titlePageRef.current,
        lines: plan.rows,
      });
      return link;
    });
    const parts: string[] = [];
    if (created.scenesCreated > 0) {
      parts.push(`${String(created.scenesCreated)} scene(s)`);
    }
    if (created.locationsCreated > 0) {
      parts.push(`${String(created.locationsCreated)} location(s)`);
    }
    if (created.charactersCreated > 0) {
      parts.push(`${String(created.charactersCreated)} character(s)`);
    }
    setCommitNote(parts.length > 0
      ? `created ${parts.join(", ")}` : "");
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

  /** The Commit button / Cmd-S: preview creations and conflicts, and
   * only create after the author has reviewed them. */
  const explicitCommit = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null) return;
    await commit(); // text + existing links are always safe to save
    const plan = commitPlan(view.state, prevBlocksRef.current);
    const info = await planCommitLinks(exec, plan.rows);
    console.debug("[commit-plan]",
      { newLocations: info.newLocations.map((l) => l.name),
        newCharacters: info.newCharacters.map((c) => c.cue),
        conflicts: info.conflicts.length,
        headings: plan.rows
          .filter((r) => r.lineType === "heading")
          .map((r) => ({ content: r.content, sceneId: r.sceneId })) });
    if (info.newLocations.length === 0 &&
        info.newCharacters.length === 0 && info.conflicts.length === 0) {
      return;
    }
    setResolutions(new Map());
    setReview(info);
  };

  const confirmReview = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null || review === null) return;
    const plan = commitPlan(view.state, prevBlocksRef.current);
    const unlinkUuids = new Set<string>();
    const renames = new Map<number, string>();
    for (const c of review.conflicts) {
      const choice = resolutions.get(c.uuid) ?? "create";
      if (choice === "create") unlinkUuids.add(c.uuid);
      else renames.set(c.entityId, smartTitleLocal(c.cue));
    }
    const created = await withTransaction(exec, async () => {
      const link = await linkAndCreateAtCommit(exec, plan.rows,
        { createNew: true, unlinkUuids, renames });
      await writeScreenplay(exec, {
        bom: false, titlePage: titlePageRef.current, lines: plan.rows,
      });
      return link;
    });
    prevBlocksRef.current = new Map(plan.rows.map((r) => [r.uuid!, {
      id: r.uuid!, type: r.lineType as Block["type"], text: r.content,
      sceneId: r.sceneId, characterId: r.characterId,
      locationId: r.locationId, metadata: r.metadata,
    }]));
    // Renames may have rewritten cue lines — reflect them in the doc.
    const current = commitPlan(view.state, prevBlocksRef.current);
    for (const r of plan.rows) {
      const live = current.rows.find((x) => x.uuid === r.uuid);
      if (live !== undefined && live.content !== r.content) {
        const lineIdx = plan.rows.indexOf(r);
        const line = view.state.doc.line(
          Math.min(lineIdx + 1, view.state.doc.lines));
        view.dispatch({ changes: { from: line.from, to: line.to,
                                   insert: r.content } });
      }
    }
    const parts: string[] = [];
    if (created.scenesCreated > 0) {
      parts.push(`${String(created.scenesCreated)} scene(s)`);
    }
    if (created.locationsCreated > 0) {
      parts.push(`${String(created.locationsCreated)} location(s)`);
    }
    if (created.charactersCreated > 0) {
      parts.push(`${String(created.charactersCreated)} character(s)`);
    }
    setCommitNote(parts.length > 0
      ? `created ${parts.join(", ")}` : "");
    setReview(null);
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
            onCommitRequest: () => void explicitCommit(),
            onChipClick: (entity, entityId) =>
              void openEntityRow(entity, entityId),
            getLocations: () => entityNamesRef.current.locations,
            getCharacters: () => entityNamesRef.current.characters,
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              pendingEvents.current.push(...lineEvents(u.state));
              scheduleCommit();
            }
            if (u.viewportChanged || u.docChanged || u.selectionSet) {
              // "The page you are viewing": the line at the top of the
              // visible viewport, through the manuscript-row model.
              const pagination = paginationFor(u.state);
              const topLine =
                u.state.doc.lineAt(u.view.viewport.from).number;
              setPageInfo({
                page: pagination.pageOfLine(topLine),
                total: pagination.total,
              });
              // Stabilize the scrollbar with the MEASURED height (the
              // row-model estimate overshot and left blank pages at the
              // end). Never shrinks mid-scroll, so the thumb maps 1:1.
              u.view.requestMeasure({
                read: (v) => v.contentHeight,
                write: (h, v) => {
                  const cur =
                    parseFloat(v.contentDOM.style.minHeight || "0");
                  if (u.docChanged || h > cur) {
                    v.contentDOM.style.minHeight = `${String(h)}px`;
                  }
                },
              });
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
      if (savedPosition !== null) {
        const head = Math.min(savedPosition.head,
                              view.state.doc.length);
        // scrollIntoView goes through CM's measure cycle — a raw
        // scrollTop write raced measurement and lost (clamped to top).
        view.dispatch({
          selection: { anchor: head },
          effects: EditorView.scrollIntoView(head, { y: "center" }),
        });
      }
    })();

    return () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
      // StrictMode double-mounts: its interleaved cleanup runs on a
      // still-empty view and was clobbering the real saved position
      // with 0/top. An empty doc has no position worth saving.
      if (view.state.doc.length > 0) {
        savedPosition = {
          head: view.state.selection.main.head,
          scrollTop: view.scrollDOM.scrollTop,
        };
      }
      scriptViewHandle.scrollToLineOrder = null;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlinkScene = async (notice: StaleNotice): Promise<void> => {
    await exec(
      "UPDATE screenplay_lines SET scene_id = NULL WHERE uuid = ?",
      [notice.uuid]);
    const block = prevBlocksRef.current.get(notice.uuid);
    if (block !== undefined) block.sceneId = null;
    setStale((old) => old.filter((x) => x.uuid !== notice.uuid));
    touch();
    await refreshAnnotations();
  };

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
        {commitNote !== "" && (
          <span className="commit-note">{commitNote}</span>
        )}
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
        <span className="page-indicator">
          p. {pageInfo.page}/{pageInfo.total}
        </span>
        <button onClick={() => void explicitCommit()}
                title="Cmd/Ctrl-S — reviews new entities before creating">
          Commit
        </button>
      </div>
      {stale.length > 0 && (
        <div className="stale-bar">
          {stale.map((s) => (
            <span key={s.uuid} className="stale-notice">
              This heading's text changed but it is still linked to
              its original scene entity — script and scene now disagree.
              <em> {s.headingText}</em>
              <span className="muted">
                Sync updates the scene from the heading; Open shows the
                scene; Dismiss keeps both as they are.
              </span>
              <button onClick={() => void syncScene(s)}>Sync scene</button>
              <button onClick={() => void unlinkScene(s)}
                      title="Break this line's link to the scene entity. The next Commit will propose a fresh scene (and its location) from the heading as written.">
                Unlink
              </button>
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
      {review !== null && (
        <div className="modal-scrim" role="dialog" aria-modal="true">
          <div className="modal commit-review">
            <div className="modal-head">
              <h2>Review before creating</h2>
              <button onClick={() => setReview(null)}
                      aria-label="close">×</button>
            </div>
            {review.newLocations.length > 0 && (
              <>
                <h3>New locations</h3>
                <ul className="review-list">
                  {review.newLocations.map((l) => (
                    <li key={l.name}>
                      <b>{l.name}</b>
                      {l.similar.length > 0 && (
                        <span className="muted">
                          {" "}— similar existing:{" "}
                          {l.similar.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {review.newCharacters.length > 0 && (
              <>
                <h3>New characters</h3>
                <ul className="review-list">
                  {review.newCharacters.map((c) => (
                    <li key={c.cue}>
                      <b>{c.cue}</b>
                      {c.similar.length > 0 && (
                        <span className="muted">
                          {" "}— similar existing:{" "}
                          {c.similar.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {review.conflicts.length > 0 && (
              <>
                <h3>Cue / entity mismatches</h3>
                <ul className="review-list">
                  {review.conflicts.map((c) => (
                    <li key={c.uuid} className="review-conflict">
                      Line says <b>{c.cue}</b> but is linked to{" "}
                      <b>{c.entityName}</b>.
                      <label>
                        <input type="radio" name={`res-${c.uuid}`}
                               checked={(resolutions.get(c.uuid) ??
                                         "create") === "create"}
                               onChange={() => setResolutions((old) =>
                                 new Map(old).set(c.uuid, "create"))} />
                        break link; create/match “{c.cue}”
                      </label>
                      <label>
                        <input type="radio" name={`res-${c.uuid}`}
                               checked={resolutions.get(c.uuid) ===
                                        "rename"}
                               onChange={() => setResolutions((old) =>
                                 new Map(old).set(c.uuid, "rename"))} />
                        rename entity to “{smartTitleLocal(c.cue)}” (all
                        its cue lines update)
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="modal-actions">
              <span className="muted">
                Nothing is created until you confirm. Cancel to fix
                spelling in the script first.
              </span>
              <span className="flex-spacer" />
              <button onClick={() => setReview(null)}>Cancel</button>
              <button className="primary"
                      onClick={() => void confirmReview()}>
                Create & commit
              </button>
            </div>
          </div>
        </div>
      )}
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
  const enabled = selection !== null && selection.text.trim() !== "";
  return (
    <select className="tag-control" value=""
            disabled={!enabled}
            title={selection === null
              ? "Select text within one line to tag it as a prop"
              : `Tag “${selection.text}” as a prop`}
            onChange={(e) => {
              const value = e.target.value;
              e.target.value = "";
              if (selection === null) return;
              if (value === "__new__") {
                const name = window.prompt(
                  "New prop name:", selection.text.trim());
                if (name === null || name.trim() === "") return;
                void (async () => {
                  await exec(
                    "INSERT INTO prop (name, external_id_namespace) " +
                    "VALUES (?, 'scf:editor')", [name.trim()]);
                  const id = (await exec(
                    "SELECT last_insert_rowid() AS id"))[0]!["id"];
                  await tagPropRange(exec, selection.lineId,
                                     id as number, selection.text,
                                     selection.from, selection.to);
                  onTagged();
                })();
                return;
              }
              const propId = Number(value);
              if (!Number.isFinite(propId)) return;
              void tagPropRange(exec, selection.lineId, propId,
                                selection.text, selection.from,
                                selection.to).then(onTagged);
            }}>
      <option value="" disabled>⌁ tag prop</option>
      <option value="__new__">＋ create new prop…</option>
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
