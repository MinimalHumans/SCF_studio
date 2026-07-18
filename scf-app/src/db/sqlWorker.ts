/**
 * sqlWorker.ts — wa-sqlite in a Web Worker.
 *
 * OPFS sync access handles only exist in workers, so the database lives
 * here. The main thread talks to it through a tiny message protocol that
 * carries scf-core's SqlExec seam across the boundary:
 *
 *   { id, op: "open", path }            -> { id, ok }
 *   { id, op: "exec", sql, params }     -> { id, ok, rows } | { id, error }
 *   { id, op: "close" }                 -> { id, ok }
 *
 * Import/export of raw bytes is a main-thread concern (opfs.ts): bytes are
 * written to/read from the OPFS path while the database here is closed.
 */

// wa-sqlite's async build is required for async VFS methods.
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import * as SQLite from "wa-sqlite";
import { OriginPrivateFileSystemVFS }
  from "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js";

type SqlValue = string | number | boolean | null | Uint8Array;

interface Request {
  id: number;
  op: "open" | "exec" | "close";
  path?: string;
  sql?: string;
  params?: SqlValue[];
}

let sqlite3: SQLiteAPI | null = null;
let db: number | null = null;

async function ensureApi(): Promise<SQLiteAPI> {
  if (sqlite3 !== null) return sqlite3;
  const module = await SQLiteESMFactory();
  sqlite3 = SQLite.Factory(module);
  const vfs = new OriginPrivateFileSystemVFS();
  // The example VFS classes ship untyped; the API accepts any VFS.Base.
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, true);
  return sqlite3;
}

async function open(path: string): Promise<void> {
  const api = await ensureApi();
  if (db !== null) {
    await api.close(db);
    db = null;
  }
  db = await api.open_v2(
    path,
    SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
    "opfs");
}

async function exec(
    sql: string, params: SqlValue[]): Promise<Record<string, SqlValue>[]> {
  const api = await ensureApi();
  if (db === null) throw new Error("no database open");
  const rows: Record<string, SqlValue>[] = [];
  for await (const stmt of api.statements(db, sql)) {
    if (params.length > 0) {
      api.bind_collection(
        stmt, params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p)));
    }
    const columns = api.column_names(stmt);
    while (await api.step(stmt) === SQLite.SQLITE_ROW) {
      const values = api.row(stmt);
      const row: Record<string, SqlValue> = {};
      columns.forEach((c, i) => {
        row[c] = values[i] as SqlValue;
      });
      rows.push(row);
    }
  }
  return rows;
}

async function close(): Promise<void> {
  if (sqlite3 !== null && db !== null) {
    await sqlite3.close(db);
    db = null;
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, op } = event.data;
  const respond = (payload: Record<string, unknown>): void => {
    self.postMessage({ id, ...payload });
  };
  void (async () => {
    try {
      if (op === "open") {
        await open(event.data.path ?? "working.scf");
        respond({ ok: true });
      } else if (op === "exec") {
        const rows = await exec(event.data.sql ?? "",
                                event.data.params ?? []);
        respond({ ok: true, rows });
      } else if (op === "close") {
        await close();
        respond({ ok: true });
      } else {
        respond({ error: `unknown op ${String(op)}` });
      }
    } catch (e) {
      respond({ error: e instanceof Error ? e.message : String(e) });
    }
  })();
};
