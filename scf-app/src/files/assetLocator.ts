// SPDX-License-Identifier: Apache-2.0
/**
 * assetLocator.ts — the I/O half of asset resolution.
 *
 * `scf-core/assets.ts` owns the grammar and the state machine and knows
 * nothing about a browser. This supplies the one thing it cannot: an
 * answer to "is there something at this path".
 *
 * Traversal, never enumeration. Resolution walks `getDirectoryHandle`
 * and `getFileHandle` from the root, which matters because directory
 * LISTING turned out not to be available everywhere (conventions §9) —
 * a managed machine returned zero entries for an ordinary folder while
 * traversal through the same handle worked. Nothing here lists.
 *
 * A root that is not configured returns `undefined` rather than `null`,
 * so "no such root" and "no such file" stay different answers. Named
 * roots beyond `@project` are reserved in the grammar and not yet
 * configurable, so the map has one entry today.
 */

import { PROJECT_ROOT, projectIdentifier, type FileLocator,
         type LocatedFile } from "@scf-core/assets.ts";
import { candidatePaths, type ImportCandidate }
  from "@scf-core/assetImport.ts";

/**
 * A cloud placeholder is a file whose metadata exists and whose bytes
 * do not. The browser gives no direct signal, so the heuristic is a
 * zero-length file that claims a modification time — real empty files
 * are rare in an asset tree and being wrong here costs a label, not
 * data. The distinction is worth the imprecision: reporting a synced
 * project as broken on open would be a false statement about the
 * user's data.
 */
function looksUnmaterialised(file: File): boolean {
  return file.size === 0 && file.lastModified > 0;
}

export function makeLocator(
  root: FileSystemDirectoryHandle | null,
): FileLocator {
  return async (rootName, path) => {
    if (rootName !== PROJECT_ROOT) return undefined;
    if (root === null) return undefined;

    const parts = path.split("/").filter((p) => p !== "");
    const last = parts.pop();
    if (last === undefined) return null;

    try {
      let dir = root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part);
      }
      const file = await (await dir.getFileHandle(last)).getFile();
      const located: LocatedFile = {
        materialised: !looksUnmaterialised(file),
        sizeBytes: file.size,
        mtime: new Date(file.lastModified).toISOString(),
      };
      return located;
    } catch {
      // NotFoundError and friends all mean the same thing to a
      // resolver: nothing reachable there. The state machine decides
      // what to call it.
      return null;
    }
  };
}

async function fileAt(
  root: FileSystemDirectoryHandle | null, path: string,
): Promise<File | null> {
  if (root === null) return null;
  const parts = path.split("/").filter((p) => p !== "");
  const last = parts.pop();
  if (last === undefined) return null;
  try {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return await (await dir.getFileHandle(last)).getFile();
  } catch {
    return null;
  }
}

/**
 * The head of a text asset. Truncated because a 40MB log has no
 * business entering the DOM, and a preview is a look rather than a
 * read.
 */
export async function readAssetText(
  root: FileSystemDirectoryHandle | null, path: string, limit: number,
): Promise<string | null> {
  const file = await fileAt(root, path);
  if (file === null) return null;
  const slice = await file.slice(0, limit).text();
  return file.size > limit
    ? `${slice}\n\n… truncated at ${Math.round(limit / 1024)} KB`
    : slice;
}

/**
 * The leading bytes of an asset, with the file's own size and mtime.
 *
 * Sliced rather than read whole: header parsing needs the first tens of
 * KB, and a 400MB plate has no business being pulled into memory to
 * report its dimensions.
 */
export async function readAssetBytes(
  root: FileSystemDirectoryHandle | null, path: string, limit: number,
): Promise<{ bytes: ArrayBuffer; size: number;
             lastModified: number } | null> {
  const file = await fileAt(root, path);
  if (file === null) return null;
  return {
    bytes: await file.slice(0, limit).arrayBuffer(),
    size: file.size,
    lastModified: file.lastModified,
  };
}

/** An object URL for a resolved asset, or null. Caller revokes it. */
export async function assetObjectUrl(
  root: FileSystemDirectoryHandle | null, path: string,
): Promise<string | null> {
  const file = await fileAt(root, path);
  return file === null ? null : URL.createObjectURL(file);
}


export interface PickedAssets {
  candidates: ImportCandidate[];
  /** Files the user picked from outside the project folder. They are
   *  not imported: an identifier that cannot be expressed relative to a
   *  root would have to be absolute, and an import that silently
   *  produced non-portable addresses would undo the point of §9. */
  outsideRoot: string[];
}

/**
 * Let the user multi-select files, and address them against the root.
 *
 * `resolve()` is the load-bearing call: it returns the path segments
 * from the root down to a handle, which is how a picked file becomes
 * `@project/assets/plates/sh010.exr` rather than a bare filename. It
 * traverses rather than enumerates, so this works on machines where
 * directory listing returns nothing (conventions §9) — which is
 * precisely why import is built on a picker instead of a folder walk.
 *
 * The cost is that the user selects the files themselves; the benefit
 * is that it works everywhere, and multi-select handles a folder's
 * worth in one gesture.
 */
export async function pickAssetFiles(
  root: FileSystemDirectoryHandle | null,
): Promise<PickedAssets | null> {
  if (root === null) return null;

  let handles: FileSystemFileHandle[];
  try {
    handles = await window.showOpenFilePicker({ multiple: true });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }

  const candidates: ImportCandidate[] = [];
  const outsideRoot: string[] = [];

  for (const handle of handles) {
    let segments: string[] | null = null;
    try {
      segments = await root.resolve(handle);
    } catch {
      segments = null;
    }
    if (segments === null || segments.length === 0) {
      outsideRoot.push(handle.name);
      continue;
    }
    let sizeBytes: number | null = null;
    let mtime: string | null = null;
    try {
      const file = await handle.getFile();
      sizeBytes = file.size;
      mtime = new Date(file.lastModified).toISOString();
    } catch { /* metadata is a hint; its absence is not a failure */ }

    candidates.push({
      identifier: projectIdentifier(segments.join("/")),
      name: handle.name,
      sizeBytes,
      mtime,
    });
  }

  return { candidates, outsideRoot };
}


/**
 * Import a whole folder, on machines where enumeration is unavailable.
 *
 * `<input type="file" webkitdirectory>` predates the File System Access
 * API and walks the directory inside the browser's own picker process,
 * handing back a flat FileList with `webkitRelativePath` on each entry.
 * It is a different code path from `entries()` entirely, and it works
 * where that one returns nothing (conventions §9).
 *
 * The catch is the anchor: paths are relative to the folder the user
 * picked, and a `File` carries no handle, so `resolve()` cannot be
 * asked where that folder sits. `candidatePaths()` produces the
 * readings worth trying and each is settled by TRAVERSAL — walking the
 * root to see which one is actually there. A file that matches no
 * reading is reported rather than imported under a guessed address.
 */
export async function pickAssetFolder(
  root: FileSystemDirectoryHandle | null,
): Promise<PickedAssets | null> {
  if (root === null) return null;

  const files = await new Promise<FileList | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.onchange = () => resolve(input.files);
    // A cancelled picker fires no change event in some builds; the
    // promise simply never settles, and the caller's busy flag is
    // cleared by the cancel handler below.
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (files === null || files.length === 0) return null;

  const candidates: ImportCandidate[] = [];
  const outsideRoot: string[] = [];

  for (const file of Array.from(files)) {
    const relative = file.webkitRelativePath === ""
      ? file.name : file.webkitRelativePath;
    let matched: string | null = null;
    for (const path of candidatePaths(relative, root.name)) {
      if (await fileAt(root, path) !== null) { matched = path; break; }
    }
    if (matched === null) {
      outsideRoot.push(relative);
      continue;
    }
    candidates.push({
      identifier: projectIdentifier(matched),
      name: file.name,
      sizeBytes: file.size,
      mtime: new Date(file.lastModified).toISOString(),
    });
  }

  return { candidates, outsideRoot };
}
