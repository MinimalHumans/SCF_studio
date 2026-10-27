// SPDX-License-Identifier: Apache-2.0
/**
 * windowMcp.ts — the MCP server, in the desktop app's window.
 *
 * Agents start `scf-editor mcp` (src-tauri/src/pipe.rs), a pipe whose
 * lines the shell hands here (src-tauri/src/mcp_relay.rs). Each pipe gets a
 * server of its own (scf-mcp `mcpServer.ts`) with its own open film and
 * name, a client of the window's host like the editor is. So an agent
 * and the person at the editor share one host again, as they did when
 * both went to the host process.
 *
 * A pipe brings its arguments and working directory; paths in them are
 * the agent's, and are resolved against that directory, not the app's.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { FileLocator } from "@scf-core/assets.ts";
import { HostClient } from "@scf-host/client.ts";
import { ConfigError, USAGE, parseConfig, type RootMap }
  from "@scf-mcp/config.ts";
import { createScfMcpServer } from "@scf-mcp/mcpServer.ts";
import type { McpPlatform } from "@scf-mcp/platform.ts";
import { openTauriAppStore } from "../host/tauriAppStore.ts";
import { createTauriPlatform } from "../host/tauriPlatform.ts";
import { windowHostTransport } from "../host/windowHost.ts";

type McpEvent =
  | { kind: "open"; session: number; args: string[]; cwd: string;
      readOnly: boolean; elicit: boolean;
      /** A pipe a page before this one served (a reload). */
      resumed: boolean;
      /** Its agent's handshake, to bring the new server up to date. */
      replay: string[] }
  | { kind: "message"; session: number; line: string }
  | { kind: "closed"; session: number };

interface Stat { size: number; modified: string }

const send = (session: number, line: string): Promise<void> =>
  invoke("mcp_send", { session, line });
const end = (session: number): Promise<void> =>
  invoke("mcp_close", { session });

/**
 * One pipe, as the SDK's transport. Messages that arrive before the
 * server is connected wait for it.
 */
class PipeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private waiting: JSONRPCMessage[] | null = [];
  private closed = false;
  /** Requests replayed to a resumed server: their answers stay here. */
  private readonly replayed = new Set<string | number>();

  constructor(private readonly session: number) {}

  /** Something the agent said to the server this one replaces. */
  replay(line: string): void {
    const message = JSON.parse(line) as { id?: string | number };
    if (message.id !== undefined) this.replayed.add(message.id);
    this.receive(line);
  }

  receive(line: string): void {
    let message: JSONRPCMessage;
    try {
      message = JSON.parse(line) as JSONRPCMessage;
    } catch (e) {
      this.onerror?.(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (this.waiting === null) this.onmessage?.(message);
    else this.waiting.push(message);
  }

  start(): Promise<void> {
    const waiting = this.waiting ?? [];
    this.waiting = null;
    for (const m of waiting) this.onmessage?.(m);
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if ("id" in message && !("method" in message) &&
        message.id !== undefined && this.replayed.delete(message.id)) {
      return Promise.resolve();
    }
    return send(this.session, JSON.stringify(message));
  }

  /** The pipe went away. */
  gone(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await end(this.session);
    this.gone();
  }
}

/**
 * The old recent-files list, read once to seed `app.db` the first time
 * it is created (file-management-plan.md §3.1 "Migration");
 * `mcp-config.json` itself is left untouched.
 */
function readLegacyRecentFiles(
    path: string, readText: (p: string) => Promise<string>):
    () => Promise<string[]> {
  return async () => {
    try {
      const parsed = JSON.parse(await readText(path)) as
        { recentFiles?: unknown };
      return Array.isArray(parsed.recentFiles) &&
        parsed.recentFiles.every((p) => typeof p === "string")
        ? parsed.recentFiles : [];
    } catch {
      return [];
    }
  };
}

/** Listen for pipes, and serve each one that comes. */
export async function serveMcp(): Promise<void> {
  const files = await createTauriPlatform();
  const { paths } = files;
  const { dataDir } = await invoke<{ dataDir: string }>("host_setup");
  const appStore = await openTauriAppStore(paths.join(dataDir, "app.db"), {
    importLegacyRecentFiles: readLegacyRecentFiles(
      paths.join(dataDir, "mcp-config.json"), files.readText),
  });

  // As scf-mcp's nodeLocator: an unknown root is undefined, a known one
  // with nothing there is null.
  const locator = (roots: RootMap): FileLocator => async (root, path) => {
    if (root === null) return undefined;
    const base = roots[root];
    if (base === undefined) return undefined;
    const stat = await invoke<Stat | null>(
      "fs_stat", { path: paths.join(base, path) });
    return stat === null ? null
      : { materialised: true, sizeBytes: stat.size, mtime: stat.modified };
  };

  const platformFor = (cwd: string): McpPlatform => ({
    connect: async (name) =>
      HostClient.connect(await windowHostTransport(), { name }),
    resolve: (path) => paths.resolve(cwd, path),
    locator, appStore,
    readText: files.readText,
    log: (message) => { console.warn(`[mcp] ${message}`); },
  });

  const pipes = new Map<number, PipeTransport>();

  async function open(event: Extract<McpEvent, { kind: "open" }>) {
    const { session } = event;
    const pipe = new PipeTransport(session);
    pipes.set(session, pipe);
    try {
      const platform = platformFor(event.cwd);
      const config = await parseConfig(event.args, {
        readOnly: event.readOnly,
        readText: platform.readText, resolve: platform.resolve,
      });
      const server = await createScfMcpServer(
        platform, config, { elicit: event.elicit });
      for (const line of event.replay) pipe.replay(line);
      // A resumed pipe was answered by the page before.
      if (!event.resumed) await send(session, JSON.stringify({ ok: true }));
      await server.connect(pipe);
    } catch (e) {
      pipes.delete(session);
      const message = e instanceof ConfigError
        ? `${e.message}\n${USAGE}`
        : `scf-mcp: ${e instanceof Error ? e.message : String(e)}`;
      await send(session, JSON.stringify({ error: message }));
      await end(session);
    }
  }

  const events = new Channel<McpEvent>();
  events.onmessage = (event) => {
    switch (event.kind) {
      case "open":
        void open(event);
        break;
      case "message":
        pipes.get(event.session)?.receive(event.line);
        break;
      case "closed":
        pipes.get(event.session)?.gone();
        pipes.delete(event.session);
        break;
    }
  };
  await invoke("mcp_listen", { events });
}
