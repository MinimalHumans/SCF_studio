// SPDX-License-Identifier: Apache-2.0
/**
 * projectCache.ts — which `.scf` a tool call means, and reusing the
 * open handle for it.
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

export interface Project {
  scfPath: string;
  ctx: ScfContext;
  locate: FileLocator;
  rootMapped: boolean;
  roots: RootMap;
}

/** Open `.scf` handles are real file descriptors — keep only a few. */
const MAX_OPEN = 4;
const cache = new Map<string, { project: Project; db: NodeDatabase }>();
let lastUsed: string | null = null;

function touch(path: string): void {
  const entry = cache.get(path);
  if (entry === undefined) return;
  // Map iterates in insertion order; delete+re-set moves `path` to the
  // most-recently-used end without a second data structure.
  cache.delete(path);
  cache.set(path, entry);
}

function evictLeastRecentlyUsed(): void {
  while (cache.size > MAX_OPEN) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.get(oldest)?.db.close();
    cache.delete(oldest);
  }
}

/**
 * Paths this session has opened, independent of `cache` above: unlike
 * the live-handle cache (bounded to MAX_OPEN for file descriptors),
 * there is no resource cost to remembering more paths than that, so
 * this list is longer and never holds an open handle itself.
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
 * Open (or reuse) the project at `scfPathInput`. Given `roots`, they
 * merge into whatever this path already had — so calling `open` again
 * to add a root doesn't require repeating the ones already set.
 */
export function openProject(
    scfPathInput: string, roots: RootMap = {}): Project {
  const scfPath = resolve(scfPathInput);
  const existing = cache.get(scfPath);

  if (existing !== undefined) {
    touch(scfPath);
    lastUsed = scfPath;
    applyRoots(existing.project, roots);
    touchRecent(scfPath);
    return existing.project;
  }

  const db = openNodeDatabase(scfPath, { readOnly: true });
  const project: Project = {
    scfPath,
    ctx: { exec: db.exec, registry },
    locate: makeNodeLocator(roots),
    rootMapped: Object.keys(roots).length > 0,
    roots,
  };
  cache.set(scfPath, { project, db });
  lastUsed = scfPath;
  evictLeastRecentlyUsed();
  touchRecent(scfPath);
  return project;
}

/**
 * The film this session has open — whatever `open` loaded most
 * recently. Throws a clear, actionable error rather than guessing when
 * nothing has been opened yet.
 */
export function currentProject(): Project {
  if (lastUsed !== null) {
    const entry = cache.get(lastUsed);
    if (entry !== undefined) {
      touch(lastUsed);
      return entry.project;
    }
  }
  throw new Error(
    "no film open in this session — call `open` with a path to a " +
    ".scf file first");
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
