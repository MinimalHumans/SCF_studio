// SPDX-License-Identifier: Apache-2.0
/**
 * server.ts — the WebSocket door to a `HostCore`.
 *
 * Everything that makes the host safe to leave running is decided at the
 * upgrade, before a single request is read:
 *
 *  - it listens on 127.0.0.1 only;
 *  - the `Host` header must name this listener, so a DNS-rebinding page
 *    that resolves its own name to 127.0.0.1 is turned away;
 *  - a browser always sends `Origin`, and it must be on the allow list —
 *    a page the user happens to visit cannot reach the host. A client
 *    with no `Origin` (the MCP shim, a script) is not a browser and is
 *    held to the token alone;
 *  - the token, compared in constant time, must match.
 *
 * Past the upgrade this is only framing: one JSON `HostRequest` per text
 * frame in, a `HostResponse` or a `HostEvent` out. Requests on one
 * socket are answered in the order they arrive.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { HostCore } from "./hostCore.ts";
import {
  PROTOCOL_VERSION, type HostEvent, type HostRequest, type HostResponse,
} from "./protocol.ts";

export interface HostServerOptions {
  core: HostCore;
  /** 0 picks a free port. */
  port?: number;
  /** Generated when omitted. */
  token?: string;
  /** Exact `Origin` values a browser may connect from. */
  allowedOrigins?: readonly string[];
  version?: string;
  /** Called after the last client has gone, for an idle-exit policy. */
  onIdle?: () => void;
}

export interface HostServer {
  readonly port: number;
  readonly token: string;
  readonly url: string;
  readonly clientCount: number;
  close(): Promise<void>;
}

const MAX_FRAME = 16 * 1024 * 1024;

function sameToken(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export async function startHostServer(
    options: HostServerOptions): Promise<HostServer> {
  const token = options.token ?? randomBytes(24).toString("hex");
  const origins = new Set(options.allowedOrigins ?? []);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const sockets = new Set<WebSocket>();
  let boundPort = 0;

  const http: Server = createServer((req, res) => {
    // A liveness probe for the shim: no token, and nothing in it a page
    // could use. No CORS headers, so a page cannot even read it.
    if (req.method === "GET" && req.url === "/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true, protocol: PROTOCOL_VERSION,
        version: options.version ?? "0.0.0",
      }));
      return;
    }
    res.writeHead(404).end();
  });

  const hostOk = (req: IncomingMessage): boolean => {
    const host = req.headers.host ?? "";
    const p = String(boundPort);
    return host === `127.0.0.1:${p}` || host === `localhost:${p}`;
  };

  http.on("upgrade", (req, socket, head) => {
    if (!hostOk(req)) return reject(socket, "403 Forbidden");
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return reject(socket, "403 Forbidden");
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!sameToken(url.searchParams.get("token"), token)) {
      return reject(socket, "401 Unauthorized");
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    sockets.add(ws);
    const conn = options.core.connect();
    let chain: Promise<void> = Promise.resolve();
    const send = (msg: HostResponse | HostEvent): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    conn.onEvent(send);

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      chain = chain.then(async () => {
        let req: HostRequest;
        try {
          if (isBinary) throw new Error("binary frames are not used");
          const parsed: unknown = JSON.parse(data.toString("utf8"));
          const r = parsed as Partial<HostRequest>;
          if (typeof r !== "object" || r === null ||
              typeof r.id !== "number" || typeof r.method !== "string") {
            throw new Error("expected {id, method, params?}");
          }
          req = r as HostRequest;
        } catch (e) {
          send({
            id: -1, ok: false, error: {
              code: "bad_request",
              message: e instanceof Error ? e.message : String(e),
            },
          });
          return;
        }
        const out = await conn.handle(req.method, req.params);
        send(out.ok
          ? { id: req.id, ok: true, result: out.result }
          : { id: req.id, ok: false, error: out.error });
      });
    });

    ws.on("close", () => {
      sockets.delete(ws);
      // Let queued requests finish before the film can close under them.
      void chain.then(() => conn.close()).then(() => {
        if (sockets.size === 0) options.onIdle?.();
      });
    });
    ws.on("error", () => { ws.terminate(); });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, "127.0.0.1", () => { resolve(); });
  });
  const addr = http.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("host did not bind a TCP port");
  }
  boundPort = addr.port;

  return {
    port: boundPort,
    token,
    url: `ws://127.0.0.1:${String(boundPort)}/`,
    get clientCount() { return sockets.size; },
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((resolve) => { wss.close(() => { resolve(); }); });
      await new Promise<void>((resolve) => {
        http.close(() => { resolve(); });
        http.closeAllConnections();
      });
      await options.core.shutdown();
    },
  };
}
