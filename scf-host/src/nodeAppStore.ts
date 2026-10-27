// SPDX-License-Identifier: Apache-2.0
/**
 * nodeAppStore.ts — `app.db` (appStore.ts) opened on Node: scf-core's
 * node:sqlite driver, and node:fs for corruption recovery. What the
 * standalone MCP (and these packages' own tests) use; the window
 * supplies a Tauri-backed opener instead (`scf-app`
 * `src/mcp/windowMcp.ts`).
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import {
  openAppStore, type AppStore, type OpenAppStoreOptions,
} from "./appStore.ts";

export function openNodeAppStore(
    path: string,
    options: Partial<OpenAppStoreOptions> = {}): Promise<AppStore> {
  mkdirSync(dirname(path), { recursive: true });
  return openAppStore(
    path,
    (p) => {
      const db = openNodeDatabase(p);
      return Promise.resolve({
        exec: db.exec,
        close: () => { db.close(); return Promise.resolve(); },
      });
    },
    {
      exists: (p) => Promise.resolve(existsSync(p)),
      remove: (p) => { rmSync(p, { force: true }); return Promise.resolve(); },
      rename: (from, to) => { renameSync(from, to); return Promise.resolve(); },
    },
    {
      caseInsensitiveKeys:
        options.caseInsensitiveKeys ?? process.platform === "win32",
      importLegacyRecentFiles: options.importLegacyRecentFiles,
    });
}
