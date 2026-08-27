// SPDX-License-Identifier: Apache-2.0
/**
 * handleStore.ts — remember which .scf file a session was writing to,
 * and which folder it lives in, across a reload.
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
/** The project FOLDER (P2). Kept under its own key so a degraded
 *  single-file session does not clear a remembered root, and a folder
 *  session does not resurrect a stale file handle. */
const ROOT_KEY = "root";

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

export async function rememberRoot(handle: unknown): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(handle, ROOT_KEY));
  } catch { /* best effort, as above */ }
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

export async function forgetHandle(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(KEY));
  } catch { /* nothing to clean up */ }
}

/* ── Which folder belongs to which file ─────────────────────────────
 *
 * `ROOT_KEY` above holds one root for one session, which was fine while
 * the only way to get a root was to open a folder. It is not fine now:
 * open project A as a folder, then open B's `.scf` on its own, and the
 * remembered root is still A's while the remembered file is B's. A
 * resume pairs them, and every asset in B addresses against A's folder.
 *
 * So the pairing is stored as a pairing. `isSameEntry()` is what makes
 * the lookup possible — handles are not comparable by value and a
 * filename is not identity, but the browser will say whether two
 * handles point at the same thing on disk. Reopening a project a second
 * time therefore costs one click to re-grant instead of a trip through
 * the folder picker.
 */
const PAIRS_KEY = "root-pairs";

/** How many projects keep their folder. Beyond this the least recently
 *  opened one is dropped and its owner picks the folder again — a
 *  bounded, harmless cost, unlike an IndexedDB record that grows for
 *  the life of the origin. */
const MAX_PAIRS = 8;

export interface RootPair {
  file: unknown;
  root: unknown;
  /** The mode the grant was asked for. Querying in the wrong one
   *  misreports a working folder (see fileAdapter's RootMode). */
  mode: "read" | "readwrite";
}

async function readPairs(): Promise<RootPair[]> {
  try {
    const stored = await withStore<unknown>(
      "readonly", (s) => s.get(PAIRS_KEY));
    return Array.isArray(stored) ? stored as RootPair[] : [];
  } catch {
    return [];
  }
}

/** Remember that this file lives in this folder. Most recent first. */
export async function rememberPair(
  file: unknown, root: unknown, mode: "read" | "readwrite",
): Promise<void> {
  if (file === null || file === undefined) return;
  try {
    const kept: RootPair[] = [];
    for (const pair of await readPairs()) {
      if (kept.length >= MAX_PAIRS - 1) break;
      if (await sameEntry(pair.file, file)) continue;  // superseded
      kept.push(pair);
    }
    await withStore("readwrite",
      (s) => s.put([{ file, root, mode }, ...kept], PAIRS_KEY));
  } catch { /* best effort, as above */ }
}

/** The folder this file was last opened with, if it is still known. */
export async function recallPairFor(file: unknown): Promise<RootPair | null> {
  if (file === null || file === undefined) return null;
  for (const pair of await readPairs()) {
    if (await sameEntry(pair.file, file)) return pair;
  }
  return null;
}

async function sameEntry(a: unknown, b: unknown): Promise<boolean> {
  const handle = a as FileSystemHandle | null;
  if (handle === null || typeof handle?.isSameEntry !== "function") {
    return false;
  }
  try {
    return await handle.isSameEntry(b as FileSystemHandle);
  } catch {
    return false;
  }
}
