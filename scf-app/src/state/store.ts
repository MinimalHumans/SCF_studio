// SPDX-License-Identifier: Apache-2.0
/**
 * store.ts — application state (Zustand).
 *
 * The host connection and the asset-folder adapter are module
 * singletons (non-reactive); the store holds reactive state: project
 * lifecycle, navigation, and the form draft — dirty-state and undo at
 * the form level. `revision` is the host's, and moves after any write
 * by any client, so lists and panels re-query.
 */

import { create } from "zustand";
import registryJson from "@registry/registry.json" with { type: "json" };
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { q, type Row, type SqlExec, type SqlValue } from "@scf-core/db.ts";
import { FsAccessAdapter, type FileAdapter }
  from "../files/fileAdapter.ts";
import { createHostChooser } from "../files/hostChooser.ts";
import type { ProjectChooser } from "../files/projectChooser.ts";
import { getHost } from "../host/hostClient.ts";
import type { HostClient } from "@scf-host/client.ts";
import { buildReferenceGraph, type IncomingRef,
         type NavigableSubject } from "./registryGraph.ts";
import { suggestSaveAsName } from "./saveName.ts";
import { call } from "./api.ts";
import { rowLabel } from "@scf-core/displayName.ts";
import { type UndoEntry } from "@scf-core/ops/undoDelete.ts";
import { type ChangeUndo } from "@scf-core/ops/undoChange.ts";
import {
  forgetRoot, recallPairFor, rememberPair, rememberRoot,
} from "../files/handleStore.ts";
import { resolveAllAssets, type ResolutionReport }
  from "@scf-core/assets.ts";
import { makeLocator } from "../files/assetLocator.ts";
import { revokeAll } from "../files/objectUrlCache.ts";
import { clearResolutions } from "../files/thumbnailCache.ts";
import { setAssetLocator } from "../ui/queries/runners.ts";
import type { RootMode, RootPermission } from "../files/fileAdapter.ts";

export { suggestSaveAsName };

export const registry: Registry =
  loadRegistry(registryJson as unknown as RegistryJson);
export const referenceGraph: Map<string, IncomingRef[]> =
  buildReferenceGraph(registry);

const EDITOR_VERSION = "scf-app 0.1.0";

/** The asset folder is the one thing still acquired through the browser. */
const adapter: FileAdapter = new FsAccessAdapter();
/** How the user names a `.scf`; the host lists folders for it today. */
const chooser: ProjectChooser = createHostChooser();

/**
 * scf-core's read seam, app-wide. Reads go to the host's read-only
 * connection on whichever film this window has open; writes never go
 * through here (see `call` in api.ts).
 */
export const exec: SqlExec = async (sql, params) =>
  (await getHost()).exec(sql, params);

/** Sentinel: every category collapsed. Resolved by CategoryTree, which
 * is the only place that knows the category names. */
export const COLLAPSE_ALL = new Set<string>(["\u0000all"]);

export type NavMode =
  // Where an opened project lands: a neutral page, not any one section.
  "intro" | "project" |
  "subject" | "schema" | "structure" | "queries" | "script" | "shoot" |
  "assets" | "characters" | "locations" | "props" |
  // Presentation: read-only views of the film, made to be handed on.
  "screenplay" | "storyboard" | "shotlist" | "gallery";

export { CHARACTER_TABS, type CharacterTab } from "./characterLayout.ts";
import type {
  LocationTab, PropTab, SubjectKind,
} from "./subjectKinds.ts";
import type { CharacterTab } from "./characterLayout.ts";

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
  /** The open film's path on the host; null when none is open. */
  projectPath: string | null;
  /** Whether the browser can supply an asset folder (Chromium). */
  folderSupported: boolean;
  /** The window's link to the host: starting (retried), ready, or
   *  given up on with a reason. */
  hostStatus: "connecting" | "ready" | "unavailable";
  hostError: string | null;
  /** The connection dropped while a film was open. */
  hostLost: boolean;
  /** The file changed on disk behind the host; writes are refused
   *  until it is reloaded. */
  externalChange: boolean;
  /** The last change another client made to this film (the MCP, say),
   *  so it is attributed rather than appearing from nowhere. */
  externalEdit: { by: string; revision: number } | null;
  dismissExternalEdit: () => void;
  /** The project's asset folder handle, or null when none is attached.
   *  Assets can only resolve when this is set. */
  projectRoot: unknown | null;
  rootPermission: RootPermission;
  /** Which grant the root was acquired under. Carried because querying
   *  in the wrong mode misreports a working folder as needing
   *  reconnection. */
  rootMode: RootMode;
  /** Whether anything CHECKED that this folder holds the open file.
   *  False for a root attached to a session with no file on disk — the
   *  demo, an unsaved project — where the pairing is the user's word
   *  and the UI has to say so rather than imply a check happened. */
  rootVerified: boolean;
  /** Bumped when the ENVIRONMENT changes rather than the data: a folder
   *  attached, a permission re-granted. Asset resolution and Q13 depend
   *  on it and must re-run; `revision` cannot carry it, because
   *  `revision !== lastSavedRevision` is what marks the project unsaved
   *  and attaching a folder writes nothing. */
  environmentRevision: number;
  /** Why the last attach was refused, for the topbar. Null when there
   *  is nothing to say. */
  attachError: string | null;
  /** Whether files can be reached THROUGH the root handle. Separate
   *  from listing: a machine can block enumeration and still traverse,
   *  or block both. P3's resolver depends on traversal and not at all
   *  on listing, so this is the capability that matters. */
  rootTraversal: "ok" | "blocked" | "unknown";
  rootTraversalError: string | null;
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
  /** The character open in the Characters workspace. Lives in the store
   *  so "open record" and back returns to the same character and tab —
   *  the workspace unmounts while a raw record is shown. */
  selectedCharacterId: number | null;
  characterTab: CharacterTab;
  /** The "as of scene" position the workspace shows what is in force
   *  at. Null shows baselines. Kept across characters: comparing who
   *  looks how in one scene is the point of it. */
  asOfSceneId: number | null;
  setAsOfScene: (id: number | null) => void;
  /** The location and prop open in their workspaces, and their tabs. */
  selectedLocationId: number | null;
  locationTab: LocationTab;
  selectedPropId: number | null;
  propTab: PropTab;
  /** One way in for all three kinds, so the shared shell and rail need
   *  not know which kind they are showing. */
  selectSubjectOf: (kind: SubjectKind, id: number | null) => void;
  setTabOf: (kind: SubjectKind, tab: string) => void;
  /** A screenplay line the Script view should open at when it next
   *  loads — how other sections say "show me this line". Consumed once. */
  pendingScriptLine: string | null;
  /** By the line's uuid: line identity survives edits, and the document
   *  does not number its lines the way the table does. */
  openScriptAt: (lineUuid: string) => void;
  takePendingScriptLine: () => string | null;
  /** Open a character's workspace, from anywhere. */
  openCharacter: (id: number) => void;
  /** Open any narrative element's workspace, from anywhere. */
  openSubject: (kind: SubjectKind, id: number) => void;
  selectCharacter: (id: number | null) => void;
  setCharacterTab: (tab: CharacterTab) => void;
  draft: FormDraft | null;

  /** Connect to the host (retrying while it starts). Safe to repeat. */
  connect: () => Promise<void>;
  /** After a dropped connection: connect again and reopen the film. */
  reconnect: () => Promise<void>;
  /** After `externalChange`: read the file again from disk. */
  reloadFromDisk: () => Promise<void>;
  openDemo: () => Promise<void>;
  resumeLast: () => Promise<void>;
  /** Path of the last film opened, for resuming after a reload. */
  lastSession: string | null;
  closeProject: () => Promise<void>;
  setAssetPrefix: (prefix: string) => void;
  openFromPicker: () => Promise<void>;
  /** Attach the asset folder to the film that is open. Must run
   *  inside a click: it opens a picker. */
  attachFolder: () => Promise<void>;
  dismissAttachError: () => void;
  /** Resolve every asset against the current root. Never throws. */
  resolveAssets: () => Promise<ResolutionReport>;
  /** Re-ask for a remembered root. Must run inside a click. */
  regrantRoot: () => Promise<void>;
  newProject: () => Promise<void>;
  /** Copy the film to a new path and carry on there: rename or version
   *  up. Every edit is already in the file; there is no Save. */
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
  /** Where the Shoot tab was left. Opening a shot's record replaces the
   *  view, and coming back to every scene collapsed at the top lost the
   *  place you were planning from — so the expansion, the filter and the
   *  scroll outlive the component, until the project changes. */
  shootView: ShootMemory;
  setShootView: (patch: Partial<ShootMemory>) => void;
  /** The last delete, restorable until dismissed or superseded. */
  undo: UndoEntry | null;
  /** The last workspace change, if it was more recent than any delete:
   *  one toast, one Undo, whichever kind the last action was. */
  lastChange: ChangeUndo | null;
  recordChange: (change: ChangeUndo) => void;
  undoLastChange: () => Promise<void>;
  undoDelete: () => Promise<void>;
  dismissUndo: () => void;
}

/**
 * One window at a time. Two windows on the same film would each keep
 * their own copy of the script document and each commit it whole, so
 * the later commit would silently overwrite the earlier one. One tab
 * holds a Web Lock for the life of the page; any other tab gets a clear
 * screen instead of two editors that disagree.
 */
function guardSingleTab(): void {
  if (!("locks" in navigator)) return;
  void navigator.locks.request("scf-window", { ifAvailable: true },
    (lock) => {
      if (lock === null) {
        useStore.setState({ phase: "multitab" });
        return Promise.resolve();
      }
      // Hold the lock until this page goes away.
      return new Promise<void>(() => undefined);
    });
}

// Vite HMR: a reload of this module would leave the old store's host
// subscriptions running beside the new one's. A full page reload is the
// only clean handoff.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.location.reload();
  });
}

/** The file name of a host path, for the title and the Save As suggestion. */
const nameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Hosts whose events and closing this store already listens to. */
const bound = new WeakSet<HostClient>();

/**
 * Keep the store in step with the host: another client's write (the MCP,
 * say) arrives as a revision and every view re-reads, exactly as for a
 * local edit; a dropped connection is surfaced instead of leaving the
 * window silently dead.
 */
function bindHost(host: HostClient): void {
  if (bound.has(host)) return;
  bound.add(host);
  host.subscribe((event) => {
    useStore.setState((st) => ({
      revision: Math.max(st.revision, event.revision),
      // Our own name is "window"; anything else made this change.
      ...(event.event === "revision" && event.by !== "window"
        ? { externalEdit: { by: event.by, revision: event.revision } }
        : {}),
    }));
  });
  host.onClose(() => {
    if (useStore.getState().phase === "open") {
      useStore.setState({ hostLost: true });
    }
  });
}

function describeError(e: unknown): string {
  return e instanceof DOMException ? `${e.name}: ${e.message}`
    : e instanceof Error ? e.message : String(e);
}

/**
 * Can files be reached THROUGH this root?
 *
 * Probed with the project's own filename, which is the exact string
 * P3's resolver would use — no typing, no paste artefacts, and the
 * answer arrives without anyone opening a console.
 *
 * Lives here rather than inside the open path because attaching a
 * folder mid-session needs the identical answer, and a second copy of
 * this reasoning would eventually disagree with the first.
 */
async function probeTraversal(
  root: FileSystemDirectoryHandle, fileName: string | null,
): Promise<{ rootTraversal: "ok" | "blocked";
             rootTraversalError: string | null }> {
  // A session with no file on disk (demo, unsaved project) has no
  // name to probe with, so the synthetic probe is the only one.
  if (fileName !== null) {
    try {
      await root.getFileHandle(fileName);
      return { rootTraversal: "ok", rootTraversalError: null };
    } catch (e) {
      return await syntheticProbe(root, describeError(e));
    }
  }
  return await syntheticProbe(root, null);
}

/**
 * The second probe, with a name that cannot exist. The two failures
 * mean opposite things: NotFoundError proves traversal WORKS and the
 * first failure was about that particular name, while a repeat of the
 * first error means the capability itself is unavailable. One sample
 * cannot tell them apart.
 */
async function syntheticProbe(
  root: FileSystemDirectoryHandle, first: string | null,
): Promise<{ rootTraversal: "ok" | "blocked";
             rootTraversalError: string | null }> {
  try {
    await root.getFileHandle("__scf_traversal_probe__.tmp");
    return { rootTraversal: "ok", rootTraversalError: null };
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") {
      return {
        rootTraversal: "ok",
        rootTraversalError: first === null ? null
          : `traversal works — but this project's own filename was ` +
            `rejected by the browser (${first}), so its assets resolve ` +
            `and it alone does not`,
      };
    }
    return {
      rootTraversal: "blocked",
      rootTraversalError: first === null
        ? describeError(e)
        : `${first} (probe with a synthetic name: ${describeError(e)})`,
    };
  }
}

/**
 * Put a root into the session: probe it, wire the locator, remember it
 * against the file it belongs to, and tell the views to re-resolve.
 *
 * Shared by both acquisition orders, in one place rather than two:
 * whichever way the folder arrived, everything downstream is identical,
 * which is what conventions §9 claims ("the resulting session is
 * identical in every respect").
 */
async function applyRoot(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  root: FileSystemDirectoryHandle,
  opts: { filePath: string | null; fileName: string | null;
          mode: RootMode;
          verified: boolean },
): Promise<void> {
  // Anything held now describes the PREVIOUS root. Bytes from a project
  // the user has left are worse than a blank thumbnail, because they
  // look like they worked. Drawn thumbnails are keyed by path, mtime
  // and size and are safe to keep — the resolutions that FOUND those
  // paths are not.
  revokeAll();
  clearResolutions();
  const probe = await probeTraversal(root, opts.fileName);
  await rememberRoot(root);
  await rememberPair(opts.filePath, root, opts.mode);
  setAssetLocator(makeLocator(root));
  set({ projectRoot: root,
        rootPermission: await adapter.rootPermission(root, opts.mode),
        rootMode: opts.mode,
        rootVerified: opts.verified,
        attachError: null,
        environmentRevision: get().environmentRevision + 1,
        ...probe });
}

export interface ShootMemory {
  /** Expanded rows: `scene:<id>`, and `script:<id>` for a scene whose
   *  text is showing. */
  open: Set<string>;
  showEmpty: boolean;
  /** Hide shots whose lifecycle_status is `cut`. */
  hideCut: boolean;
  scrollTop: number;
}

/**
 * The Shoot tab's two filters are preferences, not film data, so they
 * live in the browser and outlast opening another file. Storage can
 * throw (private windows, blocked site data); the defaults then apply.
 */
const SHOOT_PREFS = {
  showEmpty: "scf:shoot-show-empty", hideCut: "scf:shoot-hide-cut",
} as const;

function readShootPref(key: keyof typeof SHOOT_PREFS,
                       fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(SHOOT_PREFS[key]);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeShootPrefs(patch: Partial<ShootMemory>): void {
  try {
    for (const key of ["showEmpty", "hideCut"] as const) {
      const v = patch[key];
      if (v !== undefined) localStorage.setItem(SHOOT_PREFS[key], v ? "1" : "0");
    }
  } catch {
    // Not remembered this time; the view still changes.
  }
}

const freshShootView = (): ShootMemory =>
  ({ open: new Set(), showEmpty: readShootPref("showEmpty", true),
     hideCut: readShootPref("hideCut", false), scrollTop: 0 });

/**
 * The tail every open shares: land on the script, with nothing of the
 * previous project left behind, and pick up the asset folder this
 * project was last used with.
 *
 * The folder is recalled by the project's path, and its permission is
 * reported rather than requested: a reload drops the permission, and
 * asking outside a click is refused by the browser anyway. The topbar
 * offers the re-grant.
 */
async function finishOpen(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  path: string, revision: number,
): Promise<void> {
  localStorage.setItem("scf:auto-resume", "1");
  localStorage.setItem("scf:last-session", path);
  // Clear the root EXPLICITLY. Opening a film while another is live
  // otherwise leaves `projectRoot` untouched, and the new project
  // inherits the old one's folder — addressing every asset against
  // another film's disk. Nothing reports it, because a stale root
  // resolves perfectly well.
  setAssetLocator(null);
  revokeAll();
  clearResolutions();
  set({ schemaCollapsed: COLLAPSE_ALL, navMode: "intro",
        shootView: freshShootView(),
        selectedCharacterId: null, asOfSceneId: null,
        selectedLocationId: null, selectedPropId: null,
        openRow: null, draft: null, undo: null, lastChange: null,
        phase: "open", projectName: nameOf(path), projectPath: path,
        lastSession: path, revision, hostLost: false,
        externalChange: false, errorMessage: null,
        externalEdit: null,
        projectRoot: null, rootPermission: "none", rootMode: "read",
        rootVerified: false, attachError: null,
        rootTraversal: "unknown", rootTraversalError: null,
        environmentRevision: get().environmentRevision + 1 });
  const pair = await recallPairFor(path);
  if (pair !== null) {
    await applyRoot(set, get, pair.root as FileSystemDirectoryHandle, {
      filePath: path, fileName: nameOf(path),
      mode: pair.mode, verified: true,
    });
  }
}

export const useStore = create<AppState>((set, get) => ({
  phase: "start",
  schemaCollapsed: new Set<string>(),
  shootView: freshShootView(),
  subjectType: "character",
  undo: null,
  lastChange: null,
  lastSession: localStorage.getItem("scf:last-session"),
  errorMessage: null,
  projectName: null,
  projectPath: null,
  folderSupported: FsAccessAdapter.folderSupported(),
  hostStatus: "connecting",
  hostError: null,
  hostLost: false,
  externalChange: false,
  externalEdit: null,
  dismissExternalEdit: () => useStore.setState({ externalEdit: null }),
  projectRoot: null,
  rootPermission: "none",
  rootMode: "read",
  rootVerified: false,
  environmentRevision: 0,
  attachError: null,
  rootTraversal: "unknown",
  rootTraversalError: null,
  revision: 0,

  // The script is what a project is FOR: opening anywhere else means a
  // click before you can write. Every open path sets this too, so
  // closing one project and opening another lands on the script again.
  navMode: "intro", selectedCharacterId: null, characterTab: "Profile",
  asOfSceneId: null, selectedLocationId: null, locationTab: "Profile",
  selectedPropId: null, propTab: "Profile",
  assetPrefix: "",
  listSort: "story",
  selectedQuery: null,
  selectedEntityType: null,
  selectedSubject: null,
  openRow: null,
  draft: null,

  connect: async () => {
    set({ hostStatus: "connecting", hostError: null });
    try {
      bindHost(await getHost({
        retry: {
          // The host starts with the dev server but not before it; say
          // so rather than showing nothing for the first seconds.
          onWait: (attempt) => {
            if (attempt >= 3) {
              set({ hostError: "Still waiting for the SCF host to start…" });
            }
          },
        },
      }));
      set({ hostStatus: "ready", hostError: null });
    } catch (e) {
      set({ hostStatus: "unavailable", hostError: describeError(e) });
    }
  },

  reconnect: async () => {
    const path = get().projectPath;
    try {
      const host = await getHost();
      bindHost(host);
      if (path !== null) {
        const opened = await host.open(path, { migrate: false });
        set({ hostLost: false, externalChange: false,
              hostStatus: "ready", hostError: null,
              revision: Math.max(get().revision, opened.revision),
              environmentRevision: get().environmentRevision + 1 });
      }
    } catch (e) {
      set({ errorMessage: `Could not reconnect: ${describeError(e)}` });
    }
  },

  reloadFromDisk: async () => {
    try {
      const host = await getHost();
      const revision = await host.reload();
      set({ externalChange: false,
            revision: Math.max(get().revision, revision),
            environmentRevision: get().environmentRevision + 1 });
    } catch (e) {
      set({ errorMessage: `Could not reload: ${describeError(e)}` });
    }
  },

  openDemo: async () => {
    // Asked first: the demo has to live somewhere, and every edit is
    // written straight to its file.
    const path = await chooser.chooseNew("Hollow Creek (demo).scf");
    if (path === null) return;
    set({ phase: "loading", errorMessage: null });
    try {
      const res = await fetch("/hollow_creek.scf");
      if (!res.ok) throw new Error(`demo fetch failed: ${String(res.status)}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const host = await getHost();
      bindHost(host);
      const made = await host.create(path, { bytes });
      // Migrated through the open path below, which stamps the editor.
      const opened = await host.open(made.path, {
        migrate: true, editorVersion: EDITOR_VERSION });
      const check = await host.exec(
        "SELECT (SELECT COUNT(*) FROM character) + " +
        "(SELECT COUNT(*) FROM scene) AS n");
      if ((check[0]?.["n"] as number ?? 0) === 0) {
        throw new Error("the demo was copied but contains no data");
      }
      await finishOpen(set, get, opened.path, opened.revision);
    } catch (e) {
      set({ phase: "error", errorMessage: describeError(e) });
    }
  },

  /** Reopen the film this window had open before a reload. */
  resumeLast: async () => {
    const path = localStorage.getItem("scf:last-session");
    if (path === null) return;
    set({ phase: "loading", errorMessage: null });
    try {
      const host = await getHost();
      bindHost(host);
      const opened = await host.open(path, {
        migrate: true, editorVersion: EDITOR_VERSION });
      await finishOpen(set, get, opened.path, opened.revision);
    } catch (e) {
      // The file moved or was deleted: forget it, so the start screen
      // is offered next time instead of the same failure.
      localStorage.removeItem("scf:last-session");
      set({ phase: "start", lastSession: null,
            errorMessage: `Could not reopen ${nameOf(path)}: ${
              describeError(e)}` });
    }
  },

  openFromPicker: async () => {
    const path = await chooser.chooseExisting();
    if (path === null) return;                           // user cancelled
    set({ phase: "loading", errorMessage: null });
    try {
      const host = await getHost();
      bindHost(host);
      const opened = await host.open(path, {
        migrate: true, editorVersion: EDITOR_VERSION });
      await finishOpen(set, get, opened.path, opened.revision);
    } catch (e) {
      set({ phase: "error", errorMessage: describeError(e) });
    }
  },

  /**
   * The folder, asked for after the file — the other half of file-first
   * opening, and the only route to assets for a session that started
   * from a plain `.scf`.
   *
   * The refusal is the point. `resolve()` says whether the picked
   * folder actually holds this file, and anything other than "at its
   * root" is reported and dropped rather than accepted. A wrong
   * acceptance would not fail loudly: every identifier would resolve
   * against the wrong place, some of them successfully, and the project
   * would look fine while pointing at another film's assets.
   *
   * A session with no file on disk cannot be checked at all. That is
   * not a reason to refuse — it is the demo, and pointing it at a
   * downloaded asset folder is a legitimate thing to want — but the
   * session is marked unverified and the topbar says so.
   */
  attachFolder: async () => {
    const { projectPath, projectName } = get();
    set({ attachError: null });
    try {
      const attached = await adapter.attachRoot(projectName);
      if (attached === null) return;                     // user cancelled
      if (attached.pairing !== null &&
          attached.pairing.kind !== "at-root") {
        set({ attachError: attached.pairing.message });
        return;
      }
      await applyRoot(set, get, attached.root, {
        filePath: projectPath, fileName: projectName,
        mode: "read", verified: attached.pairing !== null,
      });
    } catch (e) {
      // A failed attach must not cost the user their session: this is
      // an addition to an open project, not an open. Reported inline
      // rather than through `phase: "error"`, which unmounts the
      // workbench.
      set({ attachError: describeError(e) });
    }
  },

  dismissAttachError: () => set({ attachError: null }),

  setAssetPrefix: (assetPrefix) => set({ assetPrefix }),

  resolveAssets: async () => {
    const root = get().projectRoot as FileSystemDirectoryHandle | null;
    // Keep the query layer's locator in step with the session: Q13
    // reports what resolves, and a stale root would make it lie.
    setAssetLocator(root === null ? null : makeLocator(root));
    return resolveAllAssets(exec, makeLocator(root));
  },

  regrantRoot: async () => {
    const { projectRoot, rootMode } = get();
    if (projectRoot === null) return;
    // Re-asked in the mode it was granted under, and the environment
    // counter is bumped either way: a folder that has just come back
    // means every asset view is showing an answer from when it was
    // gone.
    set({ rootPermission:
            await adapter.requestRootPermission(projectRoot, rootMode),
          environmentRevision: get().environmentRevision + 1 });
  },

  newProject: async () => {
    // Asked first, while the current screen is still up: the film is a
    // file from its first moment, and every edit is written to it.
    const path = await chooser.chooseNew("Untitled.scf");
    if (path === null) return;
    // "loading" first, and awaited into the next task, so mounted views
    // unmount before the host switches films. A view whose query lands
    // between the two films would read the wrong one.
    set({ phase: "loading", errorMessage: null, openRow: null,
          draft: null, selectedSubject: null });
    await new Promise((r) => setTimeout(r, 0));
    try {
      const host = await getHost();
      bindHost(host);
      const made = await host.create(path, { editorVersion: EDITOR_VERSION });
      await finishOpen(set, get, made.path, made.revision);
    } catch (e) {
      set({ phase: "error", errorMessage: describeError(e) });
    }
  },

  /** Back to the start screen. The film is already in its file; the
   *  host lets go of it when this window does. */
  closeProject: async () => {
    // Disarm auto-resume BEFORE the phase change, not after the awaits
    // below. App's resume effect fires the moment phase becomes "start"
    // and reads this flag synchronously, so writing it later means a
    // close bounces straight back into the project it just left.
    localStorage.setItem("scf:auto-resume", "0");
    // Thumbnails hold object URLs into the folder being left.
    revokeAll();
    clearResolutions();
    setAssetLocator(null);
    // Leave the workbench FIRST. Closing the film under mounted views
    // leaves their in-flight queries — and the script editor's
    // blur-triggered commit — resolving against no film.
    set({ phase: "start", projectPath: null, projectName: null,
          errorMessage: null, hostLost: false, externalChange: false,
          navMode: "intro", selectedCharacterId: null, characterTab: "Profile",
          shootView: freshShootView(),
  asOfSceneId: null, selectedLocationId: null, locationTab: "Profile",
  selectedPropId: null, propTab: "Profile",
  assetPrefix: "", openRow: null, draft: null,
          selectedSubject: null, projectRoot: null,
          rootPermission: "none", rootTraversal: "unknown",
          rootMode: "read", rootVerified: false, attachError: null,
          rootTraversalError: null });
    try {
      await (await getHost()).closeFilm();
    } catch {
      // The host is gone or never had it; either way it is closed.
    }
    // Closing is deliberate: forget the folder so the next open starts
    // clean rather than inheriting this one's.
    await forgetRoot();
  },

  /**
   * Save As — the project follows the new file, so this is how you
   * version up (hollow_creek_v2.scf) or rename without leaving the
   * editor. The old file is left exactly as it was; there is nothing to
   * save first, because every edit is already in it.
   */
  saveProjectAs: async () => {
    const { projectName, projectRoot, rootMode } = get();
    const path = await chooser.chooseNew(
      suggestSaveAsName(projectName, true));
    if (path === null) return;
    try {
      const host = await getHost();
      const copied = await host.saveAs(path);
      localStorage.setItem("scf:last-session", copied.path);
      set({ projectPath: copied.path, projectName: nameOf(copied.path),
            lastSession: copied.path,
            revision: Math.max(get().revision, copied.revision) });
      // The folder was verified against the old file's name; remember it
      // for the new path, but the check is no longer a fact.
      if (projectRoot !== null) {
        await rememberPair(copied.path, projectRoot, rootMode);
        set({ rootVerified: false });
      }
    } catch (e) {
      set({ errorMessage: `Save As failed: ${describeError(e)}` });
    }
  },

  // A tab is a destination: arriving at one closes whatever record was
  // covering it, rather than showing the tab's rail beside someone
  // else's form.
  setListSort: (listSort) => set({ listSort }),
  setNavMode: (navMode) => set({ navMode, openRow: null, draft: null }),
  selectCharacter: (selectedCharacterId) =>
    set({ selectedCharacterId, openRow: null, draft: null }),
  setCharacterTab: (characterTab) => set({ characterTab }),
  setAsOfScene: (asOfSceneId) => set({ asOfSceneId }),
  selectSubjectOf: (kind, id) => set({
    ...(kind === "character" ? { selectedCharacterId: id }
      : kind === "location" ? { selectedLocationId: id }
      : { selectedPropId: id }),
    openRow: null, draft: null,
  }),
  setTabOf: (kind, tab) => set(
    kind === "character" ? { characterTab: tab as CharacterTab }
      : kind === "location" ? { locationTab: tab as LocationTab }
      : { propTab: tab as PropTab }),
  pendingScriptLine: null,
  openScriptAt: (pendingScriptLine) =>
    set({ pendingScriptLine, navMode: "script", openRow: null, draft: null }),
  takePendingScriptLine: () => {
    const line = get().pendingScriptLine;
    if (line !== null) set({ pendingScriptLine: null });
    return line;
  },
  openSubject: (kind, id) => set({
    ...(kind === "character" ? { selectedCharacterId: id, navMode: "characters" }
      : kind === "location" ? { selectedLocationId: id, navMode: "locations" }
      : { selectedPropId: id, navMode: "props" }),
    openRow: null, draft: null,
  }),
  openCharacter: (selectedCharacterId) =>
    set({ selectedCharacterId, navMode: "characters", openRow: null,
          draft: null }),
  setSchemaCollapsed: (schemaCollapsed) => set({ schemaCollapsed }),
  setShootView: (patch) => {
    writeShootPrefs(patch);
    set((s) => ({ shootView: { ...s.shootView, ...patch } }));
  },
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
    if (draft.id === null) {
      const newId = await call("record.create", draft.entity, draft.values);
      await get().openEntityRow(draft.entity, newId);
      return newId;
    }

    await call("record.update", draft.entity, draft.id, draft.values);
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
      undo = await call("record.delete", entity, id);
    } catch (e) {
      set({ errorMessage: `Delete failed: ${
        e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const { openRow } = get();
    set({
      undo,
      lastChange: null,
      ...(openRow?.entity === entity && openRow.id === id
        ? { openRow: null, draft: null } : {}),
    });
  },

  undoDelete: async () => {
    const undo = get().undo;
    if (undo === null) return;
    try {
      await call("undo.delete", undo);
      set({ undo: null });
    } catch (e) {
      set({ errorMessage: `Undo failed: ${
        e instanceof Error ? e.message : String(e)}` });
    }
  },

  dismissUndo: () => set({ undo: null, lastChange: null }),

  recordChange: (change) => {
    const empty = change.created.length === 0 && change.before.length === 0;
    set(empty ? {} : { lastChange: change, undo: null });
  },

  undoLastChange: async () => {
    const change = get().lastChange;
    if (change === null) return;
    try {
      await call("undo.change", change);
      set({ lastChange: null });
    } catch (e) {
      set({ errorMessage: `Undo failed: ${
        e instanceof Error ? e.message : String(e)}` });
    }
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

/**
 * Open a row in the entity form by its uuid. Query results reference
 * rows by uuid, never by row id (§12.1.2), so a link in a query view
 * starts from one.
 */
export async function openEntityByUuid(
    entity: string, uuid: string | null): Promise<void> {
  if (uuid === null || !registry.entities.has(entity)) return;
  const found = await exec(
    `SELECT id FROM ${q(entity)} WHERE uuid = ?`, [uuid]);
  const id = found[0]?.["id"];
  if (id !== undefined && id !== null) {
    await useStore.getState().openEntityRow(entity, Number(id));
  }
}

export function isDirty(draft: FormDraft | null): boolean {
  if (draft === null) return false;
  return Object.keys(draft.values).some(
    (k) => (draft.values[k] ?? null) !== (draft.original[k] ?? null));
}

guardSingleTab();
