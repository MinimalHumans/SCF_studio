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

import { EditorState, Transaction } from "@codemirror/state";
import { exec, useStore } from "../state/store.ts";
import { readScreenplay, writeScreenplay, type TitlePageRow }
  from "@scf-core/screenplay/rowModel.ts";
import { withTransaction } from "@scf-core/db.ts";
import { loadLines } from "../editor/lineState.ts";
import { planSceneMove } from "../editor/sceneMove.ts";
import { reanchorSpansForMove } from "../editor/structureCommit.ts";
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
import { IntegrityPanel } from "./IntegrityPanel.tsx";
import { useQuery } from "./useQuery.ts";
import { scanIntegrity } from "../editor/integrity.ts";

const touch = (): void => {
  useStore.setState((s) => ({ revision: s.revision + 1 }));
};

/**
 * Every async path here must check this before touching the database.
 * The editor's debounced commit, blur commit and annotation refresh all
 * outlive the view by a tick, so closing a project or opening another
 * one landed them on a closed connection ("no database open"). A closed
 * project has nothing to save that was not already saved.
 */
const projectOpen = (): boolean => useStore.getState().phase === "open";

/** Cross-component handle for the scene rail's jump-to-line. */
export const scriptViewHandle: {
  scrollToLineOrder: ((order: number) => void) | null;
  /** Move a scene block so it sits before `beforeSceneId` (null = last).
   * The Scene Rail's drag calls this; the scene ENTITY is never touched,
   * so its beats, shots and links follow by construction. */
  moveScene: ((sceneId: number,
               beforeSceneId: number | null) => void) | null;
} = { scrollToLineOrder: null, moveScene: null };

/** Editing position survives leaving the Script tab (opening an entity
 * from a chip unmounts the editor; coming back should not mean "top of
 * the screenplay"). */
let savedPosition: { head: number; scrollTop: number } | null = null;

interface StaleNotice {
  uuid: string;
  sceneId: number;
  headingText: string;
  /** What the scene entity currently stores, so the notice can show the
   * actual disagreement rather than describing one. */
  sceneName: string;
  sceneNumber: number | null;
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
  const [showIntegrity, setShowIntegrity] = useState(false);
  const [integrityCount, setIntegrityCount] = useState(0);
  const [liveLineIds, setLiveLineIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const pendingEvents = useRef<LineEvent[]>([]);
  const entityNamesRef = useRef<{ locations: string[];
                                  characters: string[] }>(
    { locations: [], characters: [] });
  const [commitNote, setCommitNote] = useState("");
  const [review, setReview] = useState<CommitPlanInfo | null>(null);
  const [resolutions, setResolutions] =
    useState<Map<string, "create" | "rename">>(new Map());
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 1 });
  const [zoom, setZoom] = useState(() => {
    const v = Number(localStorage.getItem("scf:editor-zoom"));
    return Number.isFinite(v) && v >= 0.7 && v <= 2 ? v : 1;
  });
  const [pageMode, setPageMode] = useState<"light" | "dark">(() =>
    localStorage.getItem("scf:editor-mode") === "dark" ? "dark" : "light");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const say = (message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };
  const [showAnnot, setShowAnnot] = useState(() =>
    localStorage.getItem("scf:editor-annot") !== "hidden");
  const [dirty, setDirty] = useState(false);
  const [menu, setMenu] =
    useState<{ x: number; y: number } | null>(null);

  const setZoomClamped = (z: number): void => {
    const clamped = Math.min(2, Math.max(0.7, Math.round(z * 10) / 10));
    setZoom(clamped);
    localStorage.setItem("scf:editor-zoom", String(clamped));
  };
  const togglePageMode = (): void => {
    const next = pageMode === "light" ? "dark" : "light";
    setPageMode(next);
    localStorage.setItem("scf:editor-mode", next);
  };
  const toggleAnnot = (): void => {
    const next = !showAnnot;
    setShowAnnot(next);
    localStorage.setItem("scf:editor-annot",
                         next ? "shown" : "hidden");
  };
  const { openEntityRow } = useStore();

  const refreshAnnotations = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null || !projectOpen()) return;
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
    for (const t of tags) {
      if (t.status === "detached") continue;
      const ann = map.get(t.lineId) ?? {};
      map.set(t.lineId, {
        ...ann,
        tags: [...(ann.tags ?? []),
               { from: t.startOffset, to: t.endOffset,
                 status: t.status, propName: t.propName }],
      });
    }
    // The integrity scan needs the ids the DOCUMENT holds, not the ones
    // that last reached disk — the author is looking at the document.
    const live = new Set(entries.map((e) => e.id));
    setLiveLineIds(live);
    setIntegrityCount((await scanIntegrity(exec, live)).total);
    view.dispatch({ effects: setAnnotations.of(map) });
  };

  const commitBusy = useRef(false);
  const commitAgain = useRef(false);
  const commitAgainStale = useRef(false);

  /**
   * `reportStale` gates the heading/scene disagreement notice. The
   * debounced auto-save must NOT raise it: it fires 1.2s after the first
   * keystroke into a heading, so the author was told the script and the
   * scene disagreed before they had finished typing the new slug. Blur
   * and an explicit Commit mean the thought is finished.
   */
  const commit = async (reportStale = false): Promise<void> => {
    if (!projectOpen()) return;
    // Coalesce: blur + click (or debounce + Cmd-S) fire near-together;
    // one runs, a trailing rerun picks up anything newer.
    if (commitBusy.current) {
      commitAgain.current = true;
      if (reportStale) commitAgainStale.current = true;
      return;
    }
    commitBusy.current = true;
    try {
      await commitInner(reportStale);
    } finally {
      commitBusy.current = false;
      if (commitAgain.current) {
        commitAgain.current = false;
        const again = commitAgainStale.current;
        commitAgainStale.current = false;
        void commit(again);
      }
    }
  };

  const commitInner = async (reportStale: boolean): Promise<void> => {
    const view = viewRef.current;
    if (view === null || !projectOpen()) return;
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
    if (created.actsCreated > 0) {
      parts.push(`${String(created.actsCreated)} act(s)`);
    }
    if (created.sequencesCreated > 0) {
      parts.push(`${String(created.sequencesCreated)} sequence(s)`);
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
    if (reportStale && plan.staleScenes.length > 0) {
      const ids = plan.staleScenes
        .map((s) => s.sceneId)
        .filter((id): id is number => id !== null);
      const named = ids.length === 0 ? [] : await exec(
        `SELECT id, name, scene_number FROM scene WHERE id IN ` +
        `(${ids.map(() => "?").join(",")})`, ids);
      const nameById = new Map(named.map((r) =>
        [r["id"] as number, r]));
      setStale((old) => {
        const merged = new Map(old.map((s) => [s.uuid, s]));
        for (const s of plan.staleScenes) {
          if (s.sceneId === null) continue;
          const row = nameById.get(s.sceneId);
          merged.set(s.uuid, {
            uuid: s.uuid, sceneId: s.sceneId,
            headingText: s.headingText,
            sceneName: String(row?.["name"] ?? ""),
            sceneNumber: typeof row?.["scene_number"] === "number"
              ? row["scene_number"] : null,
          });
        }
        return [...merged.values()];
      });
    }
    touch();
    await refreshAnnotations();
    // The Commit light was only ever recomputed at mount and after an
    // EXPLICIT commit, so typing a new character cue left it dark until
    // something unrelated refreshed it. The auto-save is the moment the
    // answer can have changed.
    await updateDirty();
  };

  /** The Commit button / Cmd-S: preview creations and conflicts, and
   * only create after the author has reviewed them. */
  const explicitCommit = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null || !projectOpen()) return;
    await commit(true); // text + existing links are always safe to save
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
        info.newCharacters.length === 0 && info.conflicts.length === 0 &&
        info.newActs.length === 0 && info.newSequences.length === 0) {
      if (info.newScenes > 0) {
        const created = await withTransaction(exec, async () => {
          const link = await linkAndCreateAtCommit(exec, plan.rows,
            { createNew: true });
          await writeScreenplay(exec, {
            bom: false, titlePage: titlePageRef.current,
            lines: plan.rows,
          });
          return link;
        });
        prevBlocksRef.current = new Map(plan.rows.map((r) => [r.uuid!, {
          id: r.uuid!, type: r.lineType as Block["type"],
          text: r.content, sceneId: r.sceneId,
          characterId: r.characterId, locationId: r.locationId,
          metadata: r.metadata,
        }]));
        setCommitNote(created.scenesCreated > 0
          ? `created ${String(created.scenesCreated)} scene(s)` : "");
        touch();
        await refreshAnnotations();
      }
      setDirty(false);
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
    if (created.actsCreated > 0) {
      parts.push(`${String(created.actsCreated)} act(s)`);
    }
    if (created.sequencesCreated > 0) {
      parts.push(`${String(created.sequencesCreated)} sequence(s)`);
    }
    setCommitNote(parts.length > 0
      ? `created ${parts.join(", ")}` : "");
    setReview(null);
    setDirty(false);
    touch();
    await refreshAnnotations();
    await updateDirty();
  };

  /** The Commit light means "entity work is pending": new scenes,
   * locations, characters, or cue/entity conflicts. Text itself is
   * auto-saved continuously and never needs the button. */
  const updateDirty = async (): Promise<void> => {
    const view = viewRef.current;
    if (view === null || !projectOpen()) return;
    const plan = commitPlan(view.state, prevBlocksRef.current);
    const info = await planCommitLinks(exec, plan.rows);
    setDirty(info.newScenes > 0 || info.newLocations.length > 0 ||
             info.newCharacters.length > 0 || info.conflicts.length > 0 ||
             info.newActs.length > 0 || info.newSequences.length > 0);
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
      // Loading a document is not an edit. Without this the import
      // itself sat on the undo stack, so one Ctrl-Z after importing
      // reverted the whole script to the empty document it replaced —
      // and redo brought it back as undifferentiated action lines,
      // because the line identities went with it.
      annotations: Transaction.addToHistory.of(false),
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
            clipboard: {
              // uuids are minted per file, so identity may only be
              // reused within the project that issued it.
              getProjectKey: () =>
                useStore.getState().projectName ?? "untitled",
              getLinks: (lineId) => {
                const block = prevBlocksRef.current.get(lineId);
                return block === undefined ? null : {
                  sceneId: block.sceneId,
                  characterId: block.characterId,
                  locationId: block.locationId,
                };
              },
              onPaste: (mode, lines) => {
                say(mode === "move"
                  ? `${String(lines)} line(s) moved — links kept`
                  : `${String(lines)} line(s) pasted`);
                scheduleCommit();
              },
            },
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
              if (u.docChanged) {
                u.view.contentDOM.style.minHeight = "";
              }
              u.view.requestMeasure({
                read: (v) => v.contentHeight,
                write: (h, v) => {
                  v.contentDOM.style.minHeight = `${String(h)}px`;
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
            blur: () => { void commit(true); },
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    /**
     * Reorder a scene from the Scene Rail's drag.
     *
     * The scene ENTITY is untouched — same id, same uuid, same beats,
     * shots and junction rows. Only the line order changes, so nothing
     * is orphaned and nothing is recreated. Scene numbers follow the new
     * order once numbering lands (Round B).
     */
    scriptViewHandle.moveScene = (sceneId, beforeSceneId) => {
      const entries = lineEntries(view.state);
      const headingIndexes: number[] = [];
      entries.forEach((entry, i) => {
        if (entry.type === "heading") headingIndexes.push(i);
      });
      const blockOfScene = (target: number): number =>
        headingIndexes.findIndex((lineIdx) => {
          const entry = entries[lineIdx];
          return entry !== undefined &&
            prevBlocksRef.current.get(entry.id)?.sceneId === target;
        });

      const from = blockOfScene(sceneId);
      if (from === -1) return;
      const before = beforeSceneId === null
        ? headingIndexes.length : blockOfScene(beforeSceneId);
      if (before === -1) return;

      const lines: string[] = [];
      for (let n = 1; n <= view.state.doc.lines; n++) {
        lines.push(view.state.doc.line(n).text);
      }
      const plan = planSceneMove(lines, entries, from, before);
      if (plan === null) return;

      // The scene order BEFORE the move, so a span anchored to the
      // scene that is leaving can re-anchor to whatever now sits where
      // it did. Captured here because after the dispatch it is gone.
      const orderBefore = headingIndexes
        .map((lineIdx) => {
          const entry = entries[lineIdx];
          return entry === undefined
            ? null : prevBlocksRef.current.get(entry.id)?.sceneId ?? null;
        })
        .filter((id): id is number => id !== null);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: plan.doc },
        effects: loadLines.of(plan.entries),
      });
      const landed = view.state.doc.line(
        Math.min(plan.headingAt + 1, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: landed.from },
        effects: EditorView.scrollIntoView(landed.from, { y: "center" }),
      });
      void (async () => {
        const rehomed = await reanchorSpansForMove(
          exec, sceneId, orderBefore);
        // Immediate, not debounced: a move changes scene numbers and
        // every label built from them, and leaving the script and the
        // records disagreeing for a second is how the rail and the
        // Structure tab end up showing different films.
        await commit(true);
        say(rehomed > 0
          ? "scene moved — act/sequence boundary stayed put"
          : "scene moved");
      })();
    };
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
      await updateDirty();
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
      scriptViewHandle.moveScene = null;
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

  /**
   * Rename the scene from the heading as typed.
   *
   * The location moves with it. Without that, INT. KITCHEN -> INT. GARAGE
   * renamed the scene and left it pointing at the Kitchen location — a
   * sync that visibly did not sync. A location that does NOT exist yet is
   * left alone rather than created: Sync is a repair, and entity creation
   * belongs to the Commit review where it can be seen first. The notice
   * says so.
   */
  const syncScene = async (notice: StaleNotice): Promise<void> => {
    const fields = sceneSyncFromHeading(notice.headingText);
    let locationId: number | null = null;
    if (fields.location !== null) {
      const hit = await exec(
        "SELECT id FROM location WHERE upper(name) = upper(?)",
        [fields.location.trim()]);
      locationId = (hit[0]?.["id"] as number | undefined) ?? null;
    }
    await exec(
      "UPDATE scene SET name = ?, " +
      "int_ext = COALESCE(?, int_ext), " +
      "time_of_day = COALESCE(?, time_of_day), " +
      "location_id = COALESCE(?, location_id), " +
      "updated_at = datetime('now') WHERE id = ?",
      [fields.name,
       fields.int_ext !== null
         ? { INT: "interior", EXT: "exterior",
             "INT/EXT": "int/ext" }[fields.int_ext] ?? null : null,
       fields.time_of_day !== null
         ? fields.time_of_day.toLowerCase() : null,
       locationId,
       notice.sceneId]);
    setStale((old) => old.filter((s) => s.uuid !== notice.uuid));
    say(fields.location !== null && locationId === null
      ? `renamed — "${fields.location}" is not a location yet, so Commit will offer to create it`
      : "scene updated from the heading");
    touch();
    await updateDirty();
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
        <span className="page-indicator">
          p. {pageInfo.page}/{pageInfo.total}
        </span>
        <span className="flex-spacer" />
        <span className="zoom-controls">
          <button onClick={() => setZoomClamped(zoom - 0.1)}
                  title="Zoom out" aria-label="zoom out">−</button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoomClamped(zoom + 0.1)}
                  title="Zoom in" aria-label="zoom in">＋</button>
        </span>
        <button onClick={togglePageMode}
                title={pageMode === "light"
                  ? "Switch page to dark" : "Switch page to light"}>
          {pageMode === "light" ? "☾" : "☀"}
        </button>
        <button onClick={toggleAnnot} aria-pressed={showAnnot}
                title={showAnnot
                  ? "Hide entity links (chips, tag underlines, beat dots)"
                  : "Show entity links"}>
          {showAnnot ? "◉ links" : "◎ links"}
        </button>
        {commitNote !== "" && (
          <span className="commit-note">{commitNote}</span>
        )}
        <BeatControl block={cursorBlock}
                     onCreated={(modality) => {
                       say(`${modality} beat added`);
                       void refreshAnnotations();
                     }} />
        <TagControl selection={selection} onTagged={(name) => {
          say(`tagged as ${name}`);
          void refreshAnnotations();
        }} />
        {integrityCount > 0 && (
          <button className="integrity-flag"
                  aria-pressed={showIntegrity}
                  title="Prop tags, beats and cast links whose script text is gone. Nothing is removed without your say-so."
                  onClick={() => setShowIntegrity(!showIntegrity)}>
            ⚑ {integrityCount} dangling
          </button>
        )}
        <button onClick={() => setShowVersions(!showVersions)}
                aria-pressed={showVersions}>Versions</button>
        <button className={dirty ? "commit-dirty" : "commit-clean"}
                onClick={() => void explicitCommit()}
                title="Cmd/Ctrl-S — reviews new entities before creating">
          Commit
        </button>
      </div>
      {stale.length > 0 && (
        <div className="stale-bar">
          {stale.map((s) => {
            const label = s.sceneNumber === null
              ? "This scene" : `Scene ${String(s.sceneNumber)}`;
            const emptied = s.headingText.trim() === "";
            return (
              <span key={s.uuid} className="stale-notice">
                {emptied ? (
                  <>
                    You cleared the heading for{" "}
                    <em>{s.sceneName}</em>, but this line is still linked
                    to it.
                  </>
                ) : (
                  <>
                    {label} is stored as <em>{s.sceneName}</em>, but this
                    line now reads <em>{s.headingText}</em>.
                  </>
                )}
                {!emptied && (
                  <button onClick={() => void syncScene(s)}
                          title="Update the scene record — its name, int/ext, time of day and location — to match the line as written. Use this when it is the same scene, renamed.">
                    Rename {s.sceneNumber === null
                      ? "the scene" : `scene ${String(s.sceneNumber)}`}
                  </button>
                )}
                <button onClick={() => void unlinkScene(s)}
                        title="Break this line's link. The scene record stays exactly as it is, unused by the script; the next Commit offers to create a fresh scene from this line.">
                  {emptied
                    ? "Take the scene out of the script"
                    : "Make this a new scene"}
                </button>
                <button onClick={() =>
                  void openEntityRow("scene", s.sceneId)}
                        title="Look at the scene record before deciding.">
                  Open {s.sceneName === "" ? "the scene" : s.sceneName}
                </button>
                <button onClick={() => setStale((old) =>
                  old.filter((x) => x.uuid !== s.uuid))}
                        title="Hide this. Nothing changes — the line and the scene stay as they are.">
                  Leave both
                </button>
              </span>
            );
          })}
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
             style={{ fontSize: `${String(13 * zoom)}px` }}
             onContextMenu={(e) => {
               if (selection !== null &&
                   selection.text.trim() !== "") {
                 e.preventDefault();
                 setMenu({ x: e.clientX, y: e.clientY });
               }
             }}
             className={"script-editor" +
               (empty ? " hidden" : "") +
               (pageMode === "dark" ? " page-dark" : "") +
               (showAnnot ? "" : " hide-annot")} />
      {toast !== null && (
        <div className="script-toast" role="status">{toast}</div>
      )}
        {showIntegrity && (
          <IntegrityPanel liveLineIds={liveLineIds}
                          onClose={() => setShowIntegrity(false)}
                          onChanged={() => {
                            touch();
                            void refreshAnnotations();
                          }} />
        )}
        {showVersions && (
          <VersionsPanel onPublished={() => touch()}
                         onImport={() => setImporting(true)}
                         onExport={exportFountain}
                         exportDisabled={empty} />
        )}
      </div>
      {menu !== null && selection !== null && (
        <PropContextMenu
          at={menu}
          selection={selection}
          onClose={() => setMenu(null)}
          onDone={() => {
            setMenu(null);
            void refreshAnnotations();
          }} />
      )}
      {review !== null && (
        <div className="modal-scrim" role="dialog" aria-modal="true">
          <div className="modal commit-review">
            <div className="modal-head">
              <h2>Review before creating</h2>
              <button onClick={() => setReview(null)}
                      aria-label="close">×</button>
            </div>
            {review.newScenes > 0 && (
              <p className="muted">
                {review.newScenes} new scene(s) will be created from
                unlinked headings.
              </p>
            )}
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
            {(review.newActs.length > 0 ||
              review.newSequences.length > 0) && (
              <>
                <h3>New structure</h3>
                <ul className="review-list">
                  {review.newActs.map((a) => (
                    <li key={`act:${a}`}>
                      <b>{a}</b>
                      <span className="muted"> — act, starting at the
                        next scene below it</span>
                    </li>
                  ))}
                  {review.newSequences.map((x) => (
                    <li key={`seq:${x}`}>
                      <b>{x}</b>
                      <span className="muted"> — sequence, starting at
                        the next scene below it</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {review.danglingSections.length > 0 && (
              <p className="muted">
                No scene follows {review.danglingSections.join(", ")},
                so {review.danglingSections.length === 1
                  ? "it anchors" : "they anchor"} nothing yet.
              </p>
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
  onCreated: (modality: string) => void;
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
                .then(() => onCreated(modality));
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
  onTagged: (propName: string) => void;
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
                  onTagged(name.trim());
                })();
                return;
              }
              const propId = Number(value);
              if (!Number.isFinite(propId)) return;
              const propName = String(
                props.find((r) => Number(r["id"]) === propId)?.["name"] ??
                "prop");
              void tagPropRange(exec, selection.lineId, propId,
                                selection.text, selection.from,
                                selection.to).then(() => onTagged(propName));
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

function VersionsPanel({ onPublished, onImport, onExport,
                         exportDisabled }: {
  onPublished: () => void;
  onImport: () => void;
  onExport: () => void;
  exportDisabled: boolean;
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
      <div className="version-io">
        <button onClick={onImport}>Import…</button>
        <button onClick={onExport} disabled={exportDisabled}>
          Export .fountain
        </button>
      </div>
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


function PropContextMenu({ at, selection, onClose, onDone }: {
  at: { x: number; y: number };
  selection: { lineId: string; from: number; to: number; text: string };
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const props = useQuery("SELECT id, name FROM prop ORDER BY name");
  const tag = async (propId: number): Promise<void> => {
    await tagPropRange(exec, selection.lineId, propId, selection.text,
                       selection.from, selection.to);
    onDone();
  };
  const createAndTag = async (): Promise<void> => {
    const name = window.prompt("New prop name:", selection.text.trim());
    if (name === null || name.trim() === "") {
      onClose();
      return;
    }
    await exec(
      "INSERT INTO prop (name, external_id_namespace) " +
      "VALUES (?, 'scf:editor')", [name.trim()]);
    const id = (await exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"] as number;
    await tag(id);
  };
  return (
    <>
      <div className="ctx-scrim" onClick={onClose}
           onContextMenu={(e) => {
             e.preventDefault();
             onClose();
           }} />
      <div className="ctx-menu" role="menu"
           style={{
             left: Math.min(at.x, window.innerWidth - 240),
             top: Math.min(at.y, window.innerHeight - 200),
           }}>
        <div className="ctx-head">
          Tag &ldquo;{selection.text.length > 24
            ? `${selection.text.slice(0, 24)}…`
            : selection.text}&rdquo; as prop
        </div>
        <button role="menuitem" onClick={() => void createAndTag()}>
          ＋ New prop…
        </button>
        {props.length > 0 && <div className="ctx-sep" />}
        <div className="ctx-scroll">
          {props.map((p) => (
            <button key={String(p["id"])} role="menuitem"
                    onClick={() => void tag(p["id"] as number)}>
              {String(p["name"])}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
