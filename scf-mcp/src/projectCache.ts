// SPDX-License-Identifier: Apache-2.0
/**
 * projectCache.ts — which `.scf` a tool call means, and talking to the
 * host about it for exactly as long as the call runs.
 *
 * NO FILM OUTLIVES A CALL. `open` remembers a path and its roots; each
 * tool call makes its own connection to the host, opens the film on it,
 * answers, and disconnects (`withProject`). The host lets go of a film
 * when its last client does, so on Windows — where an open handle stops
 * any other program renaming, replacing or deleting the file — a film
 * this session has looked at is not held against the editor saving it
 * or the fixture build rewriting it. A connection per call costs a few
 * milliseconds and means a call answers from what is on disk when it
 * runs.
 *
 * A stdio MCP server is a single long-lived process a client (Claude
 * Desktop, an editor, whatever) spawns once and keeps running for its
 * whole session — there is no per-conversation process, and the MCP
 * protocol gives a stdio server no conversation identifier to key
 * state on. Requiring `--scf` at launch made "point this at a
 * different film" mean editing the client's config and restarting it.
 *
 * The fix doesn't need a conversation id: a server is one per client
 * session, so "the film this session has open" is the server's own
 * state, held in the cache `createProjectCache` makes for it. (In the
 * desktop app several clients' servers share one window, so this is not
 * module state.) `open` takes `scfPath`; every other tool reads the most
 * recently opened project out of the cache instead of taking `scfPath`
 * itself — there is exactly one film active at a time, and
 * `open`/`set_root` are how it changes.
 *
 * The recent-files list and each project's asset root outlive the
 * session: both are `app.db` (file-management-plan.md §3.1), read and
 * written directly through `platform.appStore` by the `open`,
 * `recent_files` and `set_root` tool handlers (mcpServer.ts) — this
 * cache holds no history of its own.
 */

import {
  loadRegistry, type FileLocator, type RegistryJson, type ScfContext,
} from "@minimalhumans/scf-core";
import type { HostClient } from "@minimalhumans/scf-host/client";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };
import type { RootMap } from "./config.ts";
import type { McpPlatform } from "./platform.ts";

export const registry = loadRegistry(registryJson as unknown as RegistryJson);

/** A film this session knows: where it is and its roots. No handle. */
export interface Project {
  scfPath: string;
  locate: FileLocator;
  rootMapped: boolean;
  roots: RootMap;
}

/** A film open for the length of one call (`withProject`). */
export interface OpenProject extends Project {
  /** Reads, against the host's read-only connection. */
  ctx: ScfContext;
  /** This call's own connection, for writes. Closed when the call ends. */
  host: HostClient;
  /** The film's revision when this call opened it. */
  revision: number;
  readOnly: boolean;
}

export interface ProjectCache {
  /** When set, films are opened read-only: no write can come from here. */
  readonly readOnly: boolean;
  /**
   * Who this server is to the host, for attributing its writes. The MCP
   * handshake names the client (Claude Desktop, an editor…); the host's
   * journal and the editor's "edited by" notice show it.
   */
  agentName(): string;
  setAgentName(client: string | undefined): void;
  /**
   * Make the film at `scfPath` this session's current film. Given
   * `roots`, they merge into whatever this path already had — so calling
   * `open` again to add a root doesn't require repeating the ones already
   * set. Opens nothing: the first call that reads it does.
   */
  openProject(scfPath: string, roots?: RootMap): Project;
  /**
   * The film this session has open — whatever `open` named most
   * recently. Throws a clear, actionable error rather than guessing when
   * nothing has been opened yet.
   */
  currentProject(): Project;
  /**
   * Merge `roots` into the currently open project without reopening it.
   * Same "no film open" error as `currentProject` when nothing is open.
   */
  setRoots(roots: RootMap): Project;
  /**
   * Run `fn` against the film, on a connection of its own that is closed
   * however `fn` ends. The current film unless one is given. Every tool
   * call goes through here, so nothing outlives a call.
   */
  withProject<T>(fn: (project: OpenProject) => Promise<T>,
                 project?: Project): Promise<T>;
}

export function createProjectCache(
    platform: McpPlatform, options: { readOnly: boolean }): ProjectCache {
  const { readOnly } = options;
  let agentName = "mcp";

  /**
   * Every film this session has opened, by resolved path, so that
   * opening one again keeps the roots already set. Holds no handle, so
   * there is no reason to bound it the way a cache of open files must
   * be.
   */
  const known = new Map<string, Project>();
  let lastUsed: string | null = null;

  /** Merge `roots` into `project` in place. No-op when `roots` is empty. */
  function applyRoots(project: Project, roots: RootMap): void {
    if (Object.keys(roots).length === 0) return;
    const absolute = Object.fromEntries(Object.entries(roots)
      .map(([name, dir]) => [name, platform.resolve(dir)]));
    project.roots = { ...project.roots, ...absolute };
    project.locate = platform.locator(project.roots);
    project.rootMapped = true;
  }

  const cache: ProjectCache = {
    readOnly,
    agentName: () => agentName,
    setAgentName(client) {
      agentName = client === undefined || client === "" ? "mcp"
        : `mcp: ${client}`;
    },

    openProject(scfPathInput, roots = {}) {
      const scfPath = platform.resolve(scfPathInput);
      let project = known.get(scfPath);
      if (project === undefined) {
        project = { scfPath, locate: platform.locator({}),
                    rootMapped: false, roots: {} };
        known.set(scfPath, project);
      }
      applyRoots(project, roots);
      lastUsed = scfPath;
      return project;
    },

    currentProject() {
      const project = lastUsed === null ? undefined : known.get(lastUsed);
      if (project !== undefined) return project;
      throw new Error(
        "no film open in this session — call `open` with a path to a " +
        ".scf file first");
    },

    setRoots(roots) {
      const project = cache.currentProject();
      applyRoots(project, roots);
      return project;
    },

    async withProject(fn, project = cache.currentProject()) {
      const host = await platform.connect(agentName);
      try {
        const opened = await host.open(project.scfPath, { readOnly });
        return await fn({
          ...project, ctx: host.context(registry), host,
          revision: opened.revision, readOnly,
        });
      } finally {
        // Closed before the connection is: the host lets go of a dropped
        // connection's film only after it notices, and until then
        // Windows will not let anyone rename or delete the file.
        await host.closeFilm().catch(() => {});
        await host.dispose();
      }
    },
  };
  return cache;
}
