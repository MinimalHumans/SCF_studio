// SPDX-License-Identifier: Apache-2.0
/**
 * launcher.test.ts — does scripts/start.mjs run the server from source.
 *
 * smoke.test.ts covers the built `dist/server.js`, which is what is
 * published. This covers the development entry point, which has no
 * build step: it must work on a fresh clone after `npm ci` alone, so
 * this file deliberately does not require `dist/` and lives apart from
 * smoke.test.ts, which refuses to run without it.
 *
 * The child runs from the temp directory, as an MCP client's would,
 * not from the package.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, "..", "scripts", "start.mjs");
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const SCENE12 = "06857531-3e91-41a9-95dd-3262407d8132";

// Two Node processes start (launcher, then server), and the first
// import of scf-core's source is not instant on a slow disk.
const SLOW = 60_000;

describe("scripts/start.mjs — scf-mcp from source, no build", () => {
  const scratch = mkdtempSync(join(tmpdir(), "scf-mcp-launcher-"));
  const child = spawn(process.execPath, [LAUNCHER, "--scf", FIXTURE], {
    cwd: scratch,
    env: { ...process.env, SCF_CONFIG_DIR: scratch },
  });

  let nextId = 1;
  let buffer = "";
  const pending = new Map<number, (message: unknown) => void>();
  // Every line the launcher puts on stdout has to be a protocol
  // message: one stray log line there corrupts the client's session.
  const stdoutLines: string[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      stdoutLines.push(line);
      const msg = JSON.parse(line) as { id?: number };
      if (msg.id !== undefined) pending.get(msg.id)?.(msg);
    }
  });

  // A launcher that dies before it answers (a missing dependency, a
  // module that will not resolve) should fail the test at once with its
  // own stderr, not wait out a timeout.
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<never>((_, reject) => {
    child.on("exit", (code) => reject(new Error(
      `launcher exited with code ${String(code)}:\n${stderr}`)));
  });
  exited.catch(() => { /* observed through the race in send() */ });

  const send = (method: string, params?: unknown): Promise<
      { result?: unknown; error?: unknown }> => {
    const id = nextId++;
    const reply = new Promise<{ result?: unknown; error?: unknown }>(
      (resolve) => {
        pending.set(id, resolve as (message: unknown) => void);
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    return Promise.race([reply, exited]);
  };

  beforeAll(async () => {
    const init = await send("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "launcher-test", version: "0.0.1" },
    });
    expect(init.error).toBeUndefined();
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }, SLOW);

  afterAll(async () => {
    // End the session the way a client does, by closing stdin. The
    // launcher runs the server as its own child with this folder as its
    // working directory, and on Windows `kill()` stops the launcher but
    // not that child, which keeps the folder open (EPERM on removal).
    // Closing stdin lets the server exit and the launcher follow it; the
    // kill is only the fallback if it does not.
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await gone;
      clearTimeout(timer);
    }
    rmSync(scratch, { recursive: true, force: true,
                      maxRetries: 10, retryDelay: 100 });
  }, SLOW);

  test("starts, and lists the tool surface", async () => {
    const reply = await send("tools/list");
    const names = (reply.result as { tools: Array<{ name: string }> })
      .tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(
      ["open", "find", "list", "shot_context", "readiness"]));
  }, SLOW);

  test("answers a real query against the --scf film it was given",
      async () => {
    const reply = await send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    });
    const result = reply.result as
      { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "[]")).toEqual([
      { uuid: SCENE12, entity: "scene", label: "12" },
    ]);
  }, SLOW);

  test("keeps stdout to protocol messages only", () => {
    expect(stdoutLines.length).toBeGreaterThan(0);
    for (const line of stdoutLines) {
      const msg = JSON.parse(line) as { jsonrpc?: string };
      expect(msg.jsonrpc).toBe("2.0");
    }
  });
});
