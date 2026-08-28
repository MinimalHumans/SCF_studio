// SPDX-License-Identifier: Apache-2.0
/**
 * objectUrlCache — one object URL per file, however many thumbnails
 * are looking at it.
 *
 * `AssetPreview` creates a URL and revokes it on unmount, which is
 * exactly right for one previewer and wrong for a list. Its own header
 * says so: "an asset browser walked through a few hundred plates would
 * hold all of them." Thumbnails make that the normal case rather than
 * the pathological one — the same plate can be in a bundle list, on a
 * binding, behind a subject's anchor and in the asset browser at the
 * same moment, and four URLs for one file is four things to revoke and
 * three chances to leak.
 *
 * So: refcounted, keyed by root handle plus path. Acquire returns the
 * URL and increments; release decrements and revokes at zero. The
 * revoke is deferred by a grace period, because React unmounts and
 * remounts a row constantly while scrolling or re-rendering, and a URL
 * revoked between the two shows a broken image for a file that is
 * perfectly present.
 *
 * A URL is a REFERENCE to the file, not a copy of its bytes — the
 * browser streams them when the <img> decodes. What costs memory is the
 * decoded bitmap, which is why the caller, not this module, decides
 * whether a format and a size are worth decoding at all.
 *
 * Nothing here is a thumbnail CACHE. Sidecar thumbnails are ruled out
 * by the read-only rule (conventions §9); this holds handles to files
 * that already exist and writes nothing.
 */

import { assetObjectUrl } from "./assetLocator.ts";

interface Entry {
  url: string | null;
  /** In-flight load, so ten rows appearing at once make one read. */
  pending: Promise<string | null> | null;
  refs: number;
  /** `ReturnType<typeof setTimeout>` rather than `number`: this package
   *  compiles with node types in scope, where the bare timer functions
   *  return a `Timeout` object. Vitest ran happily on `number`; tsc
   *  caught it. */
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * How long a URL survives its last release. Long enough to cover an
 * unmount/remount from a re-render, short enough that scrolling past a
 * folder of plates does not accumulate them.
 */
const GRACE_MS = 5000;

const entries = new Map<string, Entry>();
/** Roots are handles, so the key is an identity, not a name: two
 *  different folders can hold the same relative path. */
const rootIds = new WeakMap<object, number>();
let nextRootId = 1;

function keyFor(root: FileSystemDirectoryHandle | null,
                path: string): string {
  if (root === null) return `-:${path}`;
  let id = rootIds.get(root);
  if (id === undefined) {
    id = nextRootId++;
    rootIds.set(root, id);
  }
  return `${id}:${path}`;
}

/**
 * Take a reference to this file's object URL, creating it if needed.
 *
 * Every successful call must be matched by exactly one `release()` with
 * the same arguments, including the calls that resolve to null — the
 * refcount is what keeps a shared URL alive, and an unbalanced acquire
 * pins a file for the life of the session.
 */
export async function acquire(
  root: FileSystemDirectoryHandle | null, path: string,
): Promise<string | null> {
  const key = keyFor(root, path);
  let entry = entries.get(key);

  if (entry === undefined) {
    entry = { url: null, pending: null, refs: 0, timer: null };
    entries.set(key, entry);
  }
  entry.refs += 1;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry.url !== null) return entry.url;

  entry.pending ??= assetObjectUrl(root, path);
  const url = await entry.pending;

  // Released while the read was in flight: whoever asked has gone, so
  // hand back the URL and revoke rather than storing an orphan.
  const current = entries.get(key);
  if (current !== entry || entry.refs === 0) {
    if (url !== null) URL.revokeObjectURL(url);
    return null;
  }
  entry.url = url;
  entry.pending = null;
  return url;
}

/** Give back a reference. Revokes once nothing holds it. */
export function release(
  root: FileSystemDirectoryHandle | null, path: string,
): void {
  const key = keyFor(root, path);
  const entry = entries.get(key);
  if (entry === undefined) return;

  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.timer !== null) return;

  // Bare setTimeout rather than window.setTimeout, unlike the rest of
  // the app: the refcount is the load-bearing part of this module and a
  // headless test must be able to drive its clock without a DOM.
  entry.timer = setTimeout(() => {
    const still = entries.get(key);
    if (still === undefined) return;
    // Clear the handle FIRST, before deciding whether to revoke.
    //
    // The early return below used to leave `timer` set on an entry it
    // had decided not to revoke. Nothing reaches that state in this
    // version — `acquire` always clears a pending timer — but the next
    // release would then see a non-null timer, take the early exit
    // above, and never schedule one. The URL would live for the rest of
    // the session with nothing holding it. Found by deleting the
    // refcount guard in `release` and watching the tests still pass:
    // the two guards were covering for each other.
    still.timer = null;
    if (still.refs > 0) return;
    if (still.url !== null) URL.revokeObjectURL(still.url);
    entries.delete(key);
  }, GRACE_MS);
}

/**
 * Drop everything. Called when the project closes or its root changes:
 * a URL into the old folder resolves to bytes from a project the user
 * is no longer in, which is a worse failure than a blank thumbnail
 * because it looks like it worked.
 */
export function revokeAll(): void {
  for (const [, entry] of entries) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (entry.url !== null) URL.revokeObjectURL(entry.url);
  }
  entries.clear();
}
