// SPDX-License-Identifier: Apache-2.0
/**
 * windowAuditStore.ts — `audit.db` (scf-host `auditStore.ts`) opened in
 * the window, beside `app.db` in the app data folder: the shell's SQL
 * commands for the database, its file commands for corruption recovery.
 * The standalone MCP uses scf-host's `nodeAuditStore.ts` on the same
 * file.
 */

import { invoke } from "@tauri-apps/api/core";
import { openAuditStore, type AuditStore } from "@scf-host/auditStore.ts";
import { createTauriPlatform } from "./tauriPlatform.ts";
import { openTauriDatabase } from "./tauriSql.ts";

let store: Promise<AuditStore> | null = null;

export function windowAuditStore(): Promise<AuditStore> {
  store ??= (async () => {
    const files = await createTauriPlatform();
    const { dataDir } = await invoke<{ dataDir: string }>("host_setup");
    return openAuditStore(
      files.paths.join(dataDir, "audit.db"),
      (p) => openTauriDatabase(p),
      {
        exists: (p) => invoke<boolean>("fs_exists", { path: p }),
        remove: (p) => invoke("fs_remove", { path: p }),
        rename: (from, to) => invoke("fs_rename", { from, to }),
      });
  })();
  // A failed open is tried again by the next caller.
  store.catch(() => { store = null; });
  return store;
}
