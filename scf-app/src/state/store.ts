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
import { buildReferenceGraph, type IncomingRef }
  from "./registryGraph.ts";
import { suggestSaveAsName } from "./saveName.ts";
import { rowLabel } from "./displayName.ts";

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

export type NavMode =
  "subject" | "schema" | "structure" | "queries" | "script";

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
  revision: number;

  navMode: NavMode;
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
  openFromPicker: () => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;
  /** Always prompts for a destination: rename or version up in place. */
  saveProjectAs: () => Promise<void>;

  setNavMode: (mode: NavMode) => void;
  selectQuery: (query: string | null) => void;
  selectEntityType: (entity: string | null) => void;
  selectSubject: (
    subject: { entity: string; id: number; name: string } | null) => void;
  openEntityRow: (entity: string, id: number | null) => Promise<void>;
  closeRow: () => void;

  setDraftValue: (field: string, value: SqlValue) => void;
  undoDraft: () => void;
  saveDraft: () => Promise<number | null>;
  deleteRow: (entity: string, id: number) => Promise<void>;
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

export const useStore = create<AppState>((set, get) => ({
  phase: "start",
  lastSession: localStorage.getItem("scf:last-session"),
  errorMessage: null,
  projectName: null,
  fileToken: null,
  fsAccessSupported: FsAccessAdapter.supported(),
  revision: 0,
  lastSavedRevision: 0,
  saving: false,

  navMode: "subject",
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
      const rev = get().revision + 1;
      set({ phase: "open", projectName: "Hollow Creek (demo)",
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
      await bootDatabase(null);
      const name = localStorage.getItem("scf:last-session") ?? "resumed";
      const rev = get().revision + 1;
      set({ phase: "open", projectName: `${name}`, fileToken: null,
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
      localStorage.setItem("scf:last-session", opened.name);
      const rev = get().revision + 1;
      set({ phase: "open", projectName: opened.name,
            fileToken: opened.token, lastSession: opened.name,
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  newProject: async () => {
    set({ phase: "loading", errorMessage: null });
    try {
      // Fresh working database; initDatabase creates the format.
      await client.wipe(WORKING_PATH);
      await initDatabase(client.exec, registry,
                         { editorVersion: EDITOR_VERSION });
      const rev = get().revision + 1;
      set({ phase: "open", projectName: "Untitled.scf", fileToken: null,
            revision: rev, lastSavedRevision: rev });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  /** Back to the start screen. The OPFS working copy stays — Resume
   * still works — but only the .scf file is durable. */
  closeProject: async () => {
    await client.close();
    set({ phase: "start", fileToken: null, errorMessage: null });
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

  setNavMode: (navMode) => set({ navMode }),
  selectQuery: (selectedQuery) =>
    set({ selectedQuery, openRow: null, draft: null }),
  selectEntityType: (selectedEntityType) =>
    set({ selectedEntityType, openRow: null, draft: null }),
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
    try {
      await exec(`DELETE FROM ${q(entity)} WHERE id = ?`, [id]);
    } catch (e) {
      set({ errorMessage: `Delete failed: ${
        e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const { openRow } = get();
    set({
      revision: get().revision + 1,
      ...(openRow?.entity === entity && openRow.id === id
        ? { openRow: null, draft: null } : {}),
    });
  },
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
