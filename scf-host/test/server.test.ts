// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  readHostEntry, startHost, type HostEvent, type HostResponse, type RunningHost,
} from "../src/index.ts";
import { makeWorkspace, type Workspace } from "./helpers.ts";

let ws: Workspace;
beforeAll(async () => { ws = await makeWorkspace(); }, 60_000);
afterAll(() => { ws.dispose(); });

/** A minimal client: enough to drive the wire format. */
class Wire {
  private next = 1;
  private readonly waiting = new Map<number, (r: HostResponse) => void>();
  readonly events: HostEvent[] = [];
  private constructor(readonly sock: WebSocket) {
    sock.on("message", (d: Buffer) => {
      const m = JSON.parse(d.toString()) as HostResponse | HostEvent;
      if ("event" in m) this.events.push(m);
      else this.waiting.get(m.id)?.(m);
    });
  }
  static open(url: string, headers: Record<string, string> = {}):
      Promise<Wire> {
    return new Promise((resolve, reject) => {
      const s = new WebSocket(url, { headers });
      s.once("open", () => { resolve(new Wire(s)); });
      s.once("unexpected-response", (_req, res) => {
        reject(new Error(String(res.statusCode)));
      });
      s.once("error", reject);
    });
  }
  call(method: string, params?: unknown): Promise<HostResponse> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.sock.send(JSON.stringify({ id, method, params }));
    });
  }
  async ok(method: string, params?: unknown): Promise<unknown> {
    const r = await this.call(method, params);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.result;
  }
  close(): Promise<void> {
    if (this.sock.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.sock.once("close", () => { resolve(); });
      this.sock.close();
    });
  }
}

describe("host over a real socket", () => {
  let host: RunningHost;
  let hostDir: string;
  const wires: Wire[] = [];

  const start = async (origins: string[] = []) => {
    hostDir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
    host = await startHost({ hostDir, allowedOrigins: origins });
  };
  const connect = async (headers: Record<string, string> = {}) => {
    const w = await Wire.open(`${host.url}?token=${host.token}`, headers);
    wires.push(w);
    return w;
  };

  afterEach(async () => {
    await Promise.all(wires.splice(0).map((w) => w.close().catch(() => {})));
    await host.stop();
    rmSync(hostDir, { recursive: true, force: true });
  });

  test("a client with the token can open, write and read", async () => {
    await start();
    const w = await connect();
    await w.ok("hello", { client: "test" });
    await w.ok("open", { path: ws.newFilm() });
    await w.ok("op", {
      name: "record.create",
      args: { entity: "character", values: { name: "ELEANOR" } },
    });
    expect(await w.ok("query", { sql: "SELECT name FROM character" }))
      .toEqual([{ name: "ELEANOR" }]);
  });

  test("a wrong or missing token is turned away at the upgrade", async () => {
    await start();
    await expect(Wire.open(`${host.url}?token=wrong`)).rejects.toThrow("401");
    await expect(Wire.open(host.url)).rejects.toThrow("401");
  });

  test("a browser from an unlisted origin is refused even with the token",
      async () => {
    await start(["http://localhost:5173"]);
    await expect(connect({ Origin: "https://evil.example" }))
      .rejects.toThrow("403");
    await expect(connect({ Origin: "http://localhost:5173" }))
      .resolves.toBeDefined();
  });

  test("a client with no Origin (not a browser) needs only the token",
      async () => {
    await start(["http://localhost:5173"]);
    await expect(connect()).resolves.toBeDefined();
  });

  test("a rebinding Host header is refused", async () => {
    await start();
    await expect(connect({ Host: "evil.example" })).rejects.toThrow("403");
  });

  test("a malformed frame is answered, and the socket survives",
      async () => {
    await start();
    const w = await connect();
    const reply = new Promise<HostResponse>((resolve) => {
      w.sock.once("message", (d: Buffer) => {
        resolve(JSON.parse(d.toString()) as HostResponse);
      });
    });
    w.sock.send("not json");
    const r = await reply;
    expect(!r.ok && r.error.code).toBe("bad_request");
    await w.ok("hello", { client: "still here" });
  });

  test("a write by one socket is pushed to another on the same film",
      async () => {
    await start();
    const film = ws.newFilm();
    const a = await connect();
    const b = await connect();
    await a.ok("hello", { client: "window" });
    await b.ok("hello", { client: "agent" });
    await a.ok("open", { path: film });
    await b.ok("open", { path: film });
    await b.ok("op", {
      name: "record.create",
      args: { entity: "character", values: { name: "X" } },
    });
    await a.ok("query", { sql: "SELECT 1" }); // let the push arrive
    expect(a.events).toEqual([expect.objectContaining(
      { event: "revision", by: "agent" })]);
  });

  test("reads keep working while writes are in flight", async () => {
    await start();
    const film = ws.newFilm();
    const a = await connect();
    const b = await connect();
    await a.ok("open", { path: film });
    await b.ok("open", { path: film });
    const writes = Array.from({ length: 30 }, (_, i) => a.call("op", {
      name: "record.create",
      args: { entity: "character", values: { name: `C${String(i)}` } },
    }));
    const reads = Array.from({ length: 30 }, () =>
      b.call("query", { sql: "SELECT COUNT(*) AS n FROM character" }));
    const all = await Promise.all([...writes, ...reads]);
    expect(all.every((r) => r.ok)).toBe(true);
    expect(await b.ok("query",
      { sql: "SELECT COUNT(*) AS n FROM character" })).toEqual([{ n: 30 }]);
  });

  test("a dropped connection releases its film", async () => {
    await start();
    const a = await connect();
    await a.ok("open", { path: ws.newFilm() });
    expect(host.clientCount).toBe(1);
    await a.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(host.clientCount).toBe(0);
  });

  test("/ping answers without a token and says nothing sensitive",
      async () => {
    await start();
    const r = await fetch(`http://127.0.0.1:${String(host.port)}/ping`);
    const body = await r.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(JSON.stringify(body)).not.toContain(host.token);
  });

  test("the discovery file is published, and removed on stop", async () => {
    await start();
    const entry = readHostEntry(hostDir);
    expect(entry).toMatchObject({
      pid: process.pid, port: host.port, token: host.token });
    await host.stop();
    expect(readHostEntry(hostDir)).toBeNull();
    host = await startHost({ hostDir: false });   // for afterEach
  });
});

describe("discovery file", () => {
  test("an entry whose process is gone is removed, not returned", () => {
    const dir = mkdtempSync(join(tmpdir(), "scf-host-dir-"));
    try {
      writeFileSync(join(dir, "host.json"), JSON.stringify({
        pid: 2 ** 22 + 12345, port: 1, token: "t", version: "0",
        protocol: 1, startedAt: "",
      }));
      expect(readHostEntry(dir)).toBeNull();
      expect(existsSync(join(dir, "host.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
