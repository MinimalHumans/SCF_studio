// SPDX-License-Identifier: Apache-2.0
/**
 * node.ts — Node driver for scf-core's SqlExec seam.
 *
 * Wraps node:sqlite (built into Node >= 22) in the async SqlExec interface.
 * This is what conformance CI, scripts, and the future MCP server use; the
 * browser app supplies a wa-sqlite/OPFS implementation of the same seam.
 * Kept in its own module so browser bundles never import node:sqlite.
 */

import { createRequire } from "node:module";
import type { Row, SqlExec, SqlValue } from "./db.ts";

// node:sqlite is loaded dynamically (not a static import) because Vite's
// builtin-module list predates it; static imports fail under vitest.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      run: (...params: unknown[]) => unknown;
    };
    close: () => void;
  };
};

export interface NodeDatabase {
  exec: SqlExec;
  close: () => void;
}

/** Statements that return rows go through .all(); everything else .run(). */
function isReader(sql: string): boolean {
  const head = sql.trimStart().slice(0, 10).toUpperCase();
  return head.startsWith("SELECT") || head.startsWith("PRAGMA") ||
         head.startsWith("WITH") ||
         / RETURNING /i.test(sql);
}

function coerce(v: SqlValue): string | number | null | Uint8Array {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export function openNodeDatabase(
    path: string, options: { readOnly?: boolean } = {}): NodeDatabase {
  const db = new DatabaseSync(path, {
    readOnly: options.readOnly ?? false,
  });
  // async so that driver errors surface as rejections, never synchronous
  // throws — callers of the SqlExec seam must be able to rely on that.
  const exec: SqlExec = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    const args = params.map(coerce);
    if (isReader(sql)) {
      return stmt.all(...args) as Row[];
    }
    stmt.run(...args);
    return [];
  };
  return { exec, close: () => db.close() };
}
