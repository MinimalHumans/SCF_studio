// SPDX-License-Identifier: Apache-2.0
/**
 * appConfig.ts — the shape of app-level config `scf-mcp` persists: for
 * now, just the recent-files list.
 *
 * Deliberately scf-mcp-local for now, not scf-core: `scf-app` (the
 * editor) will eventually want the same shape, but it's still a plain
 * browser app with no filesystem access, and the real shared home for
 * this — once there's a Tauri desktop shell wrapping both — isn't
 * decided yet. Putting it in scf-core now would mean guessing at that
 * shape twice. When the desktop build exists, this module (and
 * nodeConfigStore.ts's AppConfigStore split) is what moves, unchanged
 * in shape, to wherever both sides can reach it.
 *
 * This module defines the CONTRACT only — no I/O. `nodeConfigStore.ts`
 * is the one AppConfigStore implementation that exists today.
 */

export interface AppConfig {
  /** Absolute paths, most recently opened first. */
  recentFiles: string[];
}

export const EMPTY_APP_CONFIG: AppConfig = { recentFiles: [] };

const RECENT_FILES_MAX = 20;

/**
 * `config` with `path` moved to the front of `recentFiles`, deduped and
 * capped. Pure — callers persist the result through their own
 * AppConfigStore.
 */
export function withRecentFile(config: AppConfig, path: string): AppConfig {
  const recentFiles = [path, ...config.recentFiles.filter((p) => p !== path)]
    .slice(0, RECENT_FILES_MAX);
  return { ...config, recentFiles };
}

/**
 * Reads and writes an AppConfig however the caller's environment allows
 * — a JSON file in an OS config directory today; browser storage or a
 * Tauri store are other shapes this could take later. `read` never
 * throws: a missing or corrupt config is a normal, recoverable state
 * (nothing configured yet), not a startup failure.
 */
export interface AppConfigStore {
  read(): Promise<AppConfig>;
  write(config: AppConfig): Promise<void>;
}
