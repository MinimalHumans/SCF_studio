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

import { PROJECT_ROOT, type FileLocator, type LocatedFile }
  from "@scf-core/assets.ts";

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

/** An object URL for a resolved asset, or null. Caller revokes it. */
export async function assetObjectUrl(
  root: FileSystemDirectoryHandle | null, path: string,
): Promise<string | null> {
  if (root === null) return null;
  const parts = path.split("/").filter((p) => p !== "");
  const last = parts.pop();
  if (last === undefined) return null;
  try {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const file = await (await dir.getFileHandle(last)).getFile();
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}
