/**
 * db.ts — scf-core database layer.
 *
 * All of scf-core speaks to SQLite through one minimal async interface,
 * `SqlExec`. The browser app supplies a wa-sqlite/OPFS implementation; Node
 * (conformance CI, scripts, the future MCP server) supplies node:sqlite or
 * better-sqlite3 wrapped in a resolved promise. The interface is async
 * because wa-sqlite's OPFS VFS is async-facing; sync drivers wrap for free,
 * the reverse refactor would not.
 *
 * initDatabase() is re-implemented from the registry exactly as Python's
 * database.init_database does it for entity tables: CREATE TABLE IF NOT
 * EXISTS with framework columns + registry fields, then ALTER-add missing
 * columns, uuid unique indexes, and _scf_meta schema-version stamping
 * identical to migrations.maybe_migrate. (1.x data migrations do NOT port —
 * they are the Python editor's problem, per the design doc.)
 */

import type { EntityDef, Registry } from "./registry.ts";
import { initScreenplayTables } from "./screenplay/rowModel.ts";

export type SqlValue = string | number | boolean | null | Uint8Array;
export type Row = Record<string, SqlValue>;

/** The one seam between scf-core and any SQLite driver. */
export type SqlExec = (sql: string, params?: SqlValue[]) => Promise<Row[]>;

/**
 * Quote a SQL identifier so reserved words (order, group, key, …) work as
 * table or column names. Standard SQL double-quoting.
 * (Port of database.py::_q.)
 */
export function q(identifier: string): string {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

/** Cross-file row identity (schema 2.3). Stamp on every insert. */
/**
 * Run `fn` inside a single transaction. Without this, each statement
 * auto-commits — on OPFS-backed storage every commit is an fsync, and a
 * multi-thousand-row write (script import, version publish) stalls for
 * minutes. One BEGIN/COMMIT turns that into one flush.
 */
export async function withTransaction<T>(
    exec: SqlExec, fn: () => Promise<T>): Promise<T> {
  await exec("BEGIN IMMEDIATE");
  try {
    const out = await fn();
    await exec("COMMIT");
    return out;
  } catch (e) {
    try {
      await exec("ROLLBACK");
    } catch {
      // the original error is the one that matters
    }
    throw e;
  }
}

export function newUuid(): string {
  return crypto.randomUUID();
}

function columnDdl(f: { name: string; sqlType: string; default?: unknown }):
    string {
  let col = `${q(f.name)} ${f.sqlType}`;
  // NOT NULL is intentionally not emitted; required=true is a form-level
  // hint (see database.py::_create_entity_table docstring).
  if (f.default !== undefined && f.default !== null) {
    if (typeof f.default === "string") {
      col += ` DEFAULT '${f.default.replaceAll("'", "''")}'`;
    } else {
      col += ` DEFAULT ${f.default}`;
    }
  }
  return col;
}

export async function tableColumns(
    exec: SqlExec, table: string): Promise<Set<string>> {
  const rows = await exec(`PRAGMA table_info(${q(table)})`);
  return new Set(rows.map((r) => String(r["name"])));
}

async function createEntityTable(
    exec: SqlExec, e: EntityDef): Promise<void> {
  const columns = [
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
    // uuid: cross-file row identity (schema 2.3); integer id stays the
    // local primary key.
    "uuid TEXT",
    "created_at TEXT DEFAULT (datetime('now'))",
    "updated_at TEXT DEFAULT (datetime('now'))",
    ...e.fields.map(columnDdl),
  ];
  await exec(
    `CREATE TABLE IF NOT EXISTS ${q(e.name)} (\n  ` +
    columns.join(",\n  ") + "\n)");

  // Simple migration: add missing columns.
  const existing = await tableColumns(exec, e.name);
  for (const f of e.fields) {
    if (!existing.has(f.name)) {
      await exec(
        `ALTER TABLE ${q(e.name)} ADD COLUMN ` + columnDdl(f));
    }
  }
  if (!existing.has("uuid")) {
    await exec(`ALTER TABLE ${q(e.name)} ADD COLUMN uuid TEXT`);
  }
}

async function ensureUuidIndexAndBackfill(
    exec: SqlExec, table: string): Promise<number> {
  await exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${q("idx_" + table + "_uuid")} ` +
    `ON ${q(table)}(uuid)`);
  const rows = await exec(
    `SELECT id FROM ${q(table)} WHERE uuid IS NULL`);
  for (const row of rows) {
    await exec(`UPDATE ${q(table)} SET uuid = ? WHERE id = ?`,
               [newUuid(), row["id"] ?? null]);
  }
  return rows.length;
}

async function tableExists(exec: SqlExec, table: string): Promise<boolean> {
  const rows = await exec(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [table]);
  return rows.length > 0;
}

export interface InitOptions {
  /** Stamped into _scf_meta.editor_version by the calling application. */
  editorVersion?: string;
}

/**
 * Initialize/migrate an .scf database from the registry. Creates _scf_meta
 * and every registry entity table, ensures uuid identity (column + unique
 * index + backfill) on registry tables and any present uuidExtraTables,
 * and stamps schema_version. Same file, same SQL, same tables as the
 * Python implementation.
 */
export async function initDatabase(
    exec: SqlExec, registry: Registry,
    options: InitOptions = {}): Promise<void> {
  await exec(`CREATE TABLE IF NOT EXISTS _scf_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  if (options.editorVersion !== undefined) {
    await exec(
      "INSERT OR REPLACE INTO _scf_meta (key, value) VALUES (?, ?)",
      ["editor_version", options.editorVersion]);
  }
  await exec(
    "INSERT OR REPLACE INTO _scf_meta (key, value) VALUES (?, ?)",
    ["updated_at", new Date().toISOString()]);

  for (const name of registry.order) {
    const e = registry.entities.get(name);
    if (e !== undefined) await createEntityTable(exec, e);
  }

  // Screenplay infrastructure (Part 3 row model — lands with Stage 2 of
  // the parser, per the decision deferred at phase 1). Same DDL as
  // Python's screenplay_db.init_screenplay_tables; the uuid loop below
  // extends 2.3 identity to these tables the moment they exist.
  await initScreenplayTables(exec);

  // Schema 2.3: uuid identity on every user-data row. Registry tables
  // always exist by now; extra (infrastructure) tables only if present.
  for (const name of registry.order) {
    await ensureUuidIndexAndBackfill(exec, name);
  }
  for (const extra of registry.uuidExtraTables) {
    if (await tableExists(exec, extra)) {
      const cols = await tableColumns(exec, extra);
      if (!cols.has("uuid")) {
        await exec(`ALTER TABLE ${q(extra)} ADD COLUMN uuid TEXT`);
      }
      await ensureUuidIndexAndBackfill(exec, extra);
    }
  }

  await exec(
    "INSERT OR REPLACE INTO _scf_meta (key, value) VALUES (?, ?)",
    ["schema_version", registry.schemaVersion]);
}

/** Read _scf_meta as a plain object. */
export async function readMeta(
    exec: SqlExec): Promise<Record<string, string>> {
  const rows = await exec("SELECT key, value FROM _scf_meta");
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r["key"])] = String(r["value"]);
  return out;
}
