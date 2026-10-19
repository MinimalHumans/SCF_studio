// SPDX-License-Identifier: Apache-2.0
/**
 * platform.ts — what the MCP server needs from wherever it runs.
 *
 * The tools are the same everywhere; how they reach the host, the disk
 * and a log is not. In Node (`nodePlatform.ts`) the host is found or
 * started over its socket and files are Node's. In the desktop app the
 * server runs in the window, beside the host, and its client's working
 * directory is the stdio pipe's, not the window's.
 */

import type { FileLocator } from "@minimalhumans/scf-core";
import type { HostClient } from "@minimalhumans/scf-host/client";
import type { AppConfigStore } from "./appConfig.ts";
import type { RootMap } from "./config.ts";

export interface McpPlatform {
  /**
   * A new connection to the host, under `name` (how the host attributes
   * this connection's writes).
   */
  connect(name: string): Promise<HostClient>;
  /** `path` made absolute against the client's working directory. */
  resolve(path: string): string;
  /** Asset files under `roots`, whose paths are already absolute. */
  locator(roots: RootMap): FileLocator;
  /** Where the recent-files list is kept. */
  configStore: AppConfigStore;
  /** A config file's text (`--config`). */
  readText(path: string): Promise<string>;
  /** Something worth a line in the client's server log. */
  log(message: string): void;
}
