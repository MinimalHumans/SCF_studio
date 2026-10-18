// SPDX-License-Identifier: Apache-2.0
/**
 * fileAdapter.ts — the project's ASSET FOLDER, from the browser.
 *
 * Opening, creating and saving a `.scf` is the host's business now (the
 * file chooser is `projectChooser.ts`; the bytes never reach the page).
 * What only the browser can still supply is the folder a project's
 * assets live in: a directory handle, with the user's permission, read
 * and never written. A desktop shell would implement this interface
 * with plain paths.
 *
 * The folder is attached AFTER the file, in a second gesture, and the
 * adapter CHECKS that the two belong together: the folder must hold a
 * file with the project's name at its root. The platform cannot walk
 * from a file to its folder, and the host's path is not something a
 * directory handle can be compared with, so the name is the evidence —
 * enough to refuse the obvious mistake (another film's folder), not a
 * proof. `attachRoot` says so by returning the pairing it found.
 *
 * Nothing here writes to the filesystem (conventions §9): the root
 * handle is requested read-only.
 */

import { classifyRootPairing, type RootPairing }
  from "@scf-core/project.ts";

export type RootPermission = "granted" | "prompt" | "denied" | "none";

/**
 * What a grant is FOR. Only `read` is ever asked for now; the type
 * stays because remembered grants from earlier sessions carry the mode
 * they were made under, and querying a `read` grant for `readwrite`
 * reports "prompt" — a working folder would show as needing
 * reconnection forever.
 */
export type RootMode = "read" | "readwrite";

export interface AttachedRoot {
  root: FileSystemDirectoryHandle;
  permission: RootPermission;
  /**
   * Whether the folder holds the open file at its root — and whether
   * anything could check. Null when the session has no file name to
   * look for (a project not yet saved anywhere), so the pairing is the
   * user's assertion rather than a fact, and the caller must say so.
   */
  pairing: RootPairing | null;
}

export interface FileAdapter {
  /**
   * Pick the project's folder and check it holds `fileName` at its
   * root. Returns null if the user cancels. Read-only.
   */
  attachRoot(fileName: string | null): Promise<AttachedRoot | null>;
  /** Whether a remembered root still has a live grant, in the mode it
   *  was granted under. */
  rootPermission(root: unknown, mode: RootMode): Promise<RootPermission>;
  /** Re-ask for a remembered root. Must be called from a user gesture. */
  requestRootPermission(root: unknown,
                        mode: RootMode): Promise<RootPermission>;
}

function describe(e: unknown): string {
  if (e instanceof DOMException) return `${e.name}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Chromium File System Access implementation. */
export class FsAccessAdapter implements FileAdapter {
  static folderSupported(): boolean {
    return "showDirectoryPicker" in window;
  }

  /**
   * `id` makes Chromium remember where this particular picker was last
   * used, separately from every other picker in the app, so the usual
   * answer is one click on the folder already highlighted.
   *
   * Nothing is trusted afterwards: the folder is only accepted when a
   * file with the project's name is at its root. Looked up by name
   * rather than listed, so it answers on machines where listing a
   * folder returns nothing at all (conventions §9).
   */
  async attachRoot(fileName: string | null):
      Promise<AttachedRoot | null> {
    let root: FileSystemDirectoryHandle;
    try {
      root = await window.showDirectoryPicker(
        { mode: "read", id: "scf-project-root" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }

    const permission = await this.requestRootPermission(root, "read");

    // No name means nothing to look for — a manufactured pass would be a
    // lie, so the caller is told the folder was not checked.
    if (fileName === null) return { root, permission, pairing: null };

    let segments: string[] | null = null;
    try {
      await root.getFileHandle(fileName);
      segments = [fileName];
    } catch (e) {
      // NotFoundError is the answer "not here". Anything else is no
      // answer at all; both refuse the folder, because a wrong refusal
      // costs one more click and a wrong acceptance addresses every
      // asset in the project against the wrong place.
      segments = null;
      if (!(e instanceof DOMException && e.name === "NotFoundError")) {
        console.debug("[attachRoot] could not look for the file:",
                      describe(e));
      }
    }
    return { root, permission,
             pairing: classifyRootPairing(root.name, fileName, segments) };
  }

  async rootPermission(root: unknown, mode: RootMode):
      Promise<RootPermission> {
    // Queried in the mode the grant was ASKED for, which is why the
    // caller carries it.
    const handle = root as FileSystemDirectoryHandle | null;
    if (handle === null || typeof handle?.queryPermission !== "function") {
      return "none";
    }
    try {
      return await handle.queryPermission({ mode }) as RootPermission;
    } catch {
      return "none";
    }
  }

  /**
   * Chromium drops the grant on every reload, so this must run inside a
   * click. It is one prompt on reopen and it should not be suppressible:
   * it is the user's guarantee that a page cannot read their disk
   * unasked.
   */
  async requestRootPermission(root: unknown, mode: RootMode):
      Promise<RootPermission> {
    const handle = root as FileSystemDirectoryHandle | null;
    if (handle === null || typeof handle?.requestPermission !== "function") {
      return "none";
    }
    try {
      return await handle.requestPermission({ mode }) as RootPermission;
    } catch {
      return "denied";
    }
  }
}
