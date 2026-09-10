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
 */

import { resolve } from "node:path";
import {
  loadRegistry, type FileLocator, type RegistryJson, type ScfContext,
} from "@minimalhumans/scf-core";
import { openNodeDatabase, type NodeDatabase } from "@minimalhumans/scf-core/node";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };
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
