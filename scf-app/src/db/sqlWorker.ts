/**
 * sqlWorker.ts — the official @sqlite.org/sqlite-wasm in a Web Worker,
 * on the opfs-sahpool VFS.
 *
 * Chosen after the first real browser run: the previous wa-sqlite
 * example VFS (OriginPrivateFileSystemVFS) failed to open databases in
 * practice — it is the library's experimental sample, not a maintained
 * path. opfs-sahpool is the SQLite team's recommended OPFS VFS when
 * COOP/COEP headers are not available: persistent, worker-hosted, and
 * with first-class byte import/export (importDb / sqlite3_js_db_export),
 * which also retires the fragile close-then-read-the-file dance — export
 * snapshots the LIVE database via sqlite3_serialize.
 *
 * Protocol (all responses carry {id}; errors as {error}):
 *   { op:"open",   path }          -> { ok }
 *   { op:"exec",   sql, params }   -> { ok, rows }
 *   { op:"close" }                 -> { ok }
 *   { op:"import", path, bytes }   -> { ok }        (overwrites, opens)
 *   { op:"export" }                -> { ok, bytes } (live snapshot)
 *   { op:"wipe",   path }          -> { ok }        (delete + fresh open)
 *   { op:"exists", path }          -> { ok, exists }
 */

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

type SqlValue = string | number | boolean | null | Uint8Array;

interface Request {
  id: number;
  op: "open" | "exec" | "close" | "import" | "export" | "wipe" | "exists";
  path?: string;
  sql?: string;
  params?: SqlValue[];
  bytes?: ArrayBuffer;
}

// The sqlite-wasm JS API is intentionally loosely typed; this worker is
// the one file that talks to it.
/* eslint-disable @typescript-eslint/no-explicit-any */

let sqlite3: any = null;
let poolUtil: any = null;
let db: any = null;

/**
 * The SAH pool treats database names as absolute paths. importDb,
 * OpfsSAHPoolDb, unlink, and getFileNames must all see the SAME
 * spelling, or bytes get imported into one file while a different,
 * freshly-created empty one gets opened — no error, no data. One
 * canonical form, used everywhere.
 */
function norm(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function ensurePool(): Promise<void> {
  if (poolUtil !== null) return;
  const init = sqlite3InitModule as unknown as
    (cfg: Record<string, unknown>) => Promise<any>;
  sqlite3 = await init({
    print: () => undefined,
    printErr: (msg: string) => {
      // Surface wasm-level complaints in the console; they are the
      // ground truth when something goes wrong at this layer.
      console.error("[sqlite-wasm]", msg);
    },
  });
  try {
    poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: "scf-pool" });
  } catch (e) {
    throw new Error(
      "could not acquire database storage — is SCF open in another " +
      "tab or window? (" +
      (e instanceof Error ? e.message : String(e)) + ")");
  }
}

function closeDb(): void {
  if (db !== null) {
    db.close();
    db = null;
  }
}

async function open(path: string): Promise<void> {
  await ensurePool();
  closeDb();
  db = new poolUtil.OpfsSAHPoolDb(norm(path));
}

function exec(sql: string,
              params: SqlValue[]): Record<string, SqlValue>[] {
  if (db === null) throw new Error("no database open");
  const rows: Record<string, SqlValue>[] = [];
  db.exec({
    sql,
    bind: params.length > 0
      ? params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
      : undefined,
    rowMode: "object",
    resultRows: rows,
  });
  return rows;
}

async function importBytes(path: string,
                           bytes: ArrayBuffer): Promise<void> {
  await ensurePool();
  closeDb();
  await poolUtil.importDb(norm(path), new Uint8Array(bytes));
  db = new poolUtil.OpfsSAHPoolDb(norm(path));
}

function exportBytes(): ArrayBuffer {
  if (db === null) throw new Error("no database open");
  const out: Uint8Array = sqlite3.capi.sqlite3_js_db_export(db);
  // Copy into a plain ArrayBuffer for transfer.
  return out.slice().buffer;
}

async function wipe(path: string): Promise<void> {
  await ensurePool();
  closeDb();
  const names: string[] = poolUtil.getFileNames();
  for (const name of names) {
    if (norm(name) === norm(path)) poolUtil.unlink(name);
  }
  db = new poolUtil.OpfsSAHPoolDb(norm(path));
}

async function exists(path: string): Promise<boolean> {
  await ensurePool();
  const names: string[] = poolUtil.getFileNames();
  return names.some((name) => norm(name) === norm(path));
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, op } = event.data;
  void (async () => {
    try {
      if (op === "open") {
        await open(event.data.path ?? "working.scf");
        self.postMessage({ id, ok: true });
      } else if (op === "exec") {
        const rows = exec(event.data.sql ?? "", event.data.params ?? []);
        self.postMessage({ id, ok: true, rows });
      } else if (op === "close") {
        closeDb();
        self.postMessage({ id, ok: true });
      } else if (op === "import") {
        await importBytes(event.data.path ?? "working.scf",
                          event.data.bytes ?? new ArrayBuffer(0));
        self.postMessage({ id, ok: true });
      } else if (op === "export") {
        const bytes = exportBytes();
        self.postMessage({ id, ok: true, bytes }, { transfer: [bytes] });
      } else if (op === "wipe") {
        await wipe(event.data.path ?? "working.scf");
        self.postMessage({ id, ok: true });
      } else if (op === "exists") {
        self.postMessage({
          id, ok: true,
          exists: await exists(event.data.path ?? "working.scf"),
        });
      } else {
        self.postMessage({ id, error: `unknown op ${String(op)}` });
      }
    } catch (e) {
      console.error("[sqlWorker]", op, e);
      self.postMessage({
        id,
        error: e instanceof Error
          ? `${e.message}${e.cause !== undefined
              ? ` (${String(e.cause)})` : ""}`
          : String(e),
      });
    }
  })();
};
