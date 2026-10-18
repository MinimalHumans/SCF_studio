// SPDX-License-Identifier: Apache-2.0
/**
 * noInlineWrites.test.ts — the app does not write SQL of its own.
 *
 * Every write to an .scf belongs in scf-core/src/ops so the MCP gets the
 * same rules as the editor. This pins that: a view or store that issues
 * INSERT/UPDATE/DELETE fails here, and the fix is a named op in core.
 *
 * There are no exceptions. If one is ever unavoidable, name the file in
 * ALLOWED with the reason beside it.
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const ALLOWED = new Set<string>();

const WRITE_SQL =
  /INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+[$\{\}\w".()]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO/i;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []);
}

describe("the app issues no write SQL of its own", () => {
  test("no source file contains INSERT, UPDATE or DELETE", () => {
    const offenders = sources(SRC)
      .map((f) => relative(SRC, f).replaceAll("\\", "/"))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => WRITE_SQL.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

/**
 * The window does not hold a write function either. Everything in
 * scf-core's call table runs on the host (or, until the cutover, through
 * `call` in state/api.ts), so importing one of those functions directly
 * is a write that bypasses the table. Reads from the same modules are
 * unaffected: only the names the table wraps are listed here.
 */
const CALLS_SRC = fileURLToPath(new URL(
  "../../scf-core/src/ops/calls.ts", import.meta.url));

/** Functions the table wraps, plus the ones its wrappers are built from. */
function tableFunctions(): Set<string> {
  const text = readFileSync(CALLS_SRC, "utf8");
  const names = new Set<string>();
  for (const m of text.matchAll(/with(?:Exec|Ctx)\(\s*(?:\w+\.)?(\w+)\)/g)) {
    names.add(m[1]!);
  }
  for (const n of ["moveShot", "applyImport", "linkAndCreateAtCommit",
                   "writeScreenplay", "applyUndoChange", "withTransaction"]) {
    names.add(n);
  }
  return names;
}

function importedNames(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"(@scf-core\/[^"]+)"/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim();
      if (name === "" || name.startsWith("type ")) continue;
      out.push(name.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return out;
}

describe("the window imports no write function", () => {
  test("nothing in the call table is imported by a source file", () => {
    const writers = tableFunctions();
    expect(writers.size).toBeGreaterThan(50);   // the parse found the table
    const offenders = sources(SRC).flatMap((f) =>
      importedNames(readFileSync(f, "utf8"))
        .filter((n) => writers.has(n))
        .map((n) => `${relative(SRC, f).replaceAll("\\", "/")}: ${n}`));
    expect(offenders).toEqual([]);
  });
});
