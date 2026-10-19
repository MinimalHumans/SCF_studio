// SPDX-License-Identifier: Apache-2.0
/**
 * nodeConfigStore.ts — the Node-side AppConfigStore, for the tests: a
 * JSON file in the folder it is given.
 *
 * `read` never throws: a missing or corrupt config file means "nothing
 * persisted yet," not a startup failure — recent-files history is a
 * convenience, and losing it is never worth refusing to serve queries.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EMPTY_APP_CONFIG, type AppConfig, type AppConfigStore,
} from "./appConfig.ts";

function isAppConfig(value: unknown): value is AppConfig {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as { recentFiles?: unknown }).recentFiles) &&
    (value as { recentFiles: unknown[] }).recentFiles
      .every((p) => typeof p === "string");
}

export function makeNodeConfigStore(configDir: string): AppConfigStore {
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
