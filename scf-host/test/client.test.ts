// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  HostClient, HostClientError, connectWebSocket, createHostCore, startHost,
  type HostEvent, type HostTransport, type RunningHost,
  type WebSocketConstructor,
} from "../src/index.ts";
import { connectToHost } from "../src/nodeConnect.ts";
import { makeWorkspace, registry, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

/**
 * A transport with no socket at all: requests go straight to the host
 * core, as a Tauri `invoke()` would. The same contract must hold.
 */
function inProcessTransport(core = createHostCore({ registry })):
    { transport: HostTransport; core: ReturnType<typeof createHostCore> } {
  const conn = core.connect();
  const listeners = new Set<(e: HostEvent) => void>();
  conn.onEvent((e) => { for (const l of listeners) l(e); });
  return {
    core,
    transport: {
      request: async (method, params) => {
        const r = await conn.handle(method, params);
        if (r.ok) return r.result;
        throw new HostClientError(r.error.code, r.error.message);
      },
      onEvent: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
      onClose: () => () => {},
      close: () => conn.close(),
    },
  };
}

type Make = (name: string) => Promise<HostClient>;

function contract(label: string, setup: () => Promise<{
  make: Make; teardown: () => Promise<void> }>) {
  describe(`HostClient over ${label}`, () => {
    let make: Make;
    let teardown: () => Promise<void>;
    const clients: HostClient[] = [];
    beforeAll(async () => { ({ make, teardown } = await setup()); });
    afterEach(async () => {
      await Promise.all(clients.splice(0).map((c) => c.dispose()));
    });
    afterAll(async () => { await teardown(); });
    const client = async (name = "test") => {
      const c = await make(name);
      clients.push(c);
      return c;
    };

    test("writes through call() and reads through exec", async () => {
      const c = await client();
      await c.open(ws.newFilm());
      const made = await c.call("record.create", {
        entity: "character", values: { name: "ELEANOR" } });
      expect(typeof made.result).toBe("number");
      expect(c.revision).toBe(made.revision);
      const rows = await c.exec("SELECT name FROM character WHERE id = ?",
                                [made.result as number]);
      expect(rows).toEqual([{ name: "ELEANOR" }]);
    });

    test("scf-core's own read helpers run against a host-backed film",
        async () => {
      const c = await client();
      await c.open(ws.newFilm());
      const ctx = c.context(registry);
      const { listEntities } = await import("@minimalhumans/scf-core");
      await c.call("record.create", {
        entity: "character", values: { name: "MARCUS" } });
      const list = await listEntities(ctx, "character");
      expect(JSON.stringify(list)).toContain("MARCUS");
    });

    test("a refused call surfaces as a typed error", async () => {
      const c = await client();
      await c.open(ws.newFilm());
      await expect(c.call("nope.nope")).rejects.toMatchObject({
        name: "HostClientError", code: "unknown_op" });
      await expect(c.exec("DELETE FROM character")).rejects.toMatchObject({
        code: "bad_query" });
    });

    test("a stale write is refused", async () => {
      const film = ws.newFilm();
      const a = await client("a");
      const b = await client("b");
      await a.open(film);
      await b.open(film);
      const seen = a.revision;
      await b.call("record.create", {
        entity: "character", values: { name: "B" } });
      await expect(a.call("record.create", {
        entity: "character", values: { name: "A" } },
        { expectedRevision: seen })).rejects.toMatchObject({
        code: "stale_revision" });
    });

    test("another client's write arrives as an event and moves revision",
        async () => {
      const film = ws.newFilm();
      const a = await client("window");
      const b = await client("agent");
      await a.open(film);
      await b.open(film);
      const heard: HostEvent[] = [];
      a.subscribe((e) => heard.push(e));
      const made = await b.call("record.create", {
        entity: "character", values: { name: "X" } });
      await a.exec("SELECT 1");
      await new Promise((r) => setTimeout(r, 20));
      expect(heard).toEqual([expect.objectContaining(
        { event: "revision", by: "agent" })]);
      expect(a.revision).toBe(made.revision);
    });

    test("ops() lists what the host will run", async () => {
      const c = await client();
      const ops = await c.ops();
      expect(ops.map((o) => o.name)).toContain("shot.add");
    });
  });
}

let sockHost: RunningHost;
let sockDir: string;
contract("a WebSocket (ws)", async () => {
  sockDir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
  sockHost = await startHost({ hostDir: sockDir });
  return {
    make: async (name) => HostClient.connect(
      await connectWebSocket(`${sockHost.url}?token=${sockHost.token}`,
        WebSocket as unknown as WebSocketConstructor), { name }),
    teardown: async () => {
      await sockHost.stop();
      rmSync(sockDir, { recursive: true, force: true });
    },
  };
});

contract("the platform WebSocket", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
  const host = await startHost({ hostDir: dir });
  return {
    make: async (name) => HostClient.connect(
      await connectWebSocket(`${host.url}?token=${host.token}`), { name }),
    teardown: async () => {
      await host.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

contract("an in-process transport (no socket)", () => {
  const core = createHostCore({ registry });
  return Promise.resolve({
    make: (name) => HostClient.connect(
      inProcessTransport(core).transport, { name }),
    teardown: () => core.shutdown(),
  });
});

describe("connecting", () => {
  test("a Node client finds the host through the discovery file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
    const host = await startHost({ hostDir: dir });
    try {
      const c = await connectToHost({ hostDir: dir, name: "mcp" });
      expect((await c.status()).current).toBeNull();
      await c.dispose();
    } finally {
      await host.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no host running is a clear error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
    await expect(connectToHost({ hostDir: dir, name: "x" }))
      .rejects.toThrow("no SCF host is running");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a refused connection rejects instead of hanging", async () => {
    await expect(connectWebSocket("ws://127.0.0.1:1/",
      WebSocket as unknown as WebSocketConstructor)).rejects
      .toMatchObject({ code: "disconnected" });
  });

  test("when the host goes away, pending and later calls fail clearly",
      async () => {
    const dir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
    const host = await startHost({ hostDir: dir });
    const c = await connectToHost({ hostDir: dir, name: "x" });
    const closed = new Promise<string>((r) => c.onClose(r));
    await host.stop();
    await closed;
    await expect(c.status()).rejects.toMatchObject({ code: "disconnected" });
    rmSync(dir, { recursive: true, force: true });
  });
});
