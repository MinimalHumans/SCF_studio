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
const SCENE12 = "06857531-3e91-41a9-95dd-3262407d8132";
const SHOT1204 = "404e480d-dde6-4b4f-9cd4-daec42d5bfa0";

interface Server {
  send: (method: string, params?: unknown) => Promise<unknown>;
  kill: () => void;
}

function startServer(args: string[]): Promise<Server> {
  const child: ChildProcessWithoutNullStreams =
    spawn(process.execPath, [SERVER, ...args]);
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
      const msg = JSON.parse(line) as { id?: number; result?: unknown };
      if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
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
    protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  }).then(() => {
    notify("notifications/initialized");
    return { send, kill: () => child.kill() };
  });
}

describe("scf-mcp server — a default project set at startup", () => {
  let server: Server;
  beforeAll(async () => { server = await startServer(["--scf", FIXTURE]); });
  afterAll(() => { server.kill(); });

  test("lists exactly the six documented tools", async () => {
    const result = await server.send("tools/list") as
      { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name).sort())
      .toEqual(["find", "list", "open", "query", "readiness",
                "shot_context"]);
  });

  test("list enumerates every shot in a scene by uuid, no label guessing",
      async () => {
    const result = await server.send("tools/call", {
      name: "list",
      arguments: { entityType: "shot",
                   filter: { field: "scene_id", uuid: SCENE12 } },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const shots = JSON.parse(result.content[0]?.text ?? "[]");
    expect(Array.isArray(shots)).toBe(true);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.some((s: { uuid: string }) => s.uuid === SHOT1204))
      .toBe(true);
  });

  test("find resolves a known scene label with no scfPath given",
      async () => {
    const result = await server.send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const hits = JSON.parse(result.content[0]?.text ?? "[]");
    expect(hits).toEqual([{ uuid: SCENE12, entity: "scene", label: "12" }]);
  });

  test("an unknown entity type comes back as a tool error, not a crash",
      async () => {
    const result = await server.send("tools/call", {
      name: "find", arguments: { entityType: "spaceship", label: "x" },
    }) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  test("shot_context returns all six members with no scfPath given",
      async () => {
    const result = await server.send("tools/call", {
      name: "shot_context", arguments: { shotUuid: SHOT1204 },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const ctx = JSON.parse(result.content[0]?.text ?? "{}");
    expect(Object.keys(ctx).sort()).toEqual(
      ["brief", "contextFormat", "look", "media", "physical", "readiness",
       "scene"].sort());
    expect(ctx.readiness.result.target).toBe("Q07");
  });

  test("an explicit scfPath on a call still works alongside the default",
      async () => {
    const result = await server.send("tools/call", {
      name: "find",
      arguments: { entityType: "scene", label: "12", scfPath: FIXTURE },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const hits = JSON.parse(result.content[0]?.text ?? "[]");
    expect(hits).toEqual([{ uuid: SCENE12, entity: "scene", label: "12" }]);
  });
});

describe("scf-mcp server — no default project (dynamic scfPath)", () => {
  let server: Server;
  beforeAll(async () => { server = await startServer([]); });
  afterAll(() => { server.kill(); });

  test("a tool call with nothing open yet fails clearly, not silently",
      async () => {
    const result = await server.send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no project open/);
  });

  test("open reports a real summary of the fixture", async () => {
    const result = await server.send("tools/call", {
      name: "open", arguments: { scfPath: FIXTURE },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const summary = JSON.parse(result.content[0]?.text ?? "{}");
    expect(summary.project).toBe("Hollow Creek");
    expect(summary.sceneCount).toBeGreaterThan(0);
    expect(summary.shotCount).toBeGreaterThan(0);
    expect(summary.rootMapped).toBe(false);
  });

  test("after open, other tools default to it with no scfPath",
      async () => {
    const result = await server.send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const hits = JSON.parse(result.content[0]?.text ?? "[]");
    expect(hits).toEqual([{ uuid: SCENE12, entity: "scene", label: "12" }]);
  });
});
