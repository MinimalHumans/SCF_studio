// SPDX-License-Identifier: Apache-2.0
/**
 * tauriPlatform.ts — the host core's platform (scf-host `platform.ts`)
 * in the desktop app's window.
 *
 * SQLite is the shell's (`tauriSql.ts`), files are the shell's commands
 * (`src-tauri/src/files.rs`), and paths are spelled for the OS the
 * shell reports. With this, the window runs the host core itself and
 * needs no host process.
 */

import { invoke } from "@tauri-apps/api/core";
import { posixPaths, windowsPaths } from "@scf-host/paths.ts";
import {
  toBase64, type HostPlatform, type PlatformDirEntry,
} from "@scf-host/platform.ts";
import { openTauriDatabase, openTauriSession } from "./tauriSql.ts";

export async function createTauriPlatform(): Promise<HostPlatform> {
  const windows = await invoke<boolean>("fs_windows");
  return {
    paths: windows ? windowsPaths : posixPaths,

    real: (path) => invoke<string>("fs_real", { path }),

    openSession: (path, registry) => openTauriSession(path, registry),
    openReader: (path) => openTauriDatabase(path, { readOnly: true }),

    exists: (path) => invoke<boolean>("fs_exists", { path }),
    readDir: (path) => invoke<PlatformDirEntry[]>("fs_read_dir", { path }),
    readText: (path) => invoke<string>("fs_read_text", { path }),
    appendText: (path, text) => invoke("fs_append_text", { path, text }),
    createFile: (path, bytes) =>
      invoke("fs_create_file", { path, bytes: toBase64(bytes) }),
    mkdir: (path) => invoke("fs_mkdir", { path }),
    remove: (path) => invoke("fs_remove", { path }),

    sha1: async (text) => {
      const digest = await crypto.subtle.digest(
        "SHA-1", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}
