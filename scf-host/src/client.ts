// SPDX-License-Identifier: Apache-2.0
/**
 * client.ts — talking to the host, wherever the client runs.
 *
 * Browser-safe: no Node imports, and the only thing it knows about the
 * wire is `HostTransport`, a request/response pipe with pushed events.
 * The WebSocket adapter below is one implementation; a Tauri shell would
 * supply another whose `request` is `invoke("host", {method, params})`
 * and whose events come from Tauri's event bus. Nothing above the
 * transport — views, tools, tests — changes when that happens.
 *
 * What the client offers is deliberately small and matches how the
 * codebase already works:
 *
 *  - `exec` is an `SqlExec` for READS, so every query helper in
 *    `scf-core` runs unchanged against a host-backed film;
 *  - `call(op, args)` is the only way to write, and sends an intent,
 *    never SQL.
 */

import type {
  CallArgs, CallName, CallResult, Registry, Row, ScfContext, SqlExec,
  SqlValue,
} from "@minimalhumans/scf-core";
import {
  PROTOCOL_VERSION,
  type ErrorCode, type FilmInfo, type HostEvent, type HostMethods,
  type HostResponse, type JournalEntry, type JsonRow, type MethodName,
  type OpInfo,
} from "./protocol.ts";

// ── transport ──────────────────────────────────────────────────────

export interface HostTransport {
  /** Send one request; resolve with its result or reject with `HostClientError`. */
  request(method: string, params: unknown): Promise<unknown>;
  /** Events pushed by the host. Returns an unsubscribe function. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  /** The pipe is gone (host exited, socket dropped). */
  onClose(listener: (reason: string) => void): () => void;
  close(): Promise<void>;
}

export class HostClientError extends Error {
  readonly code: ErrorCode | "disconnected";
  /** For `failed`: the class name of the error the host caught. */
  readonly remoteName: string | undefined;
  /** For `failed`: that error's own JSON fields. */
  readonly data: Record<string, unknown> | undefined;
  constructor(code: ErrorCode | "disconnected", message: string,
              remote: { name?: string; data?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "HostClientError";
    this.code = code;
    this.remoteName = remote.name;
    this.data = remote.data;
  }
}

/** The part of the WebSocket API the adapter uses (browser, Node, `ws`). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error" | "message",
                   listener: (ev: never) => void): void;
}
export type WebSocketConstructor = new (url: string) => WebSocketLike;

const OPEN = 1;

export function connectWebSocket(
    url: string, WS: WebSocketConstructor = globalThis.WebSocket as
      unknown as WebSocketConstructor): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const sock = new WS(url);
    const pending = new Map<number, {
      resolve: (v: unknown) => void; reject: (e: Error) => void;
    }>();
    const events = new Set<(e: HostEvent) => void>();
    const closers = new Set<(reason: string) => void>();
    let next = 1;
    let opened = false;
    let closed = false;

    const dropAll = (reason: string): void => {
      if (closed) return;
      closed = true;
      const err = new HostClientError("disconnected", reason);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      for (const l of closers) l(reason);
    };

    sock.addEventListener("open", () => {
      opened = true;
      resolve({
        request: (method, params) => {
          if (closed || sock.readyState !== OPEN) {
            return Promise.reject(new HostClientError(
              "disconnected", "the host connection is closed"));
          }
          const id = next++;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            sock.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent: (l) => { events.add(l); return () => { events.delete(l); }; },
        onClose: (l) => { closers.add(l); return () => { closers.delete(l); }; },
        close: () => {
          sock.close();
          dropAll("closed by the client");
          return Promise.resolve();
        },
      });
    });
    sock.addEventListener("message", ((ev: { data: unknown }) => {
      const m = JSON.parse(String(ev.data)) as HostResponse | HostEvent;
      if ("event" in m) {
        for (const l of events) l(m);
        return;
      }
      const p = pending.get(m.id);
      if (p === undefined) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else {
        p.reject(new HostClientError(m.error.code, m.error.message, {
          ...(m.error.name === undefined ? {} : { name: m.error.name }),
          ...(m.error.data === undefined ? {} : { data: m.error.data }),
        }));
      }
    }) as (ev: never) => void);
    sock.addEventListener("close", () => {
      if (!opened) reject(new HostClientError(
        "disconnected", "could not connect to the host"));
      dropAll("the host closed the connection");
    });
    sock.addEventListener("error", () => {
      if (!opened) reject(new HostClientError(
        "disconnected", "could not connect to the host"));
    });
  });
}

// ── client ─────────────────────────────────────────────────────────

export interface CallOptions {
  /** Refuse the write if the file has moved past this revision. */
  expectedRevision?: number;
}

export interface OpOptions extends CallOptions {
  /** Pass false to allow a write that adds integrity findings. */
  integrityGate?: boolean;
}

export interface HostClientOptions {
  /** Who is asking; shown to other clients as the author of a change. */
  name: string;
}

function decodeRow(row: JsonRow): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && typeof v === "object") {
      const bin = atob(v.$b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      out[k] = bytes;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function encodeParam(v: SqlValue): string | number | null {
  if (v === null || typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  throw new HostClientError(
    "bad_request", "binary query parameters are not supported");
}

export class HostClient {
  private rev = 0;
  private film: string | null = null;
  private readonly listeners = new Set<(e: HostEvent) => void>();
  private readonly offEvent: () => void;

  /** Reads. Writes are refused by the host; use `call`. */
  readonly exec: SqlExec = async (sql, params = []) => {
    const rows = await this.send("query", {
      sql, params: params.map(encodeParam),
    });
    return rows.map(decodeRow);
  };

  private readonly transport: HostTransport;

  private constructor(transport: HostTransport) {
    this.transport = transport;
    this.offEvent = transport.onEvent((e) => {
      if (e.revision > this.rev) this.rev = e.revision;
      for (const l of this.listeners) l(e);
    });
  }

  static async connect(transport: HostTransport,
                       options: HostClientOptions): Promise<HostClient> {
    const client = new HostClient(transport);
    const hello = await client.send("hello", {
      client: options.name, protocol: PROTOCOL_VERSION,
    });
    if (hello.protocol !== PROTOCOL_VERSION) {
      await transport.close();
      throw new HostClientError(
        "failed", `host speaks protocol ${String(hello.protocol)}, ` +
        `this client speaks ${String(PROTOCOL_VERSION)}`);
    }
    return client;
  }

  private async send<M extends MethodName>(
      method: M, params: HostMethods[M][0]): Promise<HostMethods[M][1]> {
    return await this.transport.request(method, params) as
      HostMethods[M][1];
  }

  /** The last revision this client has seen (its own writes and others'). */
  get revision(): number {
    return this.rev;
  }

  /** The path of the film this client has open, as the host keys it. */
  get path(): string | null {
    return this.film;
  }

  /** Reads against this film, in the shape scf-core's helpers take. */
  context(registry: Registry): ScfContext {
    return { exec: this.exec, registry };
  }

  async open(path: string, options: { readOnly?: boolean;
                                      migrate?: boolean;
                                      editorVersion?: string } = {}):
      Promise<{ path: string; revision: number; readOnly: boolean }> {
    const r = await this.send("open", { path, ...options });
    this.film = r.path;
    this.rev = r.revision;
    return r;
  }

  async closeFilm(): Promise<void> {
    await this.send("close", {});
    this.film = null;
  }

  /** Re-read the file after the host reported `external_change`. */
  async reload(): Promise<number> {
    const r = await this.send("reload", {});
    this.rev = Math.max(this.rev, r.revision);
    return r.revision;
  }

  /** Write: one named op from the curated table (the MCP's surface). */
  async op(name: string, args: unknown = {},
           options: OpOptions = {}): Promise<{ result: unknown;
                                               revision: number;
                                               snapshot?: string }> {
    const r = await this.send("op", {
      name, args,
      ...(options.expectedRevision === undefined
        ? {} : { expectedRevision: options.expectedRevision }),
      ...(options.integrityGate === undefined
        ? {} : { integrityGate: options.integrityGate }),
    });
    if (r.revision > this.rev) this.rev = r.revision;
    return r;
  }

  /**
   * Write: one function from the window's call table, with its own
   * positional arguments. Typed from the table, so a wrong call does
   * not compile. Returns the function's result.
   */
  async call<K extends CallName>(
      name: K, args: CallArgs<K>,
      options: CallOptions = {}): Promise<CallResult<K>> {
    // JSON turns a trailing `undefined` into `null`, which a default
    // parameter does not treat as missing.
    const list: unknown[] = [...args];
    while (list.length > 0 && list[list.length - 1] === undefined) {
      list.pop();
    }
    const r = await this.send("call", {
      name, args: list,
      ...(options.expectedRevision === undefined
        ? {} : { expectedRevision: options.expectedRevision }),
    });
    if (r.revision > this.rev) this.rev = r.revision;
    return r.result as CallResult<K>;
  }

  /** Make a new film (empty, or from `bytes`) and open it. */
  async create(path: string, options: { bytes?: Uint8Array;
                                        editorVersion?: string } = {}):
      Promise<{ path: string; revision: number; readOnly: boolean }> {
    const r = await this.send("create", {
      path,
      ...(options.bytes === undefined
        ? {} : { bytes: toBase64(options.bytes) }),
      ...(options.editorVersion === undefined
        ? {} : { editorVersion: options.editorVersion }),
    });
    this.film = r.path;
    this.rev = r.revision;
    return r;
  }

  /** Copy the open film to `path` and move this client there. */
  async saveAs(path: string):
      Promise<{ path: string; revision: number; readOnly: boolean }> {
    const r = await this.send("saveAs", { path });
    this.film = r.path;
    this.rev = r.revision;
    return r;
  }

  list(path?: string): Promise<HostMethods["list"][1]> {
    return this.send("list", path === undefined ? {} : { path });
  }

  /** Recent writes to the open film and who made them. */
  async journal(limit?: number): Promise<JournalEntry[]> {
    return (await this.send("journal",
      limit === undefined ? {} : { limit })).entries;
  }

  ops(): Promise<OpInfo[]> {
    return this.send("ops", {});
  }

  async status(): Promise<{ films: FilmInfo[]; current: string | null }> {
    return this.send("status", {});
  }

  /** Revision and reload events for the film this client has open. */
  subscribe(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onClose(listener: (reason: string) => void): () => void {
    return this.transport.onClose(listener);
  }

  async dispose(): Promise<void> {
    this.offEvent();
    this.listeners.clear();
    await this.transport.close();
  }
}
