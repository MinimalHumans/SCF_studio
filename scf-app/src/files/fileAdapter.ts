// SPDX-License-Identifier: Apache-2.0
/**
 * fileAdapter.ts — all file I/O goes through one adapter interface.
 *
 * The design doc's cheap insurance for the confirmed-future desktop
 * wrapper: `FileAdapter` with the File System Access implementation first
 * and a Tauri implementation later — packaging job, not refactor.
 * Chromium-only at launch is accepted.
 *
 * P2 of the assets plan makes a project a FOLDER, and there are two
 * orders in which to acquire one.
 *
 * `openProject()` is folder-first: one directory-picker gesture returns
 * the root handle, the `.scf` inside it, and its bytes. It costs one
 * gesture when the folder lists, and it has to work out which file was
 * meant.
 *
 * `openScf()` + `attachRoot()` is file-first: the user names the file,
 * then names its folder, and `resolve()` CHECKS that the two belong
 * together. It always costs two gestures and never guesses at anything.
 * `openScf()` alone is no longer a dead end — it is a session whose
 * root has not been attached yet, and every asset in it is
 * `unaddressed` until it is.
 *
 * Neither order can be skipped: the platform gives no route from a file
 * handle to its parent directory. That is also why the old
 * `siblingFileUrl()` never worked and has been removed — it was written
 * against a capability that does not exist.
 *
 * Nothing here writes to the filesystem beyond the .scf the user picked
 * (conventions §9): the root handle is requested read-only.
 */

import { chooseProjectFile, classifyRootPairing,
         type ProjectFinding, type RootPairing }
  from "@scf-core/project.ts";

export interface OpenedFile {
  name: string;
  bytes: ArrayBuffer;
  /** Opaque token the adapter uses to save back to the same place. */
  token: unknown;
}

export interface OpenedProject {
  /** The folder the user picked. */
  root: FileSystemDirectoryHandle;
  /** Root-level *.scf names, sorted. */
  candidates: string[];
  /** Every root-level file the scan saw — the finding's evidence. */
  seen: string[];
  /** What the scan actually did, for when the answer is surprising. */
  report: string[];
  /** Null when the folder holds zero or several projects. */
  file: OpenedFile | null;
  findings: ProjectFinding[];
}

export type RootPermission = "granted" | "prompt" | "denied" | "none";

/**
 * What a grant is FOR. The folder-first open needs `readwrite`, because
 * the file handle it saves through comes out of the root. The
 * file-first open does not: the write grant rides on the handle the
 * file picker returned, and the folder is only ever read. Asking for
 * the narrower one turns conventions §9's read-only rule from a
 * discipline in the code into an actual limit, and shows the user the
 * smaller of the two browser prompts.
 *
 * The mode has to be carried rather than assumed, because querying a
 * `read` grant for `readwrite` reports "prompt" — a folder that is
 * working perfectly would show as needing reconnection forever.
 */
export type RootMode = "read" | "readwrite";

export interface AttachedRoot {
  root: FileSystemDirectoryHandle;
  permission: RootPermission;
  /**
   * Whether the folder holds the open file at its root — and whether
   * anything could check. Null when the session has no file handle to
   * resolve against (the demo, an unsaved new project): there is no
   * file on disk for the folder to contain, so the pairing is the
   * user's assertion rather than a fact, and the caller must say so
   * rather than quietly presenting it as verified.
   */
  pairing: RootPairing | null;
}

export interface FileAdapter {
  /**
   * Pick a project FOLDER, scan its root, and read the one .scf in it.
   * Returns null if the user cancels. A folder with zero or several
   * .scf files comes back with `file: null` and findings — the caller
   * asks the user, and never guesses.
   */
  openProject(): Promise<OpenedProject | null>;
  /**
   * Attach a folder to a `.scf` that is already open, and report
   * whether the two belong together. Returns null if the user cancels.
   * Read-only: nothing on this path ever writes through the root.
   */
  attachRoot(file: unknown, fileName: string): Promise<AttachedRoot | null>;
  /** Read a named root-level file from an already-granted root. */
  readFromRoot(root: FileSystemDirectoryHandle,
               name: string): Promise<OpenedFile | null>;
  /** Whether a remembered root still has a live grant, in the mode it
   *  was granted under. */
  rootPermission(root: unknown, mode: RootMode): Promise<RootPermission>;
  /** Re-ask for a remembered root. Must be called from a user gesture. */
  requestRootPermission(root: unknown,
                        mode: RootMode): Promise<RootPermission>;
  /** Pick and read an .scf file. Returns null if the user cancels. */
  openScf(): Promise<OpenedFile | null>;
  /** Write bytes back to a previously opened file. */
  save(token: unknown, bytes: ArrayBuffer): Promise<void>;
  /** Pick a destination and write bytes. Returns the new token, or null. */
  saveAs(bytes: ArrayBuffer,
         suggestedName: string): Promise<{ name: string;
                                           token: unknown } | null>;
}

const SCF_TYPE: FilePickerAcceptType = {
  description: "SCF project",
  accept: { "application/x-sqlite3": [".scf"] },
};

/**
 * The root listing, with its own account of what happened.
 *
 * A folder that scans as empty and a folder that IS empty look
 * identical from the result alone, and two rounds of guessing at the
 * difference produced two wrong answers. So this returns a report
 * alongside the names: which iterator ran, how many raw entries it
 * yielded, what it threw, and which names failed the file test. The
 * report is shown to the user, because the machine cannot tell which of
 * these is the real story and the person in front of the folder can.
 */
interface ScanResult {
  files: string[];
  report: string[];
}

async function listRootFiles(
  root: FileSystemDirectoryHandle,
): Promise<ScanResult> {
  const report: string[] = [`folder: ${root.name}`];
  const names: string[] = [];

  if (typeof root.entries !== "function") {
    report.push("entries(): not available on this handle");
  } else {
    let raw = 0;
    try {
      for await (const [name, handle] of root.entries()) {
        raw += 1;
        // Only an explicit directory is excluded. A handle with a
        // missing or unexpected kind stays a candidate; getFileHandle
        // below is the real test.
        if (handle === undefined || handle.kind !== "directory") {
          names.push(name);
        }
      }
      report.push(`entries(): ${raw} entries, ${names.length} non-directory`);
    } catch (e) {
      report.push(`entries() threw after ${raw}: ${describe(e)}`);
    }
  }

  // Third attempt: iterate the handle itself. Chromium defines the
  // handle as async-iterable and aliases it to entries(), so this is
  // usually the same call — but it is a different code path, it costs
  // six lines, and two rounds of this have already proved that the
  // obvious explanation was not the true one.
  if (names.length === 0 && Symbol.asyncIterator in Object(root)) {
    try {
      let raw = 0;
      for await (const entry of root as unknown as
                 AsyncIterable<[string, FileSystemHandle]>) {
        raw += 1;
        const [name, handle] = entry;
        if (handle === undefined || handle.kind !== "directory") {
          names.push(name);
        }
      }
      report.push(`direct iteration: ${raw} entries`);
    } catch (e) {
      report.push(`direct iteration threw: ${describe(e)}`);
    }
  }

  if (names.length === 0) {
    if (typeof root.keys !== "function") {
      report.push("keys(): not available on this handle");
    } else {
      try {
        let raw = 0;
        for await (const name of root.keys()) { raw += 1; names.push(name); }
        report.push(`keys(): ${raw} names`);
      } catch (e) {
        report.push(`keys() threw: ${describe(e)}`);
      }
    }
  }

  // Root only, non-recursive: a .scf in a subfolder is a layer
  // candidate, not a project (conventions §9). Directories fail
  // getFileHandle, which is how they are excluded here.
  const files: string[] = [];
  const rejected: string[] = [];
  for (const name of names) {
    try {
      await root.getFileHandle(name);
      files.push(name);
    } catch (e) {
      rejected.push(`${name} (${describe(e)})`);
    }
  }
  if (rejected.length > 0) {
    report.push(`not readable as files: ${rejected.join("; ")}`);
  }
  return { files, report };
}

function describe(e: unknown): string {
  if (e instanceof DOMException) return `${e.name}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Chromium File System Access implementation. */
export class FsAccessAdapter implements FileAdapter {
  static supported(): boolean {
    return "showOpenFilePicker" in window;
  }

  static folderSupported(): boolean {
    return "showDirectoryPicker" in window;
  }

  async openProject(): Promise<OpenedProject | null> {
    let root: FileSystemDirectoryHandle;
    try {
      // readwrite, not read. SCF writes exactly one file — the .scf
      // itself — and the file handle comes out of this root, so a
      // read-only grant produces a project that cannot be saved. The
      // platform has no narrower unit than the folder, so the grant is
      // folder-wide and the read-only rule (conventions §9) stays a
      // discipline in the code rather than a sandbox around it.
      root = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }

    // Ask explicitly rather than trusting the picker's mode: a user who
    // is offered edit and grants view leaves the handle in a state
    // where iteration can fail, and the state is worth reporting either
    // way.
    const permission = await this.requestRootPermission(root, "readwrite");
    const scan = await listRootFiles(root);
    const pick = chooseProjectFile(scan.files);
    const file = pick.file === null
      ? null : await this.readFromRoot(root, pick.file);
    return { root, candidates: pick.candidates, seen: pick.seen, file,
             findings: pick.findings,
             report: [`folder permission: ${permission}`, ...scan.report] };
  }

  /**
   * The folder, asked for second.
   *
   * Two things make the extra gesture cheap. `startIn` opens the picker
   * inside the file's own directory, so the usual answer is one click
   * on the folder already highlighted; and `id` makes Chromium remember
   * where this particular picker was last used, separately from every
   * other picker in the app.
   *
   * `startIn` is passed defensively. It is the newest of the three
   * options here and the least load-bearing — losing it costs the user
   * some navigation, while a picker that rejects the whole options bag
   * would cost them the gesture. So a failure retries once, bare.
   *
   * Nothing is trusted afterwards. `resolve()` decides whether this
   * folder and this file belong together, and it traverses rather than
   * enumerates, so it answers on the machines where the root scan
   * returns nothing at all (conventions §9).
   */
  async attachRoot(file: unknown, fileName: string):
      Promise<AttachedRoot | null> {
    const handle = file as FileSystemFileHandle | null;
    const options: DirectoryPickerOptions =
      { mode: "read", id: "scf-project-root" };
    if (handle !== null && typeof handle?.getFile === "function") {
      options.startIn = handle;
    }

    let root: FileSystemDirectoryHandle;
    try {
      root = await window.showDirectoryPicker(options);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      if (options.startIn === undefined) throw e;
      try {
        root = await window.showDirectoryPicker(
          { mode: "read", id: "scf-project-root" });
      } catch (e2) {
        if (e2 instanceof DOMException && e2.name === "AbortError") {
          return null;
        }
        throw e2;
      }
    }

    const permission = await this.requestRootPermission(root, "read");

    // No file handle means nothing to resolve against — a demo or an
    // unsaved project has no bytes on disk for this folder to contain.
    // Null, not a manufactured pass: the caller has to decide what to
    // tell the user, and it is not the same thing as a check that
    // succeeded.
    if (handle === null || typeof handle?.getFile !== "function") {
      return { root, permission, pairing: null };
    }

    let segments: string[] | null = null;
    try {
      segments = await root.resolve(handle);
    } catch {
      // resolve() rejecting is not "not below" — it is no answer at
      // all. Both land on outside-root, which refuses the folder; a
      // wrong refusal costs one more click, a wrong acceptance
      // addresses every asset in the project against the wrong place.
      segments = null;
    }
    return { root, permission,
             pairing: classifyRootPairing(root.name, fileName, segments) };
  }

  async readFromRoot(root: FileSystemDirectoryHandle, name: string):
      Promise<OpenedFile | null> {
    try {
      const handle = await root.getFileHandle(name);
      const file = await handle.getFile();
      return { name: file.name, bytes: await file.arrayBuffer(),
               token: handle };
    } catch {
      return null;
    }
  }

  async rootPermission(root: unknown, mode: RootMode):
      Promise<RootPermission> {
    // Queried in the mode the grant was ASKED for, which is why the
    // caller carries it. Querying `read` on a readwrite session would
    // report "granted" for one that still cannot save; querying
    // `readwrite` on a read-only session reports "prompt" for one that
    // is working exactly as intended.
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

  async openScf(): Promise<OpenedFile | null> {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [SCF_TYPE],
        excludeAcceptAllOption: false,
      });
      if (handle === undefined) return null;
      const file = await handle.getFile();
      return { name: file.name, bytes: await file.arrayBuffer(),
               token: handle };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }

  async save(token: unknown, bytes: ArrayBuffer): Promise<void> {
    const handle = token as FileSystemFileHandle;
    let writable: FileSystemWritableFileStream;
    try {
      writable = await handle.createWritable();
    } catch {
      // Chromium: "state cached in an interface object ... changed
      // since it was read from disk" — the file was touched between
      // saves (cloud-sync clients love doing this). A fresh getFile()
      // re-reads the on-disk state; then retry once.
      await handle.getFile();
      writable = await handle.createWritable();
    }
    await writable.write(bytes);
    await writable.close();
  }

  async saveAs(bytes: ArrayBuffer, suggestedName: string):
      Promise<{ name: string; token: unknown } | null> {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName, types: [SCF_TYPE],
      });
      await this.save(handle, bytes);
      return { name: handle.name, token: handle };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }

}
