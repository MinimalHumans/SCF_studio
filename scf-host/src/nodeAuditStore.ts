// SPDX-License-Identifier: Apache-2.0
/**
 * nodeAuditStore.ts — `audit.db` (auditStore.ts) opened on Node, the way
 * nodeAppStore.ts opens `app.db`: what the standalone MCP and these
 * packages' tests use. The window opens it over the shell's SQL commands.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import { openAuditStore, type AuditStore } from "./auditStore.ts";

export function openNodeAuditStore(path: string): Promise<AuditStore> {
  mkdirSync(dirname(path), { recursive: true });
  let closed = false;
  return openAuditStore(
    path,
    (p) => {
      const db = openNodeDatabase(p);
      return Promise.resolve({
        exec: db.exec,
        close: () => {
          if (!closed) db.close();
          closed = true;
          return Promise.resolve();
        },
      });
    },
    {
      exists: (p) => Promise.resolve(existsSync(p)),
      remove: (p) => { rmSync(p, { force: true }); return Promise.resolve(); },
      rename: (from, to) => { renameSync(from, to); return Promise.resolve(); },
    });
}
