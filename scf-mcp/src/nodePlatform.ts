// SPDX-License-Identifier: Apache-2.0
/**
 * nodePlatform.ts — the MCP server's platform (platform.ts) in Node:
 * its own process, a client of the SCF host.
 *
 * Every `.scf` is opened by one host process; this server is one of its
 * clients, and finds it, or starts it, with scf-host's `ensureHost`. If
 * the editor is running, its host is the one found, so a film both are
 * looking at is one session with one write queue.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HostClientError } from "@minimalhumans/scf-host/client";
import {
  connectToEntry, ensureHost, type EnsureHostOptions,
} from "@minimalhumans/scf-host/node";
import type { AppConfigStore } from "./appConfig.ts";
import { makeNodeConfigStore } from "./nodeConfigStore.ts";
import { makeNodeLocator } from "./nodeLocator.ts";
import type { McpPlatform } from "./platform.ts";

export interface NodePlatformOptions {
  host?: EnsureHostOptions;
  configStore?: AppConfigStore;
}

export function makeNodePlatform(
    options: NodePlatformOptions = {}): McpPlatform {
  return {
    // One connection per tool call: a connection is the unit that holds
    // a film open, and a call must not leave one behind.
    connect: async (name) => {
      const entry = await ensureHost(options.host ?? {});
      try {
        return await connectToEntry(entry, { name });
      } catch (e) {
        if (e instanceof HostClientError) throw e;
        throw new Error(`could not connect to the SCF host: ${String(e)}`);
      }
    },
    resolve: (path) => resolve(path),
    locator: makeNodeLocator,
    configStore: options.configStore ?? makeNodeConfigStore(),
    readText: (path) => readFile(path, "utf8"),
    log: (message) => { process.stderr.write(`${message}\n`); },
  };
}
