// SPDX-License-Identifier: Apache-2.0
/**
 * hostCore.ts — the host, without a transport.
 *
 * Owns every open `.scf`: one write session and one read-only connection
 * per file, shared by every client that has it open. A client is a
 * `HostConnection`; the WebSocket server, a test, and one day Tauri's
 * `invoke()` all drive the same object by calling `handle()` and
 * listening for events.
 *
 * A file is held open only while some connection has it. The last one to
 * leave closes it: on Windows an open handle stops other programs
 * replacing the file, and the host must not become the thing that locks
 * a film nobody is looking at.
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  argsJsonSchema, callOp, fileIdentity, initDatabase, listOps,
  OpArgumentError, StaleRevisionError, UnknownOpError,
  type Registry, type Row, type Session,
} from "@minimalhumans/scf-core";
import {
  openNodeDatabase, openNodeSession, type NodeDatabase,
} from "@minimalhumans/scf-core/node";
import {
  PROTOCOL_VERSION,
  type ErrorCode, type HostError, type HostEvent, type HostMethods,
  type JsonRow, type MethodName, type SqlJson,
} from "./protocol.ts";
import { refuseQuery } from "./readGuard.ts";

/** Thrown inside a handler to answer with a specific code. */
export class HostFailure extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "HostFailure";
    this.code = code;
  }
}

export interface HostCoreOptions {
  registry: Registry;
  /** Reported by `hello`; the shim compares it to detect version skew. */
  version?: string;
  /** Milliseconds a reader waits for a writer's commit. */
  busyTimeoutMs?: number;
}

interface Film {
  path: string;
  session: Session;
  reader: NodeDatabase;
  connections: Set<ConnectionImpl>;
  /** Added to the session's revision, so a reload never repeats one. */
  base: number;
}

export interface HostConnection {
  readonly id: number;
  /** Answer one request. Never throws: failures come back as `error`. */
  handle(method: string, params: unknown):
    Promise<{ ok: true; result: unknown } | { ok: false; error: HostError }>;
  /** Called with events for the film this connection has open. */
  onEvent(listener: (event: HostEvent) => void): void;
  /** The client went away. */
  close(): Promise<void>;
}

export interface HostCore {
  connect(): HostConnection;
  /** Close every file. Call when the host exits. */
  shutdown(): Promise<void>;
  readonly openCount: number;
}

/** A path is a session key, so two spellings of one file must agree. */
export function canonicalPath(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function encodeValue(v: unknown): SqlJson {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") {
    return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  }
  if (v instanceof Uint8Array) {
    return { $b64: Buffer.from(v).toString("base64") };
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as string | number;
}

function encodeRows(rows: Row[]): JsonRow[] {
  return rows.map((r) => {
    const out: JsonRow = {};
    for (const [k, v] of Object.entries(r)) out[k] = encodeValue(v);
    return out;
  });
}

function asObject(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new HostFailure("bad_request", "params must be an object");
  }
  return params as Record<string, unknown>;
}

function need<T>(p: Record<string, unknown>, key: string,
                 type: "string" | "boolean" | "number"): T {
  if (typeof p[key] !== type) {
    throw new HostFailure("bad_request", `${key}: expected a ${type}`);
  }
  return p[key] as T;
}

function failure(e: unknown): HostError {
  if (e instanceof HostFailure) return { code: e.code, message: e.message };
  if (e instanceof OpArgumentError) {
    return { code: "bad_request", message: e.message };
  }
  if (e instanceof UnknownOpError) {
    return { code: "unknown_op", message: e.message };
  }
  if (e instanceof StaleRevisionError) {
    return { code: "stale_revision", message: e.message };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { code: "failed", message };
}

let nextConnectionId = 1;

class ConnectionImpl implements HostConnection {
  readonly id = nextConnectionId++;
  film: Film | null = null;
  readOnly = false;
  name = "unknown";
  private listener: ((event: HostEvent) => void) | null = null;

  constructor(private readonly host: HostCoreImpl) {}

  onEvent(listener: (event: HostEvent) => void): void {
    this.listener = listener;
  }

  emit(event: HostEvent): void {
    this.listener?.(event);
  }

  async handle(method: string, params: unknown):
      Promise<{ ok: true; result: unknown } | { ok: false; error: HostError }> {
    try {
      return { ok: true, result: await this.host.dispatch(this, method, params) };
    } catch (e) {
      return { ok: false, error: failure(e) };
    }
  }

  close(): Promise<void> {
    return this.host.detach(this);
  }
}

class HostCoreImpl implements HostCore {
  private readonly films = new Map<string, Film>();
  private readonly connections = new Set<ConnectionImpl>();
  private readonly registry: Registry;
  private readonly version: string;
  private readonly busyTimeoutMs: number;
  /** Opens of one path wait for each other, so it is opened once. */
  private readonly opening = new Map<string, Promise<Film>>();

  constructor(options: HostCoreOptions) {
    this.registry = options.registry;
    this.version = options.version ?? "0.0.0";
    this.busyTimeoutMs = options.busyTimeoutMs ?? 2000;
  }

  get openCount(): number {
    return this.films.size;
  }

  connect(): HostConnection {
    const c = new ConnectionImpl(this);
    this.connections.add(c);
    return c;
  }

  async shutdown(): Promise<void> {
    for (const c of [...this.connections]) await this.detach(c);
    for (const film of [...this.films.values()]) await this.closeFilm(film);
  }

  async detach(c: ConnectionImpl): Promise<void> {
    this.connections.delete(c);
    await this.leave(c);
  }

  private async leave(c: ConnectionImpl): Promise<void> {
    const film = c.film;
    c.film = null;
    if (film === null) return;
    film.connections.delete(c);
    if (film.connections.size === 0) await this.closeFilm(film);
  }

  private async closeFilm(film: Film): Promise<void> {
    this.films.delete(film.path);
    film.reader.close();
    await film.session.close();
  }

  private revisionOf(film: Film): number {
    return film.base + film.session.revision;
  }

  private broadcast(film: Film, event: HostEvent): void {
    for (const c of film.connections) c.emit(event);
  }

  private async openFilm(path: string, migrate: boolean): Promise<Film> {
    const key = canonicalPath(path);
    const existing = this.films.get(key);
    if (existing !== undefined) return existing;
    const pending = this.opening.get(key);
    if (pending !== undefined) return pending;
    const p = this.buildFilm(key, migrate).finally(() => {
      this.opening.delete(key);
    });
    this.opening.set(key, p);
    return p;
  }

  private async buildFilm(key: string, migrate: boolean): Promise<Film> {
    if (!existsSync(key)) {
      throw new HostFailure("not_found", `no such file: ${key}`);
    }
    const session = openNodeSession(key, this.registry);
    try {
      const identity = await fileIdentity(session.exec);
      const tables = await session.exec(
        "SELECT 1 FROM sqlite_master WHERE name = '_scf_meta'");
      if (!identity.isScf && tables.length === 0) {
        throw new HostFailure("not_scf", `not an SCF file: ${key}`);
      }
      if (migrate) await initDatabase(session.exec, this.registry);
    } catch (e) {
      await session.close();
      if (e instanceof HostFailure) throw e;
      throw new HostFailure("not_scf", `cannot open ${key}: ${
        e instanceof Error ? e.message : String(e)}`);
    }
    const reader = openNodeDatabase(key, { readOnly: true });
    // A reader that meets a writer's commit waits rather than failing.
    await reader.exec(`PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
    await session.exec(`PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
    const film: Film = {
      path: key, session, reader, connections: new Set(), base: 0,
    };
    this.films.set(key, film);
    return film;
  }

  private requireFilm(c: ConnectionImpl): Film {
    if (c.film === null) {
      throw new HostFailure("no_film", "open a file first");
    }
    return c.film;
  }

  async dispatch(c: ConnectionImpl, method: string,
                 raw: unknown): Promise<unknown> {
    const p = asObject(raw);
    switch (method as MethodName) {
      case "hello": {
        c.name = need<string>(p, "client", "string");
        const out: HostMethods["hello"][1] =
          { protocol: PROTOCOL_VERSION, version: this.version };
        return out;
      }
      case "open": {
        const path = need<string>(p, "path", "string");
        await this.leave(c);
        const film = await this.openFilm(path, p["migrate"] === true);
        film.connections.add(c);
        c.film = film;
        c.readOnly = p["readOnly"] === true;
        const out: HostMethods["open"][1] = {
          path: film.path, revision: this.revisionOf(film),
          readOnly: c.readOnly,
        };
        return out;
      }
      case "close":
        await this.leave(c);
        return null;
      case "reload": {
        const film = this.requireFilm(c);
        const last = this.revisionOf(film) + 1;
        // Reopen under the same key, keeping revisions rising.
        await film.session.close();
        film.reader.close();
        const fresh = openNodeSession(film.path, this.registry);
        const reader = openNodeDatabase(film.path, { readOnly: true });
        await reader.exec(
          `PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
        film.session = fresh;
        film.reader = reader;
        film.base = last;
        this.broadcast(film, {
          event: "reload", path: film.path, revision: last,
        });
        return { revision: last };
      }
      case "query": {
        const film = this.requireFilm(c);
        const sql = need<string>(p, "sql", "string");
        const refusal = refuseQuery(sql);
        if (refusal !== null) throw new HostFailure("bad_query", refusal);
        const params = p["params"] ?? [];
        if (!Array.isArray(params)) {
          throw new HostFailure("bad_request", "params: expected a list");
        }
        return encodeRows(await film.reader.exec(
          sql, params as (string | number | null)[]));
      }
      case "ops":
        return listOps().map((op) => ({
          name: op.name, summary: op.summary,
          destructive: op.destructive, args: argsJsonSchema(op),
        }));
      case "op": {
        const film = this.requireFilm(c);
        if (c.readOnly) {
          throw new HostFailure(
            "read_only", "this connection opened the file read-only");
        }
        const name = need<string>(p, "name", "string");
        if (await film.session.hasExternalChange()) {
          throw new HostFailure(
            "external_change",
            "the file was changed outside the host; reload before writing");
        }
        const expected = p["expectedRevision"];
        if (expected !== undefined && typeof expected !== "number") {
          throw new HostFailure(
            "bad_request", "expectedRevision: expected a number");
        }
        const before = this.revisionOf(film);
        try {
          const out = await callOp(
            film.session, name, p["args"] ?? {},
            expected === undefined
              ? {} : { expectedRevision: expected - film.base });
          return { result: out.result, revision: film.base + out.revision };
        } finally {
          // A write that threw may still have changed rows, and the
          // session counts it; other clients must hear either way.
          const revision = this.revisionOf(film);
          if (revision !== before) {
            this.broadcast(film, {
              event: "revision", path: film.path, revision, by: c.name,
            });
          }
        }
      }
      case "status": {
        const out: HostMethods["status"][1] = {
          films: [...this.films.values()].map((f) => ({
            path: f.path, revision: this.revisionOf(f),
            clients: f.connections.size,
          })),
          current: c.film?.path ?? null,
        };
        return out;
      }
      default:
        throw new HostFailure("unknown_method", `unknown method: ${method}`);
    }
  }
}

export function createHostCore(options: HostCoreOptions): HostCore {
  return new HostCoreImpl(options);
}
