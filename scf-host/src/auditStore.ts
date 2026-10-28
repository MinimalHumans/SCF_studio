// SPDX-License-Identifier: Apache-2.0
/**
 * auditStore.ts — `audit.db`: an append-only, hash-chained trail of what
 * happened to the user's projects and to the app, kept on this machine
 * as app data. Never written into a `.scf`: the format does not carry
 * it (docs/ui-rework-tabs.md §7).
 *
 * Opened over the same seam as `app.db` (`AppDb`), so the window and
 * Node share it, and in a file of its own so clearing or pruning the
 * log can never touch the project pairings. Two processes may append at
 * once (the window and the standalone MCP); each append is one
 * `BEGIN IMMEDIATE` transaction that reads the chain head and extends
 * it.
 *
 * Tamper evidence is against partial edits: a changed, removed or
 * reordered event breaks the chain from there on, and a cut tail no
 * longer matches the stored head. Anyone who can write app data can
 * rewrite the whole log.
 */

import { withTransaction, type Row, type SqlExec, type SqlValue }
  from "@minimalhumans/scf-core";
import {
  openVerified, type AppDb, type AppStoreFs, type OpenAppDb,
} from "./appStore.ts";

export type AuditActor = "user" | "agent" | "external" | "media";
export type AuditScope = "project" | "app";

/** What a caller supplies; the store adds the id, time and chain. */
export interface AuditEventInput {
  actorKind: AuditActor;
  /** The client's own name: "window", "mcp: Claude Desktop". */
  actorName?: string | null;
  scope: AuditScope;
  projectUuid?: string | null;
  projectPath?: string | null;
  /** Dotted, e.g. `op.scene.rename`, `file.external_change`. */
  action: string;
  targetEntity?: string | null;
  targetUuid?: string | null;
  /** A short before/after or argument summary, cut to a readable size. */
  summary?: string | null;
  /** ISO 8601 UTC; now when omitted. */
  at?: string;
}

export interface AuditEvent {
  /** Monotonic, never reused, and the order of the chain. */
  id: number;
  at: string;
  actorKind: AuditActor;
  actorName: string | null;
  scope: AuditScope;
  projectUuid: string | null;
  projectPath: string | null;
  action: string;
  targetEntity: string | null;
  targetUuid: string | null;
  summary: string | null;
  prevHash: string;
  hash: string;
}

export interface AuditFilter {
  scope?: AuditScope;
  actorKind?: AuditActor;
  projectUuid?: string;
  projectPath?: string;
  /** Everything that happened to one row, by uuid. */
  targetUuid?: string;
  /** Substring of the action or summary. */
  search?: string;
  /** Leave out open/close/reload events, which an assistant makes around
   *  every tool call and which bury the changes. */
  hideLifecycle?: boolean;
  /** Inclusive ISO 8601 bounds on `at`. */
  since?: string;
  until?: string;
  /** Page back: only events with a smaller id than this. */
  beforeId?: number;
  /** Default 200, at most 1000. */
  limit?: number;
  /** Default `desc`, newest first. */
  order?: "asc" | "desc";
}

export type AuditVerification =
  | { ok: true; count: number }
  | { ok: false; brokenAt: number | null; reason: string };

export interface AuditStore {
  append(input: AuditEventInput): Promise<AuditEvent>;
  query(filter?: AuditFilter): Promise<AuditEvent[]>;
  count(filter?: AuditFilter): Promise<number>;
  /** Walk the chain and say where it first breaks. */
  verify(): Promise<AuditVerification>;
  /** Every matching event, one JSON object per line, oldest first. */
  exportJsonl(filter?: AuditFilter): Promise<string>;
  /**
   * Delete events older than `before` (ISO 8601), from the front of the
   * chain. The first event left keeps the hash it chains from, so
   * pruning does not read as tampering. Returns how many went.
   */
  prune(before: string): Promise<number>;
  close(): Promise<void>;
}

const SCHEMA_VERSION = 1;
const GENESIS = "";
const SUMMARY_MAX = 500;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** The window is the user; anything else that connects is an agent. */
export function actorKindOf(clientName: string): AuditActor {
  return clientName === "window" ? "user" : "agent";
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** The first uuid mentioned in `text`: a best guess at what was touched. */
export function firstUuidIn(text: string): string | null {
  return UUID.exec(text)?.[0].toLowerCase() ?? null;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Hashed = Omit<AuditEvent, "hash">;

function canonical(e: Hashed): string {
  return JSON.stringify([
    e.id, e.at, e.actorKind, e.actorName, e.scope, e.projectUuid,
    e.projectPath, e.action, e.targetEntity, e.targetUuid, e.summary,
    e.prevHash,
  ]);
}

const str = (v: SqlValue | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

function toEvent(row: Row): AuditEvent {
  return {
    id: Number(row["id"]),
    at: String(row["at"]),
    actorKind: String(row["actor_kind"]) as AuditActor,
    actorName: str(row["actor_name"]),
    scope: String(row["scope"]) as AuditScope,
    projectUuid: str(row["project_uuid"]),
    projectPath: str(row["project_path"]),
    action: String(row["action"]),
    targetEntity: str(row["target_entity"]),
    targetUuid: str(row["target_uuid"]),
    summary: str(row["summary"]),
    prevHash: String(row["prev_hash"]),
    hash: String(row["hash"]),
  };
}

async function migrate(exec: SqlExec): Promise<void> {
  const [row] = await exec("PRAGMA user_version");
  if (Number(row?.["user_version"] ?? 0) >= SCHEMA_VERSION) return;
  await exec(`CREATE TABLE IF NOT EXISTS audit_event (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    actor_kind    TEXT NOT NULL,
    actor_name    TEXT,
    scope         TEXT NOT NULL,
    project_uuid  TEXT,
    project_path  TEXT,
    action        TEXT NOT NULL,
    target_entity TEXT,
    target_uuid   TEXT,
    summary       TEXT,
    prev_hash     TEXT NOT NULL,
    hash          TEXT NOT NULL
  )`);
  await exec(
    "CREATE INDEX IF NOT EXISTS audit_target ON audit_event (target_uuid, id)");
  await exec(
    "CREATE INDEX IF NOT EXISTS audit_project ON audit_event (project_uuid, id)");
  await exec("CREATE INDEX IF NOT EXISTS audit_at ON audit_event (at)");
  // The chain head outlives the rows, so pruning everything and then
  // appending carries on from where the chain stood, and a cut tail is
  // visible as a head that no row matches.
  await exec(`CREATE TABLE IF NOT EXISTS audit_head (
    only_row INTEGER PRIMARY KEY CHECK (only_row = 1),
    id       INTEGER NOT NULL,
    hash     TEXT NOT NULL
  )`);
  await exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function where(f: AuditFilter): { sql: string; params: SqlValue[] } {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const eq = (column: string, value: string | undefined): void => {
    if (value === undefined) return;
    clauses.push(`${column} = ?`);
    params.push(value);
  };
  eq("scope", f.scope);
  eq("actor_kind", f.actorKind);
  eq("project_uuid", f.projectUuid);
  eq("project_path", f.projectPath);
  eq("target_uuid", f.targetUuid?.toLowerCase());
  if (f.search !== undefined && f.search !== "") {
    const like = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      "(action LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (f.hideLifecycle === true) clauses.push("action NOT LIKE 'project.%'");
  if (f.since !== undefined) { clauses.push("at >= ?"); params.push(f.since); }
  if (f.until !== undefined) { clauses.push("at <= ?"); params.push(f.until); }
  if (f.beforeId !== undefined) {
    clauses.push("id < ?");
    params.push(f.beforeId);
  }
  return { sql: clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`,
           params };
}

function createStore(db: AppDb): AuditStore {
  const select = async (
      filter: AuditFilter, limit: number | null): Promise<AuditEvent[]> => {
    const { sql, params } = where(filter);
    const order = filter.order === "asc" ? "ASC" : "DESC";
    const rows = await db.exec(
      `SELECT * FROM audit_event${sql} ORDER BY id ${order}` +
      (limit === null ? "" : " LIMIT ?"),
      limit === null ? params : [...params, limit]);
    return rows.map(toEvent);
  };
  const query: AuditStore["query"] = (filter = {}) => select(
    filter, Math.min(MAX_LIMIT, Math.max(1, Math.floor(
      filter.limit ?? DEFAULT_LIMIT))));

  return {
    close: () => db.close(),
    query,

    append: (input) => withTransaction(db.exec, async () => {
      const [head] = await db.exec("SELECT id, hash FROM audit_head");
      const prevHash = head === undefined ? GENESIS : String(head["hash"]);
      // The id is part of the hash, so it is chosen here, from the head
      // (which survives a prune), not left to the table.
      const id = Number(head?.["id"] ?? 0) + 1;
      const summary = input.summary === undefined || input.summary === null
        ? null : input.summary.slice(0, SUMMARY_MAX);
      const body: Hashed = {
        id, at: input.at ?? new Date().toISOString(),
        actorKind: input.actorKind, actorName: input.actorName ?? null,
        scope: input.scope, projectUuid: input.projectUuid ?? null,
        projectPath: input.projectPath ?? null, action: input.action,
        targetEntity: input.targetEntity ?? null,
        targetUuid: input.targetUuid?.toLowerCase() ?? null,
        summary, prevHash,
      };
      const event: AuditEvent = { ...body, hash: await sha256Hex(canonical(body)) };
      await db.exec(
        "INSERT INTO audit_event (id, at, actor_kind, actor_name, scope, " +
        "project_uuid, project_path, action, target_entity, target_uuid, " +
        "summary, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [event.id, event.at, event.actorKind, event.actorName, event.scope,
         event.projectUuid, event.projectPath, event.action,
         event.targetEntity, event.targetUuid, event.summary,
         event.prevHash, event.hash]);
      await db.exec(
        "INSERT INTO audit_head (only_row, id, hash) VALUES (1, ?, ?) " +
        "ON CONFLICT(only_row) DO UPDATE SET id = excluded.id, " +
        "hash = excluded.hash", [event.id, event.hash]);
      return event;
    }),

    count: async (filter = {}) => {
      const { sql, params } = where(filter);
      const [row] = await db.exec(
        `SELECT COUNT(*) AS n FROM audit_event${sql}`, params);
      return Number(row?.["n"] ?? 0);
    },

    verify: async () => {
      const [head] = await db.exec("SELECT id, hash FROM audit_head");
      const rows = (await db.exec(
        "SELECT * FROM audit_event ORDER BY id ASC")).map(toEvent);
      let prev: AuditEvent | undefined;
      for (const e of rows) {
        // The first event left is the anchor: pruning removes what came
        // before it, so what it chains from is taken as given.
        if (prev !== undefined) {
          if (e.prevHash !== prev.hash) {
            return { ok: false, brokenAt: e.id,
                     reason: "this event does not follow the one before it" };
          }
          if (e.id <= prev.id) {
            return { ok: false, brokenAt: e.id, reason: "ids do not rise" };
          }
        }
        const { hash, ...body } = e;
        if (await sha256Hex(canonical(body)) !== hash) {
          return { ok: false, brokenAt: e.id,
                   reason: "this event was changed after it was written" };
        }
        prev = e;
      }
      if (head === undefined) {
        return prev === undefined ? { ok: true, count: 0 }
          : { ok: false, brokenAt: null, reason: "the chain head is missing" };
      }
      if (prev === undefined) {
        // Everything pruned: the head is all that is left of the chain.
        return { ok: true, count: 0 };
      }
      if (prev.id !== Number(head["id"]) || prev.hash !== String(head["hash"])) {
        return { ok: false, brokenAt: prev.id,
                 reason: "events at the end of the chain are missing" };
      }
      return { ok: true, count: rows.length };
    },

    exportJsonl: async (filter = {}) => {
      // Whole, not a page: an export that stopped at a page size would
      // look complete.
      const events = await select({ ...filter, order: "asc" }, null);
      return events.map((e) => `${JSON.stringify(e)}\n`).join("");
    },

    prune: (before) => withTransaction(db.exec, async () => {
      const [row] = await db.exec(
        "SELECT COUNT(*) AS n FROM audit_event WHERE at < ?", [before]);
      await db.exec("DELETE FROM audit_event WHERE at < ?", [before]);
      return Number(row?.["n"] ?? 0);
    }),
  };
}

export async function openAuditStore(
    path: string, open: OpenAppDb, fs: AppStoreFs): Promise<AuditStore> {
  const db = await openVerified(path, open, fs);
  // Two writers can be open at once, as for app.db.
  await db.exec("PRAGMA journal_mode = WAL");
  await db.exec("PRAGMA busy_timeout = 5000");
  await migrate(db.exec);
  return createStore(db);
}
