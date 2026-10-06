// SPDX-License-Identifier: Apache-2.0
/**
 * dropIntake.ts — files dropped on a reference board, as project
 * addresses.
 *
 * Conventions §9: SCF never copies, ingests or generates files. A drop
 * is therefore a way of POINTING: Chromium hands back a real handle for
 * a dropped file, the project root resolves it to a path, and that path
 * is the identifier. A file inside the project folder becomes
 * `@project/references/eleanor/front.png` with nothing written to disk.
 *
 * A file from anywhere else cannot be pointed at — the browser does not
 * reveal its location, and an address that only resolves on this
 * machine would not be portable anyway. It is reported by name so the
 * writer can move it into the folder and drop it again.
 */

import { projectIdentifier } from "@scf-core/assets.ts";
import type { ImportCandidate } from "@scf-core/assetImport.ts";

export interface Intake {
  candidates: ImportCandidate[];
  /** Files that are not inside the project folder, by name. */
  outside: string[];
  /** Dropped folders, which a board does not take. */
  folders: string[];
}

/**
 * Start reading a drop. MUST be called synchronously inside the drop
 * handler: the items are only valid during the event, so the handle
 * requests are made now and awaited later.
 */
export function beginDrop(dt: DataTransfer):
    Array<Promise<FileSystemHandle | null>> {
  const out: Array<Promise<FileSystemHandle | null>> = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    if (typeof item.getAsFileSystemHandle !== "function") continue;
    out.push(item.getAsFileSystemHandle().catch(() => null));
  }
  return out;
}

/** Where each handle sits under the root, if it does. */
export async function addressHandles(
    root: FileSystemDirectoryHandle,
    pending: Array<Promise<FileSystemHandle | null>>): Promise<Intake> {
  const intake: Intake = { candidates: [], outside: [], folders: [] };
  for (const h of await Promise.all(pending)) {
    if (h === null) continue;
    if (h.kind === "directory") { intake.folders.push(h.name); continue; }
    let segments: string[] | null = null;
    try { segments = await root.resolve(h); } catch { segments = null; }
    if (segments === null || segments.length === 0) {
      intake.outside.push(h.name);
      continue;
    }
    let sizeBytes: number | null = null;
    let mtime: string | null = null;
    try {
      const file = await (h as FileSystemFileHandle).getFile();
      sizeBytes = file.size;
      mtime = new Date(file.lastModified).toISOString();
    } catch { /* a hint, not a requirement */ }
    intake.candidates.push({ identifier: projectIdentifier(segments.join("/")),
                             name: h.name, sizeBytes, mtime });
  }
  return intake;
}
