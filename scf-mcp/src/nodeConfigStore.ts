// SPDX-License-Identifier: Apache-2.0
/**
 * nodeConfigStore.ts — the Node-side AppConfigStore: a JSON file in the
 * OS-conventional per-user config directory.
 *
 * Directory resolution is overridable via SCF_CONFIG_DIR so a future
 * Tauri shell can resolve the directory once (with its own bundle
 * identifier, via @tauri-apps/api/path) and hand it to this spawned
 * subprocess, rather than have Node re-derive a path that has to agree
 * with Tauri's by coincidence. Standalone — today's deployment, no
 * Tauri involved — this falls back to hand-rolled OS convention; this
 * is the only place in the repo that needs it, so a package for a
 * dozen lines wasn't worth adding.
 *
 * `read` never throws: a missing or corrupt config file means "nothing
 * persisted yet," not a startup failure — recent-files history is a
 * convenience, and losing it is never worth refusing to serve queries.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_APP_CONFIG, type AppConfig, type AppConfigStore,
} from "./appConfig.ts";

const APP_DIR_NAME = "scf";

function defaultConfigDir(): string {
  if (process.env.SCF_CONFIG_DIR !== undefined) return process.env.SCF_CONFIG_DIR;

  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"),
                APP_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
              APP_DIR_NAME);
}

function isAppConfig(value: unknown): value is AppConfig {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as { recentFiles?: unknown }).recentFiles) &&
    (value as { recentFiles: unknown[] }).recentFiles
      .every((p) => typeof p === "string");
}

export function makeNodeConfigStore(
    configDir: string = defaultConfigDir()): AppConfigStore {
  const filePath = join(configDir, "config.json");

  return {
    async read(): Promise<AppConfig> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        return isAppConfig(parsed) ? parsed : EMPTY_APP_CONFIG;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          process.stderr.write(
            `[nodeConfigStore] could not read ${filePath}, starting ` +
            `empty: ${String(e)}\n`);
        }
        return EMPTY_APP_CONFIG;
      }
    },

    async write(config: AppConfig): Promise<void> {
      await mkdir(configDir, { recursive: true });
      await writeFile(
        filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    },
  };
}
