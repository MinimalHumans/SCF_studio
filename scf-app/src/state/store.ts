/**
 * store.ts — application state (Zustand).
 *
 * The SQLite client and file adapter are module singletons (non-reactive);
 * the store holds reactive state: project lifecycle, navigation, and the
 * form draft (dirty-state + undo at the form level, per the design doc).
 * `revision` is bumped after any write so lists and panels re-query.
 */

import { create } from "zustand";
import registryJson from "@registry/registry.json" with { type: "json" };
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { initDatabase, newUuid, q, type Row, type SqlValue }
  from "@scf-core/db.ts";
import { SqlWorkerClient } from "../db/workerClient.ts";
import { FsAccessAdapter, type FileAdapter } from "../files/fileAdapter.ts";
import { buildReferenceGraph, type IncomingRef,
         type NavigableSubject } from "./registryGraph.ts";
import { suggestSaveAsName } from "./saveName.ts";
import { reanchorSpansForMove } from "../editor/structureCommit.ts";
import { rowLabel } from "./displayName.ts";
import {
  captureForUndo, restoreFromUndo, type UndoEntry,
} from "./undoDelete.ts";
import {
  forgetHandle, forgetRoot, recallHandle, recallRoot, rememberHandle,
  rememberRoot,
} from "../files/handleStore.ts";
import type { ProjectFinding } from "@scf-core/project.ts";
import { resolveAllAssets, type ResolutionReport }
  from "@scf-core/assets.ts";
import { makeLocator } from "../files/assetLocator.ts";
import { setAssetLocator } from "../ui/queries/runners.ts";
import type { RootPermission } from "../files/fileAdapter.ts";
import { renumberForScene } from "../editor/shootOps.ts";

export { suggestSaveAsName };

export const registry: Registry =
  loadRegistry(registryJson as unknown as RegistryJson);
export const referenceGraph: Map<string, IncomingRef[]> =
  buildReferenceGraph(registry);

const WORKING_PATH = "working.scf";
const EDITOR_VERSION = "scf-app 0.1.0";

const client = new SqlWorkerClient();
const adapter: FileAdapter = new FsAccessAdapter();

/** scf-core's seam, app-wide. */
export const exec = client.exec;

/** Sentinel: every category collapsed. Resolved by CategoryTree, which
 * is the only place that knows the category names. */
export const COLLAPSE_ALL = new Set<string>(["\u0000all"]);

export type NavMode =
  "subject" | "schema" | "structure" | "queries" | "script" | "shoot" |
  "assets";

export interface OpenRow {
  entity: string;
  /** null = creating a new row */
  id: number | null;
}

interface FormDraft {
  entity: string;
  id: number | null;
  values: Record<string, SqlValue>;
  original: Record<string, SqlValue>;
  undoStack: Array<Record<string, SqlValue>>;
}

interface AppState {
  phase: "start" | "loading" | "open" | "error" | "multitab";
  errorMessage: string | null;
  projectName: string | null;
  fileToken: unknown | null;
  fsAccessSupported: boolean;
  folderSupported: boolean;
  /** The project folder handle (P2), or null for a degraded
   *  single-file session. Assets can only resolve when this is set. */
  projectRoot: unknown | null;
  rootPermission: RootPermission;
  /** Whether files can be reached THROUGH the root handle. Separate
   *  from listing: a machine can block enumeration and still traverse,
   *  or block both. P3's resolver depends on traversal and not at all
   *  on listing, so this is the capability that matters. */
  rootTraversal: "ok" | "blocked" | "unknown";
  rootTraversalError: string | null;
  /** Set when a picked folder held zero or several .scf files: the user
   *  chooses, the app never guesses (conventions §9). */
  folderChoice: { root: unknown; candidates: string[]; seen: string[];
                  report: string[];
                  findings: ProjectFinding[] } | null;
  revision: number;

  navMode: NavMode;
  /** Path-prefix filter for the Assets tab. Lives in the store because
   *  the tree (nav rail) and the list (main panel) are now separate
   *  components sharing one selection. */
  assetPrefix: string;
  /** How schema lists order rows where a story order exists. Global and
   * sticky, because a tab switch unmounts the list and losing the choice
   * every time is the same annoyance as the collapsing schema tree. */
  listSort: "story" | "name";
  selectedQuery: string | null;
  selectedEntityType: string | null;
  selectedSubject: { entity: string; id: number; name: string } | null;
  openRow: OpenRow | null;
  draft: FormDraft | null;

  openDemo: () => Promise<void>;
  resumeLast: () => Promise<void>;
  lastSession: string | null;
  /** revision at the last successful write to the user's .scf file —
   * anything newer lives only in browser storage. */
  lastSavedRevision: number;
  /** true while a file write is in flight — the topbar reflects it and
   * a second click can't start a concurrent export. */
  saving: boolean;
  closeProject: () => Promise<void>;
  setAssetPrefix: (prefix: string) => void;
  /** Record that something wrote rows outside the draft/commit path —
   *  bulk import, relink. `revision` is what marks the project dirty
   *  and what every asset view keys its refresh on, so a write that
   *  skips it leaves the file looking saved when it is not. */
  noteWrite: () => void;
  /** Record that rows were written outside the entity form — bulk
   *  import, relink. Bumps the revision so derived views re-read and
   *  the project registers as unsaved. */
  markChanged: () => void;
  openFromPicker: () => Promise<void>;
  /** Folder-first open: one directory gesture for project and assets. */
  openProjectFolder: () => Promise<void>;
  /** Open a named .scf from a folder the user already picked. */
  openFromFolderChoice: (name: string) => Promise<void>;
  dismissFolderChoice: () => void;
  /** Escape hatch when the root scan misses an .scf that is there. */
  pickScfInRoot: () => Promise<void>;
  /** Resolve every asset against the current root. Never throws. */
  resolveAssets: () => Promise<ResolutionReport>;
  /** Re-ask for a remembered root. Must run inside a click. */
  regrantRoot: () => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;
  /** Always prompts for a destination: rename or version up in place. */
  saveProjectAs: () => Promise<void>;

  setNavMode: (mode: NavMode) => void;
  selectQuery: (query: string | null) => void;
  selectEntityType: (entity: string | null) => void;
  selectSubject: (
    subject: { entity: string; id: number; name: string } | null) => void;
  /** Which subject type the rail is listing. In the store because the
   * main pane must not keep showing a subject of the previous type. */
  subjectType: NavigableSubject;
  setSubjectType: (subjectType: NavigableSubject) => void;
  openEntityRow: (entity: string, id: number | null) => Promise<void>;
  closeRow: () => void;

  setDraftValue: (field: string, value: SqlValue) => void;
  undoDraft: () => void;
  saveDraft: () => Promise<number | null>;
  setListSort: (listSort: "story" | "name") => void;
  deleteRow: (entity: string, id: number) => Promise<void>;
  /** Collapsed schema categories. In the store, not the component:
   * switching tabs unmounts the tree, and losing the expansion every
   * time is worse than the wall of categories it was hiding. */
  schemaCollapsed: Set<string>;
  setSchemaCollapsed: (next: Set<string>) => void;
  /** The last delete, restorable until dismissed or superseded. */
  undo: UndoEntry | null;
  undoDelete: () => Promise<void>;
  dismissUndo: () => void;
}

async function bootDatabase(
    bytes: ArrayBuffer | null): Promise<void> {
  if (bytes !== null) {
    await client.importBytes(WORKING_PATH, bytes);
  } else {
    await client.open(WORKING_PATH);
  }
  // Same init as Python: create/ALTER registry tables, uuid identity,
  // stamp schema_version. 1.x data migrations intentionally absent.
  await initDatabase(client.exec, registry,
                     { editorVersion: EDITOR_VERSION });
}

/**
 * Single-tab guard. The SAH pool's sync access handles are EXCLUSIVE —
 * a second tab (or a stale HMR worker) contending for them is exactly
 * the "Access Handles cannot be created…" failure, and a half-acquired
 * pool degrades unpredictably. One tab holds a Web Lock for the life of
 * the page; any other tab gets a clear screen instead of a broken app.
 */
function guardSingleTab(): void {
  if (!("locks" in navigator)) return;
  void navigator.locks.request("scf-working-db", { ifAvailable: true },
    (lock) => {
      if (lock === null) {
        useStore.setState({ phase: "multitab" });
        return Promise.resolve();
      }
      // Hold the lock until this page goes away.
      return new Promise<void>(() => undefined);
    });
}

// Vite HMR: a module reload here would orphan the old worker WITH its
// access handles still held — the same contention as a second tab. A
// full page reload is the only clean handoff for the database layer.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    client.terminate();
    window.location.reload();
  });
}

/**
 * The tail every folder open shares: boot the database, remember both
 * handles, land on the script.
 *
 * The root is remembered separately from the file handle, because a
 * reload keeps the handle and drops the PERMISSION. Recovering that is
 * one click inside a user gesture, which is why `regrantRoot` exists
 * rather than a silent retry: a page that could re-grant itself access
 * to a folder would make the original prompt meaningless.
 */
async function finishFolderOpen(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  root: FileSystemDirectoryHandle,
  opened: { name: string; bytes: ArrayBuffer; token: unknown },
): Promise<void> {
  set({ phase: "loading", errorMessage: null });
  await bootDatabase(opened.bytes);
  localStorage.setItem("scf:auto-resume", "1");
  localStorage.setItem("scf:last-session", opened.name);
  await rememberHandle(opened.token);
  await rememberRoot(root);
  const rev = get().revision + 1;
  // Probe traversal with the name the picker gave us, which is the
  // exact string P3's resolver would use — no typing, no paste
  // artefacts, and the answer arrives without anyone opening a console.
  const describe = (e: unknown): string => e instanceof DOMException
    ? `${e.name}: ${e.message}`
    : e instanceof Error ? e.message : String(e);

  let rootTraversal: "ok" | "blocked" = "blocked";
  let rootTraversalError: string | null = null;
  try {
    await root.getFileHandle(opened.name);
    rootTraversal = "ok";
  } catch (e) {
    const first = describe(e);
    // Second probe, with a name that cannot exist. The two failures
    // look nothing alike and mean opposite things: NotFoundError proves
    // traversal WORKS and the first failure was about that particular
    // name, while a repeat of the first error means the capability
    // itself is unavailable. Guessing between them from one sample is
    // what went wrong the last three times.
    try {
      await root.getFileHandle("__scf_traversal_probe__.tmp");
      rootTraversal = "ok";
    } catch (e2) {
      if (e2 instanceof DOMException && e2.name === "NotFoundError") {
        rootTraversal = "ok";
        rootTraversalError =
          `traversal works — but this project's own filename was ` +
          `rejected by the browser (${first}), so its assets resolve ` +
          `and it alone does not`;
      } else {
        rootTraversalError =
          `${first} (probe with a synthetic name: ${describe(e2)})`;
      }
    }
  }
  setAssetLocator(makeLocator(root));
  set({ schemaCollapsed: COLLAPSE_ALL, navMode: "script",
        phase: "open", projectName: opened.name,
        fileToken: opened.token, lastSession: opened.name,
        projectRoot: root,
        rootPermission: await adapter.rootPermission(root),
        rootTraversal, rootTraversalError,
        folderChoice: null,
        revision: rev, lastSavedRevision: rev });
}

export const useStore = create<AppState>((set, get) => ({
  phase: "start",
  schemaCollapsed: new Set<string>(),
  subjectType: "character",
  undo: null,
  lastSession: localStorage.getItem("scf:last-session"),
  errorMessage: null,
  projectName: null,
  fileToken: null,
  fsAccessSupported: FsAccessAdapter.supported(),
  folderSupported: FsAccessAdapter.folderSupported(),
  projectRoot: null,
  rootPermission: "none",
  rootTraversal: "unknown",
  rootTraversalError: null,
  folderChoice: null,
  revision: 0,
  lastSavedRevision: 0,
  saving: false,

  // The script is what a project is FOR: opening anywhere else means a
  // click before you can write. Every open path sets this too, so
  // closing one project and opening another lands on the script again.
  navMode: "script",
  assetPrefix: "",
  listSort: "story",
  selectedQuery: null,
  selectedEntityType: null,
  selectedSubject: null,
  openRow: null,
  draft: null,

  openDemo: async () => {
    set({ phase: "loading", errorMessage: null });
    try {
      const res = await fetch("/hollow_creek.scf");
      if (!res.ok) throw new Error(`demo fetch failed: ${res.status}`);
      await bootDatabase(await res.arrayBuffer());
      const check = await client.exec(
        "SELECT (SELECT COUNT(*) FROM character) + " +
        "(SELECT COUNT(*) FROM scene) AS n");
      if ((check[0]?.["n"] as number ?? 0) === 0) {
        throw new Error(
          "demo imported but contains no data — the imported bytes and " +
          "the opened database are not the same file (path mismatch " +
          "in the storage layer)");
      }
      localStorage.setItem("scf:last-session", "Hollow Creek (demo)");
      localStorage.setItem("scf:auto-resume", "1");
      const rev = get().revision + 1;
      set({ schemaCollapsed: COLLAPSE_ALL, navMode: "script",
            phase: "open", projectName: "Hollow Creek (demo)",
            fileToken: null, lastSession: "Hollow Creek (demo)",
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  /** Reopen the OPFS working database from the previous session — the
   * work is still there after a refresh; this is the path back to it. */
  resumeLast: async () => {
    set({ phase: "loading", errorMessage: null });
    try {
      if (!(await client.exists(WORKING_PATH))) {
        throw new Error("no previous session found in browser storage");
      }
      localStorage.setItem("scf:auto-resume", "1");
      await bootDatabase(null);
      const name = localStorage.getItem("scf:last-session") ?? "resumed";
      // The handle outlives the page: Save keeps targeting the same
      // file, and Chromium re-asks for write permission once.
      const fileToken = await recallHandle();
      // The root survives a reload; its permission does not. Report the
      // state rather than prompting — a prompt outside a click is
      // rejected by the browser anyway, and the topbar offers the
      // re-grant.
      const projectRoot = await recallRoot();
      const rev = get().revision + 1;
      set({ schemaCollapsed: COLLAPSE_ALL, navMode: "script",
            phase: "open", projectName: `${name}`, fileToken,
            projectRoot,
            rootPermission: projectRoot === null
              ? "none" : await adapter.rootPermission(projectRoot),
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  openFromPicker: async () => {
    try {
      const opened = await adapter.openScf();
      if (opened === null) return; // user cancelled
      set({ phase: "loading", errorMessage: null });
      await bootDatabase(opened.bytes);
      localStorage.setItem("scf:auto-resume", "1");
      localStorage.setItem("scf:last-session", opened.name);
      await rememberHandle(opened.token);
      const rev = get().revision + 1;
      set({ schemaCollapsed: COLLAPSE_ALL, navMode: "script",
            phase: "open", projectName: opened.name,
            fileToken: opened.token, lastSession: opened.name,
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  openProjectFolder: async () => {
    try {
      const picked = await adapter.openProject();
      if (picked === null) return; // user cancelled
      if (picked.file === null) {
        // Zero or several .scf at the root. Hand the findings back and
        // let the user decide; guessing here would silently open the
        // wrong film.
        set({ folderChoice: { root: picked.root,
                              candidates: picked.candidates,
                              seen: picked.seen,
                              report: picked.report,
                              findings: picked.findings } });
        return;
      }
      await finishFolderOpen(set, get, picked.root, picked.file);
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  openFromFolderChoice: async (name) => {
    const choice = get().folderChoice;
    if (choice === null) return;
    try {
      const root = choice.root as FileSystemDirectoryHandle;
      const opened = await adapter.readFromRoot(root, name);
      if (opened === null) {
        set({ errorMessage: `Could not read ${name}` });
        return;
      }
      set({ folderChoice: null });
      await finishFolderOpen(set, get, root, opened);
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  /**
   * The way in when the scan cannot find the .scf that is plainly
   * there. The root is already granted; this only asks which file, and
   * the project opens as a FOLDER session with assets resolvable — the
   * scan being wrong should not cost the user the folder.
   */
  pickScfInRoot: async () => {
    const choice = get().folderChoice;
    if (choice === null) return;
    try {
      const opened = await adapter.openScf();
      if (opened === null) return; // user cancelled
      set({ folderChoice: null });
      await finishFolderOpen(
        set, get, choice.root as FileSystemDirectoryHandle, opened);
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  setAssetPrefix: (assetPrefix) => set({ assetPrefix }),

  noteWrite: () => set({ revision: get().revision + 1 }),

  markChanged: () => set({ revision: get().revision + 1 }),

  dismissFolderChoice: () => set({ folderChoice: null }),

  resolveAssets: async () => {
    const root = get().projectRoot as FileSystemDirectoryHandle | null;
    // Keep the query layer's locator in step with the session: Q13
    // reports what resolves, and a stale root would make it lie.
    setAssetLocator(root === null ? null : makeLocator(root));
    return resolveAllAssets(exec, makeLocator(root));
  },

  regrantRoot: async () => {
    const root = get().projectRoot;
    if (root === null) return;
    set({ rootPermission: await adapter.requestRootPermission(root) });
  },

  newProject: async () => {
    // "loading" first, and awaited into the next task, so mounted views
    // unmount before the file is wiped. Wiping under a live workbench
    // left its queries hitting a half-built database — that is where
    // "no such table: screenplay_version_lines" came from, not from the
    // version code itself.
    set({ phase: "loading", errorMessage: null, openRow: null,
          draft: null, selectedSubject: null });
    await new Promise((r) => setTimeout(r, 0));
    try {
      // Fresh working database; initDatabase creates the format.
      await client.wipe(WORKING_PATH);
      await initDatabase(client.exec, registry,
                         { editorVersion: EDITOR_VERSION });
      const rev = get().revision + 1;
      set({ schemaCollapsed: COLLAPSE_ALL, navMode: "script",
            phase: "open", projectName: "Untitled.scf", fileToken: null,
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  /** Back to the start screen. The OPFS working copy stays — Resume
   * still works — but only the .scf file is durable. */
  closeProject: async () => {
    // Disarm auto-resume BEFORE the phase change, not after the awaits
    // below. App's resume effect fires the moment phase becomes
    // "start", reads this flag synchronously, and finds whatever is
    // there — so writing "0" four awaits later meant the first close of
    // a session always bounced straight back into the project it had
    // just left, and the reopen bumped the revision, so the SECOND
    // close warned about unsaved changes that were never made.
    localStorage.setItem("scf:auto-resume", "0");
    // Leave the workbench FIRST. Closing the database out from under
    // mounted views left their in-flight queries — and the script
    // editor's blur-triggered commit — resolving against no database,
    // which is where the "no database open" rejections came from.
    set({ phase: "start", fileToken: null, errorMessage: null,
          navMode: "script",
  assetPrefix: "", openRow: null, draft: null,
          selectedSubject: null, projectRoot: null,
          rootPermission: "none", rootTraversal: "unknown",
          rootTraversalError: null, folderChoice: null });
    await client.close();
    // Closing is deliberate: forget the file so the next boot offers the
    // start screen rather than silently reopening what was closed.
    await forgetHandle();
    await forgetRoot();
  },

  saveProject: async () => {
    const { fileToken, projectName, saving } = get();
    if (saving) return;
    set({ saving: true });
    try {
      // The watermark is the revision the BYTES represent, taken before
      // the export — not get().revision after the await, which would
      // silently mark any edit landing mid-save as already on disk.
      const at = get().revision;
      // Live snapshot — no close/reopen dance.
      const bytes = await client.exportBytes();
      if (fileToken !== null) {
        await adapter.save(fileToken, bytes);
        set({ lastSavedRevision: at });
      } else {
        // Never saved (demo / new project): first save picks the file.
        const saved = await adapter.saveAs(
          bytes, suggestSaveAsName(projectName));
        if (saved !== null) {
          localStorage.setItem("scf:last-session", saved.name);
          await rememberHandle(saved.token);
          set({ projectName: saved.name, fileToken: saved.token,
                lastSession: saved.name, lastSavedRevision: at });
        }
      }
    } catch (e) {
      set({ errorMessage:
        e instanceof Error ? e.message : String(e) });
    } finally {
      set({ saving: false });
    }
  },

  /**
   * Save As — always prompts, and the project follows the new file:
   * subsequent Save writes there, so this is how you version up
   * (hollow_creek_v2.scf) or rename without leaving the editor.
   */
  saveProjectAs: async () => {
    const { projectName, saving } = get();
    if (saving) return;
    set({ saving: true });
    try {
      const at = get().revision;
      const bytes = await client.exportBytes();
      const saved = await adapter.saveAs(
        bytes, suggestSaveAsName(projectName, true));
      if (saved !== null) {
        localStorage.setItem("scf:last-session", saved.name);
        await rememberHandle(saved.token);
        set({ projectName: saved.name, fileToken: saved.token,
              lastSession: saved.name, lastSavedRevision: at });
      }
    } catch (e) {
      set({ errorMessage:
        e instanceof Error ? e.message : String(e) });
    } finally {
      set({ saving: false });
    }
  },

  // A tab is a destination: arriving at one closes whatever record was
  // covering it, rather than showing the tab's rail beside someone
  // else's form.
  setListSort: (listSort) => set({ listSort }),
  setNavMode: (navMode) => set({ navMode, openRow: null, draft: null }),
  setSchemaCollapsed: (schemaCollapsed) => set({ schemaCollapsed }),
  selectQuery: (selectedQuery) =>
    set({ selectedQuery, openRow: null, draft: null }),
  selectEntityType: (selectedEntityType) =>
    set({ selectedEntityType, openRow: null, draft: null }),
  setSubjectType: (subjectType) =>
    set({ subjectType, selectedSubject: null, openRow: null, draft: null }),
  selectSubject: (selectedSubject) =>
    set({ selectedSubject, openRow: null, draft: null }),

  openEntityRow: async (entity, id) => {
    const edef = registry.entities.get(entity);
    if (edef === undefined) return;
    let values: Record<string, SqlValue> = {};
    if (id !== null) {
      const rows = await exec(
        `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
      values = { ...(rows[0] ?? {}) };
    } else {
      for (const f of edef.fields) {
        values[f.name] = (f.default as SqlValue | undefined) ?? null;
      }
    }
    set({
      openRow: { entity, id },
      draft: { entity, id, values, original: { ...values },
               undoStack: [] },
    });
  },

  closeRow: () => set({ openRow: null, draft: null }),

  setDraftValue: (field, value) => {
    const draft = get().draft;
    if (draft === null) return;
    set({
      draft: {
        ...draft,
        undoStack: [...draft.undoStack.slice(-49), { ...draft.values }],
        values: { ...draft.values, [field]: value },
      },
    });
  },

  undoDraft: () => {
    const draft = get().draft;
    if (draft === null || draft.undoStack.length === 0) return;
    const previous = draft.undoStack[draft.undoStack.length - 1];
    if (previous === undefined) return;
    set({
      draft: {
        ...draft,
        values: previous,
        undoStack: draft.undoStack.slice(0, -1),
      },
    });
  },

  saveDraft: async () => {
   try {
    const draft = get().draft;
    if (draft === null) return null;
    const edef = registry.entities.get(draft.entity);
    if (edef === undefined) return null;
    const fieldNames = edef.fields.map((f) => f.name);

    if (draft.id === null) {
      // INSERT with uuid stamped, same as Python create_entity.
      const filtered = Object.entries(draft.values)
        .filter(([k, v]) => fieldNames.includes(k) &&
                            v !== null && v !== "");
      const cols = [...filtered.map(([k]) => k), "uuid"];
      const vals: SqlValue[] = [...filtered.map(([, v]) => v), newUuid()];
      await exec(
        `INSERT INTO ${q(draft.entity)} ` +
        `(${cols.map(q).join(", ")}) ` +
        `VALUES (${cols.map(() => "?").join(", ")})`, vals);
      const idRow = await exec("SELECT last_insert_rowid() AS id");
      const newId = idRow[0]?.["id"] as number;
      set({ revision: get().revision + 1 });
      await get().openEntityRow(draft.entity, newId);
      return newId;
    }

    // A shot moved to another scene is renumbered before the write, so
    // the form does not save "5A" onto scene 66. The scene renumbering
    // case is the opposite and leaves the number alone — see
    // renumberForScene.
    if (draft.entity === "shot") {
      const target = draft.values["scene_id"];
      if (target !== null && target !== undefined && target !== "") {
        const renumbered = await renumberForScene(
          exec, draft.id, Number(target));
        if (renumbered !== null) draft.values["shot_number"] = renumbered;
      }
    }

    // Whole-row UPDATE, same as v1; updated_at written faithfully
    // (collaboration prep, decision 10).
    const sets = fieldNames.map((f) => `${q(f)} = ?`).join(", ");
    const vals: SqlValue[] =
      fieldNames.map((f) => draft.values[f] ?? null);
    await exec(
      `UPDATE ${q(draft.entity)} SET ${sets}, ` +
      `updated_at = datetime('now') WHERE id = ?`,
      [...vals, draft.id]);
    set({ revision: get().revision + 1 });
    await get().openEntityRow(draft.entity, draft.id);
    return draft.id;
   } catch (e) {
    set({ errorMessage: `Save failed: ${
      e instanceof Error ? e.message : String(e)}` });
    return null;
   }
  },

  deleteRow: async (entity, id) => {
    let undo: UndoEntry | null = null;
    try {
      const existing = await exec(
        `SELECT * FROM ${q(entity)} WHERE id = ?`, [id]);
      undo = await captureForUndo(
        exec, registry, entity, id,
        existing[0] === undefined
          ? entity : rowLabel(registry.entities.get(entity), entity,
                              existing[0]));
      // An act or sequence is anchored to a START SCENE, so deleting
      // that scene leaves the span pointing at nothing — it stops
      // appearing in the structure entirely, and every scene it held
      // falls out of any act, taking the Shoot tab's grouping with it.
      // The row was never actually deleted; it just became invisible.
      // Same answer as moving the anchor scene: hand the boundary to
      // whatever now sits where the old one did.
      if (entity === "scene") {
        const headings = await exec(
          "SELECT scene_id FROM screenplay_lines " +
          "WHERE line_type = 'heading' AND scene_id IS NOT NULL " +
          "ORDER BY line_order");
        const order: number[] = [];
        for (const row of headings) {
          const sceneId = Number(row["scene_id"]);
          if (!order.includes(sceneId)) order.push(sceneId);
        }
        await reanchorSpansForMove(exec, id, order);
      }
      await exec(`DELETE FROM ${q(entity)} WHERE id = ?`, [id]);
    } catch (e) {
      set({ errorMessage: `Delete failed: ${
        e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const { openRow } = get();
    set({
      revision: get().revision + 1,
      undo,
      ...(openRow?.entity === entity && openRow.id === id
        ? { openRow: null, draft: null } : {}),
    });
  },

  undoDelete: async () => {
    const undo = get().undo;
    if (undo === null) return;
    try {
      await restoreFromUndo(exec, undo);
      set({ revision: get().revision + 1, undo: null });
    } catch (e) {
      set({ errorMessage: `Undo failed: ${
        e instanceof Error ? e.message : String(e)}` });
    }
  },

  dismissUndo: () => set({ undo: null }),
}));

/**
 * Display name for a row. Scene rows lead with their number — headings
 * repeat across an imported script, numbers do not. Link rows have no
 * name of their own; those callers use `linkLabel` with resolved
 * references instead (see displayName.ts).
 */
export function rowName(entity: string, row: Row): string {
  return rowLabel(registry.entities.get(entity), entity, row);
}

export function isDirty(draft: FormDraft | null): boolean {
  if (draft === null) return false;
  return Object.keys(draft.values).some(
    (k) => (draft.values[k] ?? null) !== (draft.original[k] ?? null));
}

guardSingleTab();
