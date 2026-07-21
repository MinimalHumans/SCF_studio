/**
 * workerClient.ts — main-thread client for the SQLite worker.
 *
 * Exposes scf-core's SqlExec seam over postMessage, plus byte-level
 * import/export of the working database. Export snapshots the LIVE
 * database (sqlite3_serialize under the hood) — no close/reopen dance,
 * no path coupling to OPFS internals.
 */

import type { Row, SqlExec, SqlValue } from "@scf-core/db.ts";

interface Payload {
  ok?: boolean;
  rows?: Row[];
  bytes?: ArrayBuffer;
  exists?: boolean;
  error?: string;
}

interface Pending {
  resolve: (payload: Payload) => void;
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
      const data = event.data as Payload & { id: number };
      const pending = this.#pending.get(data.id);
      if (pending === undefined) return;
      this.#pending.delete(data.id);
      if (data.ok === true) pending.resolve(data);
      else pending.reject(new Error(data.error ?? "worker error"));
    };
    this.#worker.onerror = (event) => {
      // A worker-level crash (module failed to load, etc.) rejects
      // everything in flight — otherwise callers hang forever.
      const err = new Error(`sql worker failed: ${event.message}`);
      for (const pending of this.#pending.values()) pending.reject(err);
      this.#pending.clear();
    };
  }

  #send(op: string, payload: Record<string, unknown> = {},
        transfer: Transferable[] = []): Promise<Payload> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, op, ...payload }, transfer);
    });
  }

  open(path: string): Promise<void> {
    return this.#send("open", { path }).then(() => undefined);
  }

  close(): Promise<void> {
    return this.#send("close").then(() => undefined);
  }

  /** Overwrite the working database with these bytes and open it. */
  importBytes(path: string, bytes: ArrayBuffer): Promise<void> {
    return this.#send("import", { path, bytes }, [bytes])
      .then(() => undefined);
  }

  /** Consistent snapshot of the live database. */
  exportBytes(): Promise<ArrayBuffer> {
    return this.#send("export").then((p) => p.bytes ?? new ArrayBuffer(0));
  }

  /** Delete the working database (if present) and open a fresh one. */
  wipe(path: string): Promise<void> {
    return this.#send("wipe", { path }).then(() => undefined);
  }

  exists(path: string): Promise<boolean> {
    return this.#send("exists", { path }).then((p) => p.exists === true);
  }

  /** scf-core's seam. Errors from the worker arrive as rejections. */
  exec: SqlExec = (sql: string, params: SqlValue[] = []) =>
    this.#send("exec", { sql, params }).then((p) => p.rows ?? []);

  terminate(): void {
    this.#worker.terminate();
  }
}
