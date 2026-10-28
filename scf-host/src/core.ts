// SPDX-License-Identifier: Apache-2.0
/**
 * core.ts — the host, without a transport or a machine.
 *
 * Owns every open `.scf`: one write session and one read-only connection
 * per file, shared by every client that has it open. A client is a
 * `HostConnection`; the desktop app's window, its MCP servers and the
 * tests all drive the same object by calling `handle()` and listening
 * for events.
 *
 * Files, SQLite and paths come from a `HostPlatform` (platform.ts), so
 * this runs in Node (`hostCore.ts`) and in the window alike, and imports
 * nothing from Node itself.
 *
 * A file is held open only while some connection has it. The last one to
 * leave closes it: on Windows an open handle stops other programs
 * replacing the file, and the host must not become the thing that locks
 * a film nobody is looking at.
 */

import {
  argsJsonSchema, callFn, callOp, fileIdentity, initDatabase, listOps,
  IntegrityGateError, UnknownCallError,
  OpArgumentError, StaleRevisionError, UnknownOpError,
  type Registry, type Row, type Session,
} from "@minimalhumans/scf-core";
import {
  PROTOCOL_VERSION,
  type ErrorCode, type HostError, type HostEvent,
  type HostMethods, type JournalEntry,
  type JsonRow, type MethodName, type SqlJson,
} from "./protocol.ts";
import {
  fromBase64, toBase64, type HostPlatform, type PlatformDatabase,
} from "./platform.ts";
import { refuseQuery } from "./readGuard.ts";
import {
  actorKindOf, firstUuidIn, type AuditActor, type AuditStore,
} from "./auditStore.ts";
import {
  describeTarget, planTarget, readRow, type TargetFacts,
} from "./auditTarget.ts";

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
  /** Where files and SQLite come from. */
  platform: HostPlatform;
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
  /**
   * Where a snapshot of a film is kept before the first agent write to
   * it. Without it no snapshot is taken (tests); with it, a write that
   * cannot be preceded by one is refused.
   */
  snapshotDir?: string;
  /** Where the write journal is appended, one file per film. */
  journalDir?: string;
  /**
   * Where the audit trail goes (auditStore.ts). Every write, open, close
   * and outside change to a film is appended to it, by whichever client
   * made it. Without it nothing is recorded (tests).
   */
  audit?: Pick<AuditStore, "append">;
  /**
   * Called when the audit trail could not be written. The write it
   * describes is never refused or undone for that, so this is the only
   * place the failure surfaces.
   */
  onAuditError?: (error: unknown) => void;
  /** Snapshots kept per film. */
  snapshotsKept?: number;
  /**
   * How long a snapshot stays good. An agent's write is preceded by one
   * unless the film has been snapshotted within this many milliseconds,
   * so a burst of changes is recoverable from its start without copying
   * the file for every one. Default ten minutes; 0 snapshots every time.
   */
  snapshotEveryMs?: number;
  /**
   * Called when a client asks the host to exit and nobody else is
   * connected. Without it `shutdown` is refused.
   */
  onShutdown?: () => void;
}

interface Film {
  path: string;
  session: Session;
  reader: PlatformDatabase;
  connections: Set<ConnectionImpl>;
  /** Added to the session's revision, so a reload never repeats one. */
  base: number;
  journal: JournalEntry[];
  /** The film's own uuid (its `project` row), for the audit trail. */
  uuid: string | null;
  /** An outside change has been recorded and not yet reloaded away. */
  externalLogged: boolean;
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

function encodeValue(v: unknown): SqlJson {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") {
    return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  }
  if (v instanceof Uint8Array) {
    return { $b64: toBase64(v) };
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
  if (e instanceof IntegrityGateError) {
    return { code: "integrity_gate", message: e.message,
             data: { added: e.added } };
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

  private readonly host: HostCoreImpl;

  constructor(host: HostCoreImpl) {
    this.host = host;
  }

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
  private readonly platform: HostPlatform;
  private readonly version: string;
  private readonly busyTimeoutMs: number;
  /** In their `real` spelling, which takes a moment to learn. */
  private readonly roots: Promise<string[]>;
  private readonly snapshotDir: string | undefined;
  private readonly journalDir: string | undefined;
  private readonly snapshotsKept: number;
  private readonly snapshotEveryMs: number;
  /** When each film was last snapshotted, across closes and reopens. */
  private readonly snapshotTimes = new Map<string, number>();
  private readonly onShutdown: (() => void) | undefined;
  private readonly auditSink: Pick<AuditStore, "append"> | undefined;
  private readonly onAuditError: ((error: unknown) => void) | undefined;
  /**
   * The last revision each film reached before it was closed. A film is
   * closed whenever its last client lets go, and a tool that planned a
   * change a moment ago and applies it now has closed and reopened it in
   * between; the revision has to carry on from where it was, not restart
   * at zero, or "the file has not moved since revision N" would mean
   * nothing across a reopen. It rises for the life of the host.
   */
  private readonly lastRevisions = new Map<string, number>();
  /** Opens of one path wait for each other, so it is opened once. */
  private readonly opening = new Map<string, Promise<Film>>();

  constructor(options: HostCoreOptions) {
    this.registry = options.registry;
    this.platform = options.platform;
    this.version = options.version ?? "0.0.0";
    this.busyTimeoutMs = options.busyTimeoutMs ?? 2000;
    this.roots = Promise.all(
      (options.roots ?? []).map((r) => this.platform.real(r)));
    this.snapshotDir = options.snapshotDir;
    this.journalDir = options.journalDir;
    this.snapshotsKept = options.snapshotsKept ?? 10;
    this.snapshotEveryMs = options.snapshotEveryMs ?? 600_000;
    this.onShutdown = options.onShutdown;
    this.auditSink = options.audit;
    this.onAuditError = options.onAuditError;
  }

  /** One line in the audit trail; a failure to write it is reported, not thrown. */
  private async audit(
      who: { kind: AuditActor; name: string }, film: Film, action: string,
      detail: { summary?: string; targetUuid?: string | null;
                targetEntity?: string | null } = {}):
      Promise<void> {
    if (this.auditSink === undefined) return;
    try {
      await this.auditSink.append({
        actorKind: who.kind, actorName: who.name, scope: "project",
        projectUuid: film.uuid, projectPath: film.path, action,
        targetEntity: detail.targetEntity ?? null,
        targetUuid: detail.targetUuid ?? null,
        summary: detail.summary ?? null,
      });
    } catch (e) {
      this.onAuditError?.(e);
    }
  }

  private asUser(c: ConnectionImpl): { kind: AuditActor; name: string } {
    return { kind: actorKindOf(c.name), name: c.name };
  }

  /** A short stable name for a film's files in a shared directory. */
  private async slug(path: string): Promise<string> {
    const hash = (await this.platform.sha1(path)).slice(0, 10);
    const name = this.platform.paths.basename(path);
    return `${name.replace(/[^\w.-]+/g, "_")}-${hash}`;
  }

  private async readJournalTail(path: string): Promise<JournalEntry[]> {
    if (this.journalDir === undefined) return [];
    try {
      const lines = (await this.platform.readText(this.platform.paths.join(
        this.journalDir, `${await this.slug(path)}.jsonl`)))
        .split("\n").filter((l) => l !== "");
      return lines.slice(-200).map((l) => JSON.parse(l) as JournalEntry);
    } catch {
      return [];
    }
  }

  private async record(film: Film, entry: JournalEntry): Promise<void> {
    film.journal.push(entry);
    if (film.journal.length > 200) film.journal.shift();
    if (this.journalDir === undefined) return;
    try {
      await this.platform.appendText(
        this.platform.paths.join(
          this.journalDir, `${await this.slug(film.path)}.jsonl`),
        `${JSON.stringify(entry)}\n`);
    } catch {
      // A journal that cannot be written must not lose the write it
      // describes; the in-memory copy still serves `journal`.
    }
  }

  /**
   * A copy of the committed file, taken before an agent's write to it
   * (unless one was taken recently — see `snapshotEveryMs`). Through the READ connection, so it neither waits in the write
   * queue nor moves the revision a caller is about to check.
   */
  private async snapshot(film: Film): Promise<string | undefined> {
    if (this.snapshotDir === undefined) return undefined;
    const last = this.snapshotTimes.get(film.path);
    if (last !== undefined && Date.now() - last < this.snapshotEveryMs) {
      return undefined;
    }
    const { join } = this.platform.paths;
    const dir = join(this.snapshotDir, await this.slug(film.path));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = join(dir, `${stamp}.scf`);
    // Two snapshots in one millisecond must not collide: VACUUM INTO
    // refuses to overwrite.
    for (let n = 2; await this.platform.exists(target); n += 1) {
      target = join(dir, `${stamp}-${String(n)}.scf`);
    }
    try {
      await this.platform.mkdir(dir);
      await film.reader.exec("VACUUM INTO ?", [target]);
    } catch (e) {
      await this.platform.remove(target);
      throw new HostFailure("failed", `could not take a snapshot first, ` +
        `so nothing was written: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.snapshotTimes.set(film.path, Date.now());
    const old = (await this.platform.readDir(dir)).map((e) => e.name)
      .filter((n) => n.endsWith(".scf")).sort();
    for (const n of old.slice(0, Math.max(0, old.length - this.snapshotsKept))) {
      await this.platform.remove(join(dir, n));
    }
    return target;
  }

  /**
   * `path` in its `real` spelling, if that is at or below a root — or
   * unconditionally, when no roots are configured (the desktop app's
   * default: file-management-plan.md decision 1). `SCF_HOST_ROOTS`
   * (or an explicit `roots` option) is what opts back into confinement.
   */
  private async inRoots(path: string): Promise<string | null> {
    // `real` judges a path that does not exist yet by its nearest
    // existing parent, so a link cannot smuggle a new file out.
    const real = await this.platform.real(path);
    const roots = await this.roots;
    if (roots.length === 0) return real;
    return roots.some((root) => this.platform.paths.within(root, real))
      ? real : null;
  }

  private async requireInRoots(path: string): Promise<string> {
    const real = await this.inRoots(path);
    if (real === null) {
      throw new HostFailure(
        "outside_roots", "that location is outside the folders this host " +
        "may use");
    }
    return real;
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
    // Recorded while this client still holds the film, and before it lets
    // go: the wait must not sit between the last client leaving and the
    // check that closes the file, or two leaving together close it twice.
    await this.audit(this.asUser(c), film, "project.close");
    film.connections.delete(c);
    if (film.connections.size === 0) await this.closeFilm(film);
  }

  private async closeFilm(film: Film): Promise<void> {
    this.lastRevisions.set(film.path, this.revisionOf(film));
    this.films.delete(film.path);
    await film.reader.close();
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
    const key = await this.platform.real(path);
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
    if (!await this.platform.exists(key)) {
      throw new HostFailure("not_found", `no such file: ${key}`);
    }
    const session = await this.platform.openSession(key, this.registry);
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
    const reader = await this.platform.openReader(key);
    // A reader that meets a writer's commit waits rather than failing.
    await reader.exec(`PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
    await session.exec(`PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
    const film: Film = {
      path: key, session, reader, connections: new Set(),
      base: this.lastRevisions.get(key) ?? 0,
      journal: await this.readJournalTail(key),
      uuid: await this.uuidOf(session),
      externalLogged: false,
    };
    this.films.set(key, film);
    return film;
  }

  /** The row a write touched, as it stands after the write. */
  private async targetFacts(
      film: Film, plan: NonNullable<ReturnType<typeof planTarget>>,
      before: Row | null, outcome: unknown, failure: unknown):
      Promise<TargetFacts> {
    // A create's row is known only by the id the write returned.
    const id = plan.id ?? (failure === undefined && typeof outcome === "number"
      ? outcome : null);
    const after = plan.kind === "delete" || id === null ? null
      : await readRow(film.reader.exec, this.registry, plan.entity, id)
        .catch(() => null);
    return describeTarget(
      this.registry,
      plan.kind === "create" ? { ...plan, id } : plan, before, after);
  }

  private async uuidOf(session: Session): Promise<string | null> {
    try {
      const [row] = await session.exec("SELECT uuid FROM project LIMIT 1");
      const uuid = row?.["uuid"];
      return typeof uuid === "string" ? uuid : null;
    } catch {
      return null;
    }
  }

  private attach(c: ConnectionImpl, film: Film,
                 readOnly: boolean): HostMethods["open"][1] {
    film.connections.add(c);
    c.film = film;
    c.readOnly = readOnly;
    return { path: film.path, revision: this.revisionOf(film), readOnly };
  }

  /**
   * The shared path of every write: the gates, the revision offset, and
   * the event to everyone on the film, sent even when the write threw,
   * because a failed write may still have changed rows.
   */
  private async write(
      c: ConnectionImpl, p: Record<string, unknown>,
      what: { via: "op" | "call"; name: string; snapshot: boolean;
              dry?: boolean },
      run: (film: Film, expected: number | undefined) =>
        Promise<{ result: unknown; revision: number;
                  dryRun?: HostMethods["op"][1]["dryRun"] }>):
      Promise<HostMethods["op"][1]> {
    const film = this.requireFilm(c);
    if (c.readOnly) {
      throw new HostFailure(
        "read_only", "this connection opened the file read-only");
    }
    if (await film.session.hasExternalChange()) {
      if (!film.externalLogged) {
        film.externalLogged = true;
        await this.audit(
          { kind: "external", name: "outside the host" }, film,
          "file.external_change",
          { summary: `noticed when ${c.name} tried to write` });
      }
      throw new HostFailure(
        "external_change",
        "the file was changed outside the host; reload before writing");
    }
    const expected = p["expectedRevision"];
    if (expected !== undefined && typeof expected !== "number") {
      throw new HostFailure(
        "bad_request", "expectedRevision: expected a number");
    }
    // A stale caller is turned away BEFORE the snapshot: a refusal
    // should cost nothing, and the snapshot is of the state the caller
    // meant to change.
    if (expected !== undefined && expected !== this.revisionOf(film)) {
      throw new StaleRevisionError(expected, this.revisionOf(film));
    }
    if (what.dry === true) {
      // Nothing changes, so nothing is snapshotted, journalled or
      // announced — and the revision stays where it was.
      const out = await run(
        film, expected === undefined ? undefined : expected - film.base);
      return { result: out.result, revision: film.base + out.revision,
               ...(out.dryRun === undefined ? {} : { dryRun: out.dryRun }) };
    }
    const snapshot = what.snapshot ? await this.snapshot(film) : undefined;
    const before = this.revisionOf(film);
    const args = JSON.stringify(p["args"] ?? null).slice(0, 500);
    // The row this write addresses, read ahead of it so that what
    // changed can be said afterwards. Without an audit trail there is
    // nobody to tell, so nothing is read.
    const plan = this.auditSink === undefined ? null
      : planTarget(this.registry, what.via, what.name, p["args"]);
    const rowBefore = plan?.id == null ? null : await readRow(
      film.reader.exec, this.registry, plan.entity, plan.id)
      .catch(() => null);
    let outcome: unknown;
    let failure: unknown;
    try {
      const out = await run(
        film, expected === undefined ? undefined : expected - film.base);
      outcome = out.result;
      return { result: out.result, revision: film.base + out.revision,
               ...(snapshot === undefined ? {} : { snapshot }) };
    } catch (e) {
      failure = e;
      throw e;
    } finally {
      const revision = this.revisionOf(film);
      await this.record(film, {
        at: new Date().toISOString(), revision, by: c.name,
        via: what.via, name: what.name,
        args,
        ok: failure === undefined,
        ...(failure === undefined ? {} : { error: failure instanceof Error
          ? failure.message.slice(0, 300) : String(failure) }),
      });
      const facts = plan === null ? null
        : await this.targetFacts(film, plan, rowBefore, outcome, failure);
      const failed = failure === undefined ? "" : `failed: ${
        failure instanceof Error ? failure.message : String(failure)} `;
      await this.audit(
        this.asUser(c), film, `${what.via}.${what.name}`,
        { targetEntity: facts?.entity ?? null,
          targetUuid: facts?.uuid ?? firstUuidIn(args),
          summary: `${failed}${facts?.summary ?? args}` });
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
        const opened = this.attach(c, film, p["readOnly"] === true);
        await this.audit(this.asUser(c), film, "project.open",
          p["readOnly"] === true ? { summary: "read-only" } : {});
        return opened;
      }
      case "create": {
        const path = await this.requireInRoots(
          need<string>(p, "path", "string"));
        if (await this.platform.exists(path)) {
          throw new HostFailure("exists", `${path} already exists`);
        }
        await this.leave(c);
        const bytes = p["bytes"];
        if (typeof bytes === "string") {
          await this.platform.createFile(path, fromBase64(bytes));
        } else {
          await this.platform.mkdir(this.platform.paths.dirname(path));
          await this.platform.createFile(path, new Uint8Array());
        }
        try {
          const film = await this.openFilm(
            path, bytes === undefined || p["migrate"] === true,
            typeof p["editorVersion"] === "string"
              ? p["editorVersion"] : undefined,
            bytes === undefined);
          const created = this.attach(c, film, false);
          await this.audit(this.asUser(c), film, "project.create");
          return created;
        } catch (e) {
          // A file we just made and could not open is not worth keeping.
          await this.platform.remove(path);
          throw e;
        }
      }
      case "saveAs": {
        const film = this.requireFilm(c);
        const target = await this.requireInRoots(
          need<string>(p, "path", "string"));
        if (await this.platform.exists(target)) {
          throw new HostFailure("exists", `${target} already exists`);
        }
        // A consistent copy of the committed state, taken through the
        // writer so it waits its turn behind queued writes.
        await film.session.write(async (ctx) => {
          await ctx.exec("VACUUM INTO ?", [target]);
        });
        await this.leave(c);
        const copy = await this.openFilm(target, false);
        const attached = this.attach(c, copy, false);
        await this.audit(this.asUser(c), copy, "project.saveAs",
          { summary: `from ${film.path}` });
        return attached;
      }
      case "close":
        await this.leave(c);
        return null;
      case "reload": {
        const film = this.requireFilm(c);
        const last = this.revisionOf(film) + 1;
        // Reopen under the same key, keeping revisions rising.
        await film.session.close();
        await film.reader.close();
        const fresh = await this.platform.openSession(film.path, this.registry);
        const reader = await this.platform.openReader(film.path);
        await reader.exec(
          `PRAGMA busy_timeout = ${String(this.busyTimeoutMs)}`);
        film.session = fresh;
        film.reader = reader;
        film.base = last;
        film.externalLogged = false;
        await this.audit(this.asUser(c), film, "project.reload");
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
        // The curated table is what a tool calls, so it is held to the
        // stricter rules: a snapshot first, and no new integrity finding
        // unless the caller says it has a person watching.
        const gate = p["integrityGate"] !== false;
        const dry = p["dryRun"] === true;
        return this.write(
          c, p, { via: "op", name, snapshot: !dry, dry },
          (film, expected) => callOp(
            film.session, name, p["args"] ?? {},
            { ...(expected === undefined ? {} : { expectedRevision: expected }),
              integrityGate: gate, dryRun: dry }));
      }
      case "call": {
        const name = need<string>(p, "name", "string");
        return this.write(
          c, p, { via: "call", name, snapshot: false },
          (film, expected) => callFn(
            film.session, name, p["args"] ?? [],
            expected === undefined ? {} : { expectedRevision: expected }));
      }
      case "shutdown": {
        if (this.onShutdown === undefined) {
          throw new HostFailure("failed", "this host cannot be asked to exit");
        }
        if (this.connections.size > 1) {
          throw new HostFailure(
            "failed", "other clients are connected; the host is in use");
        }
        // After the answer is sent, not before it.
        const exit = this.onShutdown;
        setTimeout(exit, 50);
        return null;
      }
      case "journal": {
        const film = this.requireFilm(c);
        const limit = typeof p["limit"] === "number"
          ? Math.max(1, Math.min(200, Math.floor(p["limit"]))) : 50;
        return { entries: film.journal.slice(-limit) };
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
