// SPDX-License-Identifier: Apache-2.0
/**
 * Shared harness: spawn the BUILT server and speak raw JSON-RPC to it.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import { readHostEntry } from "@minimalhumans/scf-host/registryFile";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER = join(HERE, "..", "dist", "server.js");
export const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");

/**
 * These tests spawn the BUILT server, so `dist/` has to exist. Without
 * it every spawn fails on module resolution, each `send` waits out its
 * timeout, and vitest reports the whole file as skipped — a suite that
 * covers nothing and says nothing, which is how a tool-list change sat
 * unnoticed. Fail here instead, naming the command.
 */
if (!existsSync(SERVER)) {
  throw new Error(
    `scf-mcp smoke tests need the built server at ${SERVER}. ` +
    "Run `npm run build` in scf-mcp first (CI does; `npm test` alone " +
    "does not).");
}

export interface Server {
  send: (method: string, params?: unknown) => Promise<unknown>;
  kill: () => void;
  /** The server process, to ask the OS what it holds open. */
  pid: number | undefined;
}

/**
 * Every spawned server gets its own SCF_CONFIG_DIR — otherwise the
 * persisted recent-files list (nodeConfigStore.ts) would read and write
 * the real user's OS config directory during tests, and tests would
 * leak state into each other across runs. Pass `configDir` explicitly
 * to share one across two spawns, e.g. to prove persistence survives a
 * restart.
 */
/**
 * The host every test server shares. It is the real one — started on
 * demand by the first tool call that needs it — in a directory of its
 * own, so a test never meets the developer's running editor, and it
 * exits on its own shortly after the last test is done.
 */
export const HOST_DIR = mkdtempSync(join(tmpdir(), "scf-mcp-host-"));
export const HOST_ENV = {
  SCF_HOST_DIR: HOST_DIR,
  SCF_HOST_IDLE_EXIT_MS: "4000",
  SCF_HOST_START_TIMEOUT_MS: "60000",
};

/** Registered by whichever test file imports this one. */
afterAll(() => {
  const entry = readHostEntry(HOST_DIR);
  if (entry !== null) {
    try { process.kill(entry.pid); } catch { /* already gone */ }
  }
  rmSync(HOST_DIR, { recursive: true, force: true });
});

/** How a test client answers the server asking the person something. */
export type Elicit = (message: string) =>
  { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

export function startServer(
    args: string[], configDir: string = mkdtempSync(
      join(tmpdir(), "scf-mcp-test-")),
    elicit?: Elicit): Promise<Server> {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath, [SERVER, ...args],
    { env: { ...process.env, ...HOST_ENV, SCF_CONFIG_DIR: configDir } });
  let nextId = 1;
  const pending = new Map<number, (result: unknown) => void>();
  let buffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() === "") continue;
      const msg = JSON.parse(line) as
        { id?: number; result?: unknown; error?: unknown; method?: string;
          params?: { message?: string } };
      if (msg.method === "elicitation/create" && msg.id !== undefined) {
        const answer = elicit?.(msg.params?.message ?? "") ??
          { action: "decline" as const };
        child.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0", id: msg.id, result: answer })}\n`);
        continue;
      }
      if (msg.id !== undefined && msg.method === undefined) {
        pending.get(msg.id)?.(
          msg.error !== undefined ? { rpcError: msg.error } : msg.result);
      }
    }
  });

  const send = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId++;
    const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(line);
    });
  };

  const notify = (method: string, params?: unknown): void => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  return send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: elicit === undefined ? {} : { elicitation: {} },
    clientInfo: { name: "smoke", version: "0.0.1" },
  }).then(() => {
    notify("notifications/initialized");
    return { send, kill: () => child.kill(), pid: child.pid };
  });
}


export interface ToolResult {
  content: Array<{ text: string }>;
  isError?: boolean;
}

/** Call a tool and return its JSON text, or the error text. */
export async function callTool(
    server: Server, name: string, args: Record<string, unknown> = {}):
    Promise<{ isError: boolean; text: string; json: unknown }> {
  const r = await server.send("tools/call", { name, arguments: args }) as
    ToolResult;
  const text = r.content[0]?.text ?? "";
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { isError: r.isError === true, text, json };
}
