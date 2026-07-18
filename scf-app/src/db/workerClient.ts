/**
 * workerClient.ts — main-thread client for the SQLite worker.
 *
 * Exposes scf-core's SqlExec seam backed by postMessage, plus the OPFS
 * byte-level helpers for import/export. Contract: the database must be
 * closed while bytes are being written or read (single writer; the worker
 * VFS holds access handles while open).
 */

import type { Row, SqlExec, SqlValue } from "@scf-core/db.ts";

interface Pending {
  resolve: (rows: Row[]) => void;
  reject: (err: Error) => void;
}

export class SqlWorkerClient {
  #worker: Worker;
  #nextId = 1;
  #pending = new Map<number, Pending>();

  constructor() {
    this.#worker = new Worker(
      new URL("./sqlWorker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = (event: MessageEvent) => {
      const { id, ok, rows, error } = event.data as {
        id: number; ok?: boolean; rows?: Row[]; error?: string;
      };
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      this.#pending.delete(id);
      if (ok === true) pending.resolve(rows ?? []);
      else pending.reject(new Error(error ?? "worker error"));
    };
  }

  #send(op: string, payload: Record<string, unknown> = {}): Promise<Row[]> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, op, ...payload });
    });
  }

  open(path: string): Promise<void> {
    return this.#send("open", { path }).then(() => undefined);
  }

  close(): Promise<void> {
    return this.#send("close").then(() => undefined);
  }

  /** scf-core's seam. Errors from the worker arrive as rejections. */
  exec: SqlExec = (sql: string, params: SqlValue[] = []) =>
    this.#send("exec", { sql, params });

  terminate(): void {
    this.#worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// OPFS byte-level working copy (main thread; database must be closed)
// ---------------------------------------------------------------------------

async function opfsFileHandle(
    path: string, create: boolean): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(path, { create });
}

export async function writeWorkingCopy(
    path: string, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  const handle = await opfsFileHandle(path, true);
  const writable = await handle.createWritable();
  await writable.write(bytes as FileSystemWriteChunkType);
  await writable.close();
}

export async function readWorkingCopy(path: string): Promise<ArrayBuffer> {
  const handle = await opfsFileHandle(path, false);
  const file = await handle.getFile();
  return file.arrayBuffer();
}

export async function workingCopyExists(path: string): Promise<boolean> {
  try {
    await opfsFileHandle(path, false);
    return true;
  } catch {
    return false;
  }
}
