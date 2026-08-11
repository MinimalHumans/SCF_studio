/**
 * fileAdapter.ts — all file I/O goes through one adapter interface.
 *
 * The design doc's cheap insurance for the confirmed-future desktop
 * wrapper: `FileAdapter` with the File System Access implementation first
 * and a Tauri implementation later — packaging job, not refactor.
 * Chromium-only at launch is accepted.
 *
 * P2 of the assets plan makes a project a FOLDER. `openProject()` takes
 * one directory-picker gesture and returns the root handle, the `.scf`
 * inside it, and its bytes. `openScf()` stays for the degraded
 * single-file path: it opens fine, and every asset in it is `missing`,
 * because the platform gives no route from a file handle to its parent
 * directory. That is also why the old `siblingFileUrl()` never worked
 * and has been removed — it was written against a capability that does
 * not exist.
 *
 * Nothing here writes to the filesystem beyond the .scf the user picked
 * (conventions §9): the root handle is requested read-only.
 */

import { chooseProjectFile, type ProjectFinding }
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

export interface FileAdapter {
  /**
   * Pick a project FOLDER, scan its root, and read the one .scf in it.
   * Returns null if the user cancels. A folder with zero or several
   * .scf files comes back with `file: null` and findings — the caller
   * asks the user, and never guesses.
   */
  openProject(): Promise<OpenedProject | null>;
  /** Read a named root-level file from an already-granted root. */
  readFromRoot(root: FileSystemDirectoryHandle,
               name: string): Promise<OpenedFile | null>;
  /** Whether a remembered root still has a live read grant. */
  rootPermission(root: unknown): Promise<RootPermission>;
  /** Re-ask for a remembered root. Must be called from a user gesture. */
  requestRootPermission(root: unknown): Promise<RootPermission>;
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
    const permission = await this.requestRootPermission(root);
    const scan = await listRootFiles(root);
    const pick = chooseProjectFile(scan.files);
    const file = pick.file === null
      ? null : await this.readFromRoot(root, pick.file);
    return { root, candidates: pick.candidates, seen: pick.seen, file,
             findings: pick.findings,
             report: [`folder permission: ${permission}`, ...scan.report] };
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

  async rootPermission(root: unknown): Promise<RootPermission> {
    // readwrite to match the grant openProject asks for; querying read
    // on a readwrite handle would report "granted" for a session that
    // still cannot save.
    const handle = root as FileSystemDirectoryHandle | null;
    if (handle === null || typeof handle?.queryPermission !== "function") {
      return "none";
    }
    try {
      return await handle.queryPermission({ mode: "readwrite" }) as
        RootPermission;
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
  async requestRootPermission(root: unknown): Promise<RootPermission> {
    const handle = root as FileSystemDirectoryHandle | null;
    if (handle === null || typeof handle?.requestPermission !== "function") {
      return "none";
    }
    try {
      return await handle.requestPermission({ mode: "readwrite" }) as
        RootPermission;
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
