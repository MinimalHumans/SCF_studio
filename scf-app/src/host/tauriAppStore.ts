// SPDX-License-Identifier: Apache-2.0
/**
 * tauriAppStore.ts — `app.db` (scf-host `appStore.ts`) opened in the
 * window: the shell's SQL commands (`tauriSql.ts`) for the database
 * itself, and its file commands for corruption recovery. The standalone
 * MCP uses scf-host's `nodeAppStore.ts` instead.
 *
 * `path`'s folder must already exist — the shell's `data_dir`
 * (`host_setup`) does, since `lib.rs` creates it on startup for its own
 * discovery file.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  openAppStore, type AppStore, type OpenAppStoreOptions,
} from "@scf-host/appStore.ts";
import { openTauriDatabase } from "./tauriSql.ts";

export async function openTauriAppStore(
    path: string,
    options: Partial<OpenAppStoreOptions> = {}): Promise<AppStore> {
  const windows = await invoke<boolean>("fs_windows");
  return openAppStore(
    path,
    (p) => openTauriDatabase(p),
    {
      exists: (p) => invoke<boolean>("fs_exists", { path: p }),
      remove: (p) => invoke("fs_remove", { path: p }),
      rename: (from, to) => invoke("fs_rename", { from, to }),
    },
    {
      caseInsensitiveKeys: options.caseInsensitiveKeys ?? windows,
      importLegacyRecentFiles: options.importLegacyRecentFiles,
    });
}
