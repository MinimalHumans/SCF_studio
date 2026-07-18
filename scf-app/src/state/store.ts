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
import {
  SqlWorkerClient, readWorkingCopy, writeWorkingCopy,
} from "../db/workerClient.ts";
import { FsAccessAdapter, type FileAdapter } from "../files/fileAdapter.ts";
import { buildReferenceGraph, type IncomingRef }
  from "./registryGraph.ts";

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

export type NavMode = "subject" | "schema" | "queries" | "script";

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
  phase: "start" | "loading" | "open" | "error";
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
  openFromPicker: () => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;

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
  await client.close();
  if (bytes !== null) {
    await writeWorkingCopy(WORKING_PATH, bytes);
  }
  await client.open(WORKING_PATH);
  // Same init as Python: create/ALTER registry tables, uuid identity,
  // stamp schema_version. 1.x data migrations intentionally absent.
  await initDatabase(client.exec, registry,
                     { editorVersion: EDITOR_VERSION });
}

export const useStore = create<AppState>((set, get) => ({
  phase: "start",
  errorMessage: null,
  projectName: null,
  fileToken: null,
  fsAccessSupported: FsAccessAdapter.supported(),
  revision: 0,

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
      set({ phase: "open", projectName: "Hollow Creek (demo)",
            fileToken: null, revision: get().revision + 1 });
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
      set({ phase: "open", projectName: opened.name,
            fileToken: opened.token, revision: get().revision + 1 });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  newProject: async () => {
    set({ phase: "loading", errorMessage: null });
    try {
      // Empty OPFS working copy; initDatabase creates the format.
      await client.close();
      await writeWorkingCopy(WORKING_PATH, new Uint8Array());
      await client.open(WORKING_PATH);
      await initDatabase(client.exec, registry,
                         { editorVersion: EDITOR_VERSION });
      set({ phase: "open", projectName: "Untitled.scf", fileToken: null,
            revision: get().revision + 1 });
    } catch (e) {
      set({ phase: "error",
            errorMessage: e instanceof Error ? e.message : String(e) });
    }
  },

  saveProject: async () => {
    const { fileToken, projectName } = get();
    // Single-writer contract: close while bytes are read.
    await client.close();
    try {
      const bytes = await readWorkingCopy(WORKING_PATH);
      if (fileToken !== null) {
        await adapter.save(fileToken, bytes);
      } else {
        const saved = await adapter.saveAs(
          bytes, projectName ?? "project.scf");
        if (saved !== null) {
          set({ projectName: saved.name, fileToken: saved.token });
        }
      }
    } finally {
      await client.open(WORKING_PATH);
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
  },

  deleteRow: async (entity, id) => {
    await exec(`DELETE FROM ${q(entity)} WHERE id = ?`, [id]);
    const { openRow } = get();
    set({
      revision: get().revision + 1,
      ...(openRow?.entity === entity && openRow.id === id
        ? { openRow: null, draft: null } : {}),
    });
  },
}));

/** Display name for a row per the entity's nameField. */
export function rowName(entity: string, row: Row): string {
  const edef = registry.entities.get(entity);
  const v = row[edef?.nameField ?? "name"];
  if (v !== null && v !== undefined && v !== "") return String(v);
  return `${edef?.label ?? entity} #${String(row["id"])}`;
}

export function isDirty(draft: FormDraft | null): boolean {
  if (draft === null) return false;
  return Object.keys(draft.values).some(
    (k) => (draft.values[k] ?? null) !== (draft.original[k] ?? null));
}
