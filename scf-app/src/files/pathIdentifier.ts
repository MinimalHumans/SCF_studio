// SPDX-License-Identifier: Apache-2.0
/**
 * pathIdentifier.ts — an absolute path, addressed against the asset
 * root: the shared arithmetic behind both picking files through a
 * dialog (assetPicker.ts) and pointing at a dropped one
 * (dropIntake.ts). A real path from the shell needs no traversal to
 * address — just strip the asset root's prefix.
 */

import { projectIdentifier } from "@scf-core/assets.ts";
import type { ImportCandidate } from "@scf-core/assetImport.ts";
import type { HostPlatform } from "@scf-host/platform.ts";

export interface Outside { outside: string }

/** `path`'s spelling below `assetRoot`, or null when it is not there. */
export function relativeToRoot(
    platform: HostPlatform, assetRoot: string, path: string): string | null {
  if (!platform.paths.within(assetRoot, path)) return null;
  return path.slice(assetRoot.length).replace(/^[/\\]+/, "");
}

/**
 * `path` as an `ImportCandidate` if it is under `assetRoot`, or the
 * name to report it under (`Outside`) if it is not. Does not care
 * whether `path` is a file or a folder — callers decide what to do
 * with a folder before reaching here.
 */
export async function candidateFor(
    platform: HostPlatform, assetRoot: string, path: string,
): Promise<ImportCandidate | Outside> {
  const name = platform.paths.basename(path);
  const rel = relativeToRoot(platform, assetRoot, path);
  if (rel === null) return { outside: name };
  const stat = await platform.stat(path);
  return {
    identifier: projectIdentifier(rel), name,
    sizeBytes: stat?.size ?? null,
    mtime: stat === null ? null : stat.modified,
  };
}

export function isOutside(c: ImportCandidate | Outside): c is Outside {
  return "outside" in c;
}
