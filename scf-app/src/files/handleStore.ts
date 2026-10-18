// SPDX-License-Identifier: Apache-2.0
/**
 * handleStore.ts — remember which asset FOLDER belongs to which project,
 * across a reload.
 *
 * A project is now identified by its path on the host, which a reload
 * keeps. What a reload does not keep is the browser's permission to read
 * the folder; the directory handle itself survives in IndexedDB (handles
 * are structured-cloneable), and Chromium re-asks on first use. That
 * prompt cannot be suppressed and should not be — it is the user's
 * guarantee that a page cannot read their disk unasked.
 *
 * The pairing is stored as a pairing, keyed by project path. A single
 * remembered folder would join whatever folder was last opened to
 * whatever project was last opened, and every asset in the second
 * project would then address against the first one's disk.
 */

const DB_NAME = "scf-session";
const STORE = "handles";
/** The last folder, for a session with no project path to key on. */
const ROOT_KEY = "root";
const PAIRS_KEY = "root-pairs";

/** How many projects keep their folder. Beyond this the least recently
 *  opened one is dropped and its owner picks the folder again — a
 *  bounded, harmless cost, unlike an IndexedDB record that grows for
 *  the life of the origin. */
const MAX_PAIRS = 8;

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

export async function rememberRoot(handle: unknown): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(handle, ROOT_KEY));
  } catch { /* best effort: the folder is simply asked for again */ }
}

export async function recallRoot(): Promise<unknown | null> {
  try {
    return await withStore("readonly", (s) => s.get(ROOT_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetRoot(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(ROOT_KEY));
  } catch { /* nothing to clean up */ }
}

export interface RootPair {
  /** The project's path on the host. */
  path: string;
  root: unknown;
  /** The mode the grant was asked for. Querying in the wrong one
   *  misreports a working folder (see fileAdapter's RootMode). */
  mode: "read" | "readwrite";
}

async function readPairs(): Promise<RootPair[]> {
  try {
    const stored = await withStore<unknown>(
      "readonly", (s) => s.get(PAIRS_KEY));
    // Pairs from before projects were keyed by path carried a file
    // handle instead; they cannot be matched and are dropped.
    return Array.isArray(stored)
      ? (stored as RootPair[]).filter((p) => typeof p.path === "string")
      : [];
  } catch {
    return [];
  }
}

/** Remember that this project lives in this folder. Most recent first. */
export async function rememberPair(
  path: string | null, root: unknown, mode: "read" | "readwrite",
): Promise<void> {
  if (path === null) return;
  try {
    const kept = (await readPairs())
      .filter((p) => p.path !== path)
      .slice(0, MAX_PAIRS - 1);
    await withStore("readwrite",
      (s) => s.put([{ path, root, mode }, ...kept], PAIRS_KEY));
  } catch { /* best effort, as above */ }
}

/** The folder this project was last opened with, if it is still known. */
export async function recallPairFor(
    path: string | null): Promise<RootPair | null> {
  if (path === null) return null;
  return (await readPairs()).find((p) => p.path === path) ?? null;
}
