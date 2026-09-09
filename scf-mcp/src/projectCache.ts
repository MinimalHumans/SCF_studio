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
 * The fix doesn't need a conversation id: the calling agent already
 * remembers, within one conversation, which film it opened. So
 * `scfPath` becomes a tool ARGUMENT, and this module is just a small
 * cache from resolved path to an open `NodeDatabase` + `ScfContext`, so
 * repeating it doesn't reopen the file every call. Omitting it falls
 * back to whichever project was used most recently in this process —
 * convenient for the overwhelmingly common case (one film at a time),
 * but that fallback IS process-wide state: two conversations juggling
 * two different films through the same running server will stomp on
 * each other unless each passes its own `scfPath` explicitly.
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
    if (Object.keys(roots).length > 0) {
      const merged = { ...existing.project.roots, ...roots };
      existing.project.roots = merged;
      existing.project.locate = makeNodeLocator(merged);
      existing.project.rootMapped = true;
    }
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
 * The project a tool call means: `scfPathInput` if given, else whatever
 * was used most recently in this process. Throws a clear, actionable
 * error rather than guessing when neither is available.
 */
export function currentProject(scfPathInput?: string): Project {
  if (scfPathInput !== undefined) return openProject(scfPathInput);
  if (lastUsed !== null) {
    const entry = cache.get(lastUsed);
    if (entry !== undefined) {
      touch(lastUsed);
      return entry.project;
    }
  }
  throw new Error(
    "no project open — call open(scfPath) first, or pass scfPath " +
    "directly on this call");
}
