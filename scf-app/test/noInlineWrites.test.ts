// SPDX-License-Identifier: Apache-2.0
/**
 * noInlineWrites.test.ts — the app does not write SQL of its own.
 *
 * Every write to an .scf belongs in scf-core/src/ops so the MCP gets the
 * same rules as the editor. This pins that: a view or store that issues
 * INSERT/UPDATE/DELETE fails here, and the fix is a named op in core.
 *
 * The two files below are the remaining exceptions. They are tied to the
 * CodeMirror document and move when that code is split (see
 * docs/scf-write-ownership.md); take a file off this list when it goes,
 * never add one.
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const ALLOWED = new Set([
  "editor/features.ts",
  "editor/importPipeline.ts",
]);

const WRITE_SQL =
  /INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+[$\{\w".]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO/i;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []);
}

describe("the app issues no write SQL of its own", () => {
  test("only the listed files contain INSERT, UPDATE or DELETE", () => {
    const offenders = sources(SRC)
      .map((f) => relative(SRC, f).replaceAll("\\", "/"))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => WRITE_SQL.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the allowlist has no stale entries", () => {
    for (const f of ALLOWED) {
      expect(WRITE_SQL.test(readFileSync(join(SRC, f), "utf8")), f)
        .toBe(true);
    }
  });
});
