/**
 * fileAdapter.ts — all file I/O goes through one adapter interface.
 *
 * The design doc's cheap insurance for the confirmed-future desktop
 * wrapper: `FileAdapter` (open/save/list/sibling-dir) with the File System
 * Access implementation first and a Tauri implementation later — packaging
 * job, not refactor. Chromium-only at launch is accepted.
 */

export interface OpenedFile {
  name: string;
  bytes: ArrayBuffer;
  /** Opaque token the adapter uses to save back to the same place. */
  token: unknown;
}

export interface FileAdapter {
  /** Pick and read an .scf file. Returns null if the user cancels. */
  openScf(): Promise<OpenedFile | null>;
  /** Write bytes back to a previously opened file. */
  save(token: unknown, bytes: ArrayBuffer): Promise<void>;
  /** Pick a destination and write bytes. Returns the new token, or null. */
  saveAs(bytes: ArrayBuffer,
         suggestedName: string): Promise<{ name: string;
                                           token: unknown } | null>;
  /**
   * Resolve a relative asset path against the project's sibling directory
   * (the documented reference-image convention; unused until assets
   * return). Absolute URIs pass through untouched at the call site.
   */
  siblingFileUrl(relativePath: string): Promise<string | null>;
}

const SCF_TYPE: FilePickerAcceptType = {
  description: "SCF project",
  accept: { "application/x-sqlite3": [".scf"] },
};

/** Chromium File System Access implementation. */
export class FsAccessAdapter implements FileAdapter {
  #siblingDir: FileSystemDirectoryHandle | null = null;

  static supported(): boolean {
    return "showOpenFilePicker" in window;
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

  async siblingFileUrl(relativePath: string): Promise<string | null> {
    if (this.#siblingDir === null) return null;
    try {
      const parts = relativePath.split("/").filter((p) => p !== "");
      let dir = this.#siblingDir;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part);
      }
      const last = parts[parts.length - 1];
      if (last === undefined) return null;
      const file = await (await dir.getFileHandle(last)).getFile();
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }
}
