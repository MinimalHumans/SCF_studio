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

import {
  existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute }
  from "node:path";
import {
  argsJsonSchema, callFn, callOp, fileIdentity, initDatabase, listOps,
  UnknownCallError,
  OpArgumentError, StaleRevisionError, UnknownOpError,
  type Registry, type Row, type Session,
} from "@minimalhumans/scf-core";
import {
  openNodeDatabase, openNodeSession, type NodeDatabase,
} from "@minimalhumans/scf-core/node";
import {
  PROTOCOL_VERSION,
  type DirEntry, type ErrorCode, type HostError, type HostEvent,
  type HostMethods,
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
  /**
   * Folders the host will list and create files under. Opening an
   * existing film by path is not confined (a tool is given paths), but
   * a client cannot browse or write anywhere else.
   */
  roots?: readonly string[];
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
  if (e instanceof UnknownOpError || e instanceof UnknownCallError) {
    return { code: "unknown_op", message: e.message };
  }
  if (e instanceof StaleRevisionError) {
    return { code: "stale_revision", message: e.message };
  }
  const message = e instanceof Error ? e.message : String(e);
  if (!(e instanceof Error)) return { code: "failed", message };
  // Own fields that survive JSON, so a client can read what a typed
  // error carried (SharedSetError.sharedWith, say).
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    try {
      data[k] = JSON.parse(JSON.stringify(v)) as unknown;
    } catch {
      // not representable; the message still says what happened
    }
  }
  return { code: "failed", message,
           name: e.constructor.name !== "Error" ? e.constructor.name : e.name,
           data };
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
  private readonly roots: string[];
  /** Opens of one path wait for each other, so it is opened once. */
  private readonly opening = new Map<string, Promise<Film>>();

  constructor(options: HostCoreOptions) {
    this.registry = options.registry;
    this.version = options.version ?? "0.0.0";
    this.busyTimeoutMs = options.busyTimeoutMs ?? 2000;
    this.roots = (options.roots ?? []).map(canonicalPath);
  }

  /** Is `path` at or below one of the roots (links resolved)? */
  private inRoots(path: string): boolean {
    // A path that does not exist yet is judged by its nearest parent
    // that does, so a link cannot smuggle a new file out of the roots.
    let probe = resolve(path);
    const tail: string[] = [];
    while (!existsSync(probe) && dirname(probe) !== probe) {
      tail.unshift(basename(probe));
      probe = dirname(probe);
    }
    const real = join(realpathSync(probe), ...tail);
    return this.roots.some((root) => {
      const rel = relative(root, real);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  }

  private requireInRoots(path: string): string {
    if (!this.inRoots(path)) {
      throw new HostFailure(
        "outside_roots", "that location is outside the folders this host " +
        "may use");
    }
    return canonicalPath(path);
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

  private async openFilm(path: string, migrate: boolean,
                         editorVersion?: string,
                         fresh = false): Promise<Film> {
    const key = canonicalPath(path);
    const existing = this.films.get(key);
    if (existing !== undefined) return existing;
    const pending = this.opening.get(key);
    if (pending !== undefined) return pending;
    const p = this.buildFilm(key, migrate, editorVersion, fresh).finally(() => {
      this.opening.delete(key);
    });
    this.opening.set(key, p);
    return p;
  }

  private async buildFilm(key: string, migrate: boolean,
                          editorVersion?: string,
                          fresh = false): Promise<Film> {
    if (!existsSync(key)) {
      throw new HostFailure("not_found", `no such file: ${key}`);
    }
    const session = openNodeSession(key, this.registry);
    try {
      const identity = await fileIdentity(session.exec);
      const tables = await session.exec(
        "SELECT 1 FROM sqlite_master WHERE name = '_scf_meta'");
      // A file this host has just made is empty on purpose.
      if (!fresh && !identity.isScf && tables.length === 0) {
        throw new HostFailure("not_scf", `not an SCF file: ${key}`);
      }
      if (migrate) {
        // Through the session, so its fingerprint follows the change:
        // our own migration is not an outside edit.
        await session.write((ctx) => initDatabase(
          ctx.exec, this.registry,
          editorVersion === undefined ? {} : { editorVersion }));
      }
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

  private attach(c: ConnectionImpl, film: Film,
                 readOnly: boolean): HostMethods["open"][1] {
    film.connections.add(c);
    c.film = film;
    c.readOnly = readOnly;
    return { path: film.path, revision: this.revisionOf(film), readOnly };
  }

  private list(path: string | undefined): HostMethods["list"][1] {
    if (path === undefined) {
      return {
        path: null, parent: null,
        entries: this.roots.map((r): DirEntry =>
          ({ name: basename(r) || r, kind: "dir", path: r })),
      };
    }
    const dir = this.requireInRoots(path);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      throw new HostFailure("not_found", `cannot read ${dir}`);
    }
    const entries: DirEntry[] = [];
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          entries.push({ name, kind: "dir", path: full });
        } else if (st.isFile() && name.toLowerCase().endsWith(".scf")) {
          entries.push({ name, kind: "scf", path: full, size: st.size,
                         modified: st.mtime.toISOString() });
        }
      } catch {
        // unreadable entry: leave it out
      }
    }
    // Directories first, so the way down is always at the top.
    entries.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1));
    const up = dirname(dir);
    return { path: dir, parent: this.inRoots(up) && up !== dir ? up : null,
             entries };
  }

  /**
   * The shared path of every write: the gates, the revision offset, and
   * the event to everyone on the film, sent even when the write threw,
   * because a failed write may still have changed rows.
   */
  private async write(
      c: ConnectionImpl, p: Record<string, unknown>,
      run: (film: Film, expected: number | undefined) =>
        Promise<{ result: unknown; revision: number }>):
      Promise<{ result: unknown; revision: number }> {
    const film = this.requireFilm(c);
    if (c.readOnly) {
      throw new HostFailure(
        "read_only", "this connection opened the file read-only");
    }
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
      const out = await run(
        film, expected === undefined ? undefined : expected - film.base);
      return { result: out.result, revision: film.base + out.revision };
    } finally {
      const revision = this.revisionOf(film);
      if (revision !== before) {
        this.broadcast(film, {
          event: "revision", path: film.path, revision, by: c.name,
        });
      }
    }
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
        const film = await this.openFilm(
          path, p["migrate"] === true,
          typeof p["editorVersion"] === "string"
            ? p["editorVersion"] : undefined);
        return this.attach(c, film, p["readOnly"] === true);
      }
      case "create": {
        const path = this.requireInRoots(need<string>(p, "path", "string"));
        if (existsSync(path)) {
          throw new HostFailure("exists", `${path} already exists`);
        }
        await this.leave(c);
        const bytes = p["bytes"];
        if (typeof bytes === "string") {
          writeFileSync(path, Buffer.from(bytes, "base64"), { flag: "wx" });
        } else {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, "", { flag: "wx" });
        }
        try {
          const film = await this.openFilm(
            path, bytes === undefined || p["migrate"] === true,
            typeof p["editorVersion"] === "string"
              ? p["editorVersion"] : undefined,
            bytes === undefined);
          return this.attach(c, film, false);
        } catch (e) {
          // A file we just made and could not open is not worth keeping.
          rmSync(path, { force: true });
          throw e;
        }
      }
      case "saveAs": {
        const film = this.requireFilm(c);
        const target = this.requireInRoots(need<string>(p, "path", "string"));
        if (existsSync(target)) {
          throw new HostFailure("exists", `${target} already exists`);
        }
        // A consistent copy of the committed state, taken through the
        // writer so it waits its turn behind queued writes.
        await film.session.write(async (ctx) => {
          await ctx.exec("VACUUM INTO ?", [target]);
        });
        await this.leave(c);
        return this.attach(c, await this.openFilm(target, false), false);
      }
      case "list":
        return this.list(typeof p["path"] === "string" ? p["path"] : undefined);
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
        const name = need<string>(p, "name", "string");
        return this.write(c, p, (film, expected) => callOp(
          film.session, name, p["args"] ?? {},
          expected === undefined ? {} : { expectedRevision: expected }));
      }
      case "call": {
        const name = need<string>(p, "name", "string");
        return this.write(c, p, (film, expected) => callFn(
          film.session, name, p["args"] ?? [],
          expected === undefined ? {} : { expectedRevision: expected }));
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
