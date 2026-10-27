// SPDX-License-Identifier: Apache-2.0
/**
 * dropIntake.ts — files dropped on a reference board, as project
 * addresses (file-management-plan.md Step 3).
 *
 * Conventions §9: SCF never copies, ingests or generates files. A drop
 * is therefore a way of POINTING: the shell's drag-and-drop event
 * (`nativeDrop.ts`) hands back real, absolute paths, and a path inside
 * the asset root becomes `@project/references/eleanor/front.png` with
 * nothing written to disk.
 *
 * A path from anywhere else cannot be pointed at — an address that only
 * resolves on this machine would not be portable — and is reported by
 * name so the writer can move it into the folder and drop it again.
 */

import type { HostPlatform } from "@scf-host/platform.ts";
import { createTauriPlatform } from "../host/tauriPlatform.ts";
import type { ImportCandidate } from "@scf-core/assetImport.ts";
import { candidateFor, isOutside } from "./pathIdentifier.ts";

export interface Intake {
  candidates: ImportCandidate[];
  /** Paths that are not inside the asset root, by name. */
  outside: string[];
  /** Dropped folders, which a board does not take. */
  folders: string[];
}

/** Whether `path` is a directory — probed by trying to read it as one,
 *  since the host has no dedicated "kind of entry" command for a
 *  single arbitrary path. */
async function isDirectory(
    platform: HostPlatform, path: string): Promise<boolean> {
  try {
    await platform.readDir(path);
    return true;
  } catch {
    return false;
  }
}

/** Address real, absolute paths — from a drop, or anywhere else the
 *  shell can hand them over — against the asset root. */
export async function addressPaths(
    assetRoot: string, paths: readonly string[]): Promise<Intake> {
  const platform = await createTauriPlatform();
  const intake: Intake = { candidates: [], outside: [], folders: [] };
  for (const path of paths) {
    const name = platform.paths.basename(path);
    if (await isDirectory(platform, path)) {
      intake.folders.push(name);
      continue;
    }
    const result = await candidateFor(platform, assetRoot, path);
    if (isOutside(result)) intake.outside.push(result.outside);
    else intake.candidates.push(result);
  }
  return intake;
}
