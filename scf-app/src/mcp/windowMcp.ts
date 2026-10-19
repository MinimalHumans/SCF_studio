// SPDX-License-Identifier: Apache-2.0
/**
 * windowMcp.ts — the MCP server, in the desktop app's window.
 *
 * Agents start `scf mcp` (src-tauri/src/bin/scf.rs), a pipe whose lines
 * the shell hands here (src-tauri/src/mcp_relay.rs). Each pipe gets a
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
import type { AppConfig, AppConfigStore } from "@scf-mcp/appConfig.ts";
import { EMPTY_APP_CONFIG } from "@scf-mcp/appConfig.ts";
import { createTauriPlatform } from "../host/tauriPlatform.ts";
import { windowHostTransport } from "../host/windowHost.ts";

type McpEvent =
  | { kind: "open"; session: number; args: string[]; cwd: string;
      readOnly: boolean; elicit: boolean }
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

  constructor(private readonly session: number) {}

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

/** The recent-files list, in a JSON file of the app's. */
function fileConfigStore(
    path: string, readText: (p: string) => Promise<string>): AppConfigStore {
  return {
    read: async () => {
      try {
        const parsed = JSON.parse(await readText(path)) as Partial<AppConfig>;
        return Array.isArray(parsed.recentFiles) &&
          parsed.recentFiles.every((p) => typeof p === "string")
          ? { recentFiles: parsed.recentFiles } : EMPTY_APP_CONFIG;
      } catch {
        return EMPTY_APP_CONFIG;
      }
    },
    write: (config) => invoke("fs_write_text", {
      path, text: `${JSON.stringify(config, null, 2)}\n`,
    }),
  };
}

/** Listen for pipes, and serve each one that comes. */
export async function serveMcp(): Promise<void> {
  const files = await createTauriPlatform();
  const { paths } = files;
  const { dataDir } = await invoke<{ dataDir: string }>("host_setup");
  const configStore = fileConfigStore(
    paths.join(dataDir, "mcp-config.json"), files.readText);

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
    locator, configStore,
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
      await send(session, JSON.stringify({ ok: true }));
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
