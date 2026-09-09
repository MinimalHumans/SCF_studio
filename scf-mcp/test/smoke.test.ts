// SPDX-License-Identifier: Apache-2.0
/**
 * smoke.test.ts — does the built server actually start and answer.
 *
 * Not a full MCP client harness: raw JSON-RPC over the child process's
 * stdio, enough to catch "the process doesn't start" or "the tool
 * surface changed" without a live client configured.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "server.js");
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");

let child: ChildProcessWithoutNullStreams;
let nextId = 1;
const pending = new Map<number, (result: unknown) => void>();
let buffer = "";

function send(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  const line = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(line);
  });
}

function notify(method: string, params?: unknown): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

beforeAll(async () => {
  child = spawn(process.execPath, [SERVER, "--scf", FIXTURE]);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() === "") continue;
      const msg = JSON.parse(line) as { id?: number; result?: unknown };
      if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
    }
  });
  await send("initialize", {
    protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  });
  notify("notifications/initialized");
});

afterAll(() => { child.kill(); });

describe("scf-mcp server", () => {
  test("lists exactly the four documented tools", async () => {
    const result = await send("tools/list") as
      { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name).sort())
      .toEqual(["find", "query", "readiness", "shot_context"]);
  });

  test("find resolves a known scene label against the fixture", async () => {
    const result = await send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const hits = JSON.parse(result.content[0]?.text ?? "[]");
    expect(hits).toEqual([{
      uuid: "06857531-3e91-41a9-95dd-3262407d8132",
      entity: "scene", label: "12",
    }]);
  });

  test("an unknown entity type comes back as a tool error, not a crash",
      async () => {
    const result = await send("tools/call", {
      name: "find", arguments: { entityType: "spaceship", label: "x" },
    }) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  test("shot_context returns all six members for the fixture's shot",
      async () => {
    const result = await send("tools/call", {
      name: "shot_context",
      arguments: { shotUuid: "404e480d-dde6-4b4f-9cd4-daec42d5bfa0" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const ctx = JSON.parse(result.content[0]?.text ?? "{}");
    expect(Object.keys(ctx).sort()).toEqual(
      ["brief", "contextFormat", "look", "media", "physical", "readiness",
       "scene"].sort());
    expect(ctx.readiness.result.target).toBe("Q07");
  });
});
