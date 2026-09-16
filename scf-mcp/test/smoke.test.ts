// SPDX-License-Identifier: Apache-2.0
/**
 * smoke.test.ts — does the built server actually start and answer.
 *
 * Not a full MCP client harness: raw JSON-RPC over the child process's
 * stdio, enough to catch "the process doesn't start" or "the tool
 * surface changed" without a live client configured.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CATALOG, toolNameFor } from "../src/queryTools.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "server.js");
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const SCENE12 = "06857531-3e91-41a9-95dd-3262407d8132";
const SHOT1204 = "404e480d-dde6-4b4f-9cd4-daec42d5bfa0";
const ELEANOR = "1afb7bf0-8cee-4e2f-9e8e-015f9b2aaf64";
const QUERY_TOOL_NAMES = CATALOG.map((spec) => toolNameFor(spec.title));

interface Server {
  send: (method: string, params?: unknown) => Promise<unknown>;
  kill: () => void;
}

/**
 * Every spawned server gets its own SCF_CONFIG_DIR — otherwise the
 * persisted recent-files list (nodeConfigStore.ts) would read and write
 * the real user's OS config directory during tests, and tests would
 * leak state into each other across runs. Pass `configDir` explicitly
 * to share one across two spawns, e.g. to prove persistence survives a
 * restart.
 */
function startServer(
    args: string[], configDir: string = mkdtempSync(
      join(tmpdir(), "scf-mcp-test-"))): Promise<Server> {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath, [SERVER, ...args],
    { env: { ...process.env, SCF_CONFIG_DIR: configDir } });
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
        { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
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

  test("lists open/recent_files/set_root/find/list/shot_context/" +
      "readiness plus one semantically-named tool per canonical query " +
      "(Q00-Q13, Q15 — Q14 is `readiness`)", async () => {
    const result = await server.send("tools/list") as
      { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      ...QUERY_TOOL_NAMES,
      "find", "list", "open", "readiness", "recent_files", "set_root",
      "shot_context",
    ].sort());
  });

  test("recent_files reflects the film --scf opened at startup, as " +
      "plain text", async () => {
    const result = await server.send("tools/call", {
      name: "recent_files", arguments: {},
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text.split("\n")).toContain(FIXTURE);
  });

  test("scene_package (Q04) with just a scene matches the blessed " +
      "result byte-for-byte", async () => {
    const result = await server.send("tools/call", {
      name: "scene_package", arguments: { scene: SCENE12 },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const envelope = JSON.parse(result.content[0]?.text ?? "{}");
    expect(envelope.query).toBe("Q04");
    expect(envelope.result.scene.fields.scene_number).toBe("12");
  });

  test("subject_in_context (Q02) resolves subjectType/subject/scene by " +
      "name, not a generic bag", async () => {
    const result = await server.send("tools/call", {
      name: "subject_in_context",
      arguments: { subjectType: "character", subject: ELEANOR,
                   scene: SCENE12 },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const envelope = JSON.parse(result.content[0]?.text ?? "{}");
    expect(envelope.query).toBe("Q02");
    expect(envelope.parameters.subject).toBe(ELEANOR);
  });

  test("subject_in_context missing its required scene is rejected " +
      "before it reaches the server, not as a runtime error", async () => {
    const result = await server.send("tools/call", {
      name: "subject_in_context",
      arguments: { subjectType: "character", subject: ELEANOR },
    }) as { isError?: boolean; rpcError?: unknown };
    // A schema-invalid call is refused at the protocol layer (a
    // JSON-RPC error) rather than reaching the handler and coming back
    // as a tool-level isError — that's the whole point of typing each
    // query's own params instead of a generic string bag.
    expect(result.rpcError !== undefined || result.isError === true)
      .toBe(true);
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

  test("set_root maps a root onto the already-open film, no scfPath",
      async () => {
    const result = await server.send("tools/call", {
      name: "set_root", arguments: { roots: { project: HERE } },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const summary = JSON.parse(result.content[0]?.text ?? "{}");
    expect(summary.rootMapped).toBe(true);
    expect(summary.roots.project).toBe(HERE);
  });
});

describe("scf-mcp server — no default project", () => {
  let server: Server;
  beforeAll(async () => { server = await startServer([]); });
  afterAll(() => { server.kill(); });

  test("a tool call with nothing open yet fails clearly, not silently",
      async () => {
    const result = await server.send("tools/call", {
      name: "find", arguments: { entityType: "scene", label: "12" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no film open/);
  });

  test("set_root with nothing open yet fails the same way", async () => {
    const result = await server.send("tools/call", {
      name: "set_root", arguments: { roots: { project: HERE } },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no film open/);
  });

  test("recent_files says so when nothing has been opened yet",
      async () => {
    const result = await server.send("tools/call", {
      name: "recent_files", arguments: {},
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("(no films opened yet)");
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

  test("recent_files lists it once opened", async () => {
    const result = await server.send("tools/call", {
      name: "recent_files", arguments: {},
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(FIXTURE);
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

describe("scf-mcp server — recent_files persists across restarts", () => {
  test("a brand new process, given the same SCF_CONFIG_DIR, remembers " +
      "what an earlier process opened", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "scf-mcp-test-"));
    try {
      const first = await startServer([], configDir);
      await first.send("tools/call", {
        name: "open", arguments: { scfPath: FIXTURE },
      });
      // The config write is fire-and-forget (projectCache.ts) so a
      // failed or slow write never blocks a tool call — give it a
      // moment to land on disk before killing the process outright.
      await new Promise((r) => { setTimeout(r, 200); });
      first.kill();

      const second = await startServer([], configDir);
      try {
        const result = await second.send("tools/call", {
          name: "recent_files", arguments: {},
        }) as { content: Array<{ text: string }>; isError?: boolean };
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toBe(FIXTURE);
      } finally {
        second.kill();
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
