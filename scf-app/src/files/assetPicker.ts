// SPDX-License-Identifier: Apache-2.0
/**
 * assetPicker.ts — picking existing files to point at, through the
 * shell's own dialogs (file-management-plan.md Step 3).
 */

import { open } from "@tauri-apps/plugin-dialog";
import type { ImportCandidate } from "@scf-core/assetImport.ts";
import { createTauriPlatform } from "../host/tauriPlatform.ts";
import { candidateFor, isOutside } from "./pathIdentifier.ts";

export interface PickedAssets {
  candidates: ImportCandidate[];
  /** Files the user picked from outside the asset root. They are not
   *  imported: an identifier that cannot be expressed relative to the
   *  root would have to be absolute, and an import that silently
   *  produced a non-portable address would undo the point of
   *  conventions §9. */
  outsideRoot: string[];
}

function sort(results: Awaited<ReturnType<typeof candidateFor>>[]):
    PickedAssets {
  return {
    candidates: results.filter((r): r is ImportCandidate => !isOutside(r)),
    outsideRoot: results.filter(isOutside).map((r) => r.outside),
  };
}

/** Let the user multi-select files, and address them against the root. */
export async function pickAssetFiles(
  assetRoot: string | null,
): Promise<PickedAssets | null> {
  if (assetRoot === null) return null;
  const picked = await open({ multiple: true, directory: false });
  if (picked === null) return null;
  const paths = Array.isArray(picked) ? picked : [picked];
  const platform = await createTauriPlatform();
  return sort(await Promise.all(
    paths.map((p) => candidateFor(platform, assetRoot, p))));
}

/**
 * Every file under a picked folder, for a project's worth in one
 * gesture rather than a file at a time. Walks subfolders; anything
 * outside the asset root (should the user pick a folder elsewhere) is
 * reported rather than imported under a guessed address.
 */
export async function pickAssetFolder(
  assetRoot: string | null,
): Promise<PickedAssets | null> {
  if (assetRoot === null) return null;
  const picked = await open({ multiple: false, directory: true });
  if (picked === null) return null;
  const platform = await createTauriPlatform();

  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await platform.readDir(dir)) {
      const full = platform.paths.join(dir, entry.name);
      if (entry.kind === "dir") await walk(full);
      else if (entry.kind === "file") files.push(full);
    }
  };
  await walk(picked);

  return sort(await Promise.all(
    files.map((p) => candidateFor(platform, assetRoot, p))));
}
