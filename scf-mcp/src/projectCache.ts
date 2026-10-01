// SPDX-License-Identifier: Apache-2.0
/**
 * projectCache.ts — which `.scf` a tool call means, and opening it for
 * exactly as long as the call runs.
 *
 * NO HANDLE OUTLIVES A CALL. `open` remembers a path and its roots; each
 * tool call opens the file read-only, answers, and closes it
 * (`withProject`). On Windows an open handle stops any other program
 * renaming, replacing or deleting the file, and this process lives as
 * long as the client's session: a cached handle would keep every film
 * the session had looked at locked against the editor saving it and the
 * fixture build rewriting it. Opening a database costs milliseconds; a
 * call answers from what is on disk when it runs.
 *
 * A stdio MCP server is a single long-lived process a client (Claude
 * Desktop, an editor, whatever) spawns once and keeps running for its
 * whole session — there is no per-conversation process, and the MCP
 * protocol gives a stdio server no conversation identifier to key
 * state on. Requiring `--scf` at launch made "point this at a
 * different film" mean editing the client's config and restarting it.
 *
 * The fix doesn't need a conversation id: a stdio server is one process
 * per session, so "the film this session has open" is just process-wide
 * state. `open` takes `scfPath`; every other tool reads the most
 * recently opened project out of this module's cache instead of taking
 * `scfPath` itself — there is exactly one film active at a time, and
 * `open`/`set_root` are how it changes.
 *
 * The recent-files list below is process state too, but it optionally
 * persists past this process: `setConfigStore` wires in an
 * AppConfigStore (appConfig.ts) and every change is written through
 * it, fire-and-forget. Without a store — tests, or a caller that never
 * wires one in — this module behaves exactly as it did before
 * persistence existed: an in-process list, gone at exit.
 */

import { resolve } from "node:path";
import {
  loadRegistry, type FileLocator, type RegistryJson, type ScfContext,
} from "@minimalhumans/scf-core";
import { openNodeDatabase, type NodeDatabase } from "@minimalhumans/scf-core/node";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };
import type { AppConfigStore } from "./appConfig.ts";
import type { RootMap } from "./config.ts";
import { makeNodeLocator } from "./nodeLocator.ts";

const registry = loadRegistry(registryJson as unknown as RegistryJson);

/** A film this session knows: where it is and its roots. No handle. */
export interface Project {
  scfPath: string;
  locate: FileLocator;
  rootMapped: boolean;
  roots: RootMap;
}

/** A film open for the length of one call (`withProject`). */
export interface OpenProject extends Project {
  ctx: ScfContext;
}

/**
 * Every film this session has opened, by resolved path, so that opening
 * one again keeps the roots already set. Holds no handle, so there is no
 * reason to bound it the way a cache of open files must be.
 */
const known = new Map<string, Project>();
let lastUsed: string | null = null;

/**
 * Paths this session has opened, most recent first, for `recent_files`.
 * Bounded, and persisted through the config store when one is wired in.
 */
const RECENT_MAX = 20;
const recent: string[] = [];
let configStore: AppConfigStore | null = null;

function touchRecent(scfPath: string): void {
  const idx = recent.indexOf(scfPath);
  if (idx !== -1) recent.splice(idx, 1);
  recent.unshift(scfPath);
  recent.length = Math.min(recent.length, RECENT_MAX);

  // Fire-and-forget: a failed or out-of-order write loses at most the
  // convenience of the most recent entry, never a tool call.
  configStore?.write({ recentFiles: [...recent] }).catch((e: unknown) => {
    process.stderr.write(
      `[projectCache] failed to persist recent files: ${String(e)}\n`);
  });
}

/**
 * Wire in persistence for the recent-files list. Optional — without it,
 * `recentProjects()` stays in-process only, as before persistence
 * existed.
 */
export function setConfigStore(store: AppConfigStore): void {
  configStore = store;
}

/**
 * Restore a previously-persisted recent-files list (most recently
 * opened first) at startup, without writing it straight back to the
 * store that just handed it to us.
 */
export function loadRecent(paths: readonly string[]): void {
  recent.length = 0;
  recent.push(...paths.slice(0, RECENT_MAX));
}

/** Paths this session (and, once persisted, past ones) has opened,
 *  most recently opened first — a hint for `open` when the caller
 *  doesn't have a full path in hand. */
export function recentProjects(): readonly string[] {
  return recent;
}

/** Merge `roots` into `project` in place. No-op when `roots` is empty. */
function applyRoots(project: Project, roots: RootMap): void {
  if (Object.keys(roots).length === 0) return;
  project.roots = { ...project.roots, ...roots };
  project.locate = makeNodeLocator(project.roots);
  project.rootMapped = true;
}

/**
 * Make the film at `scfPathInput` this session's current film. Given
 * `roots`, they merge into whatever this path already had — so calling
 * `open` again to add a root doesn't require repeating the ones already
 * set. Opens nothing: the first call that reads it does.
 */
export function openProject(
    scfPathInput: string, roots: RootMap = {}): Project {
  const scfPath = resolve(scfPathInput);
  let project = known.get(scfPath);
  if (project === undefined) {
    project = { scfPath, locate: makeNodeLocator({}), rootMapped: false,
                roots: {} };
    known.set(scfPath, project);
  }
  applyRoots(project, roots);
  lastUsed = scfPath;
  touchRecent(scfPath);
  return project;
}

/**
 * The film this session has open — whatever `open` named most recently.
 * Throws a clear, actionable error rather than guessing when nothing has
 * been opened yet.
 */
export function currentProject(): Project {
  const project = lastUsed === null ? undefined : known.get(lastUsed);
  if (project !== undefined) return project;
  throw new Error(
    "no film open in this session — call `open` with a path to a " +
    ".scf file first");
}

/**
 * Run `fn` against a film open read-only for exactly as long as `fn`
 * runs, and close it however `fn` ends. The current film unless one is
 * given. Every tool call goes through here, so no handle outlives a call.
 */
export async function withProject<T>(
    fn: (project: OpenProject) => Promise<T>,
    project: Project = currentProject()): Promise<T> {
  const db: NodeDatabase = openNodeDatabase(project.scfPath,
                                            { readOnly: true });
  try {
    return await fn({ ...project, ctx: { exec: db.exec, registry } });
  } finally {
    db.close();
  }
}

/**
 * Merge `roots` into the currently open project without reopening it.
 * Same "no film open" error as `currentProject` when nothing is open.
 */
export function setRoots(roots: RootMap): Project {
  const project = currentProject();
  applyRoots(project, roots);
  return project;
}
