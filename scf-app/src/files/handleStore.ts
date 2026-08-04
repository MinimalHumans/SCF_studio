/**
 * handleStore.ts — remember which .scf file a session was writing to,
 * across a reload.
 *
 * The working database already survives a refresh: it lives in OPFS.
 * What did not survive was the FileSystemFileHandle, so a reload left
 * the project unreachable even though every byte of it was still there.
 * Handles are structured-cloneable, so IndexedDB can hold one.
 *
 * The browser still owns permission: after a reload the handle is valid
 * but its write grant is not, and Chromium will re-ask on the first
 * save. That prompt cannot be suppressed and should not be — it is the
 * user's guarantee that a page cannot silently write to their disk.
 */

const DB_NAME = "scf-session";
const STORE = "handles";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error("indexedDB")); };
  });
}

async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => { resolve(req.result); };
      req.onerror = () => { reject(req.error ?? new Error("idb request")); };
    });
  } finally {
    db.close();
  }
}

export async function rememberHandle(handle: unknown): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(handle, KEY));
  } catch {
    // Best effort: a session that cannot remember its file still works,
    // it just asks where to save.
  }
}

export async function recallHandle(): Promise<unknown | null> {
  try {
    return await withStore("readonly", (s) => s.get(KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetHandle(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(KEY));
  } catch { /* nothing to clean up */ }
}
