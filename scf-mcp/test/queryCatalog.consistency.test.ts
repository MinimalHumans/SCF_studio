// SPDX-License-Identifier: Apache-2.0
/**
 * queryCatalog.consistency.test.ts — queryTools.ts's CATALOG must not
 * drift from spec/query-reference.md.
 *
 * query-reference.md is itself generated from spec/scf-spec.md §12 and
 * fixtures/expectations/*.result.json (scf-core/scripts/
 * emit_query_reference.mjs) and kept honest by `check-query-reference`
 * in CI. CATALOG copies the same id/title/section/summary/params by
 * hand, as a Zod schema the generator has no way to produce — that copy
 * is exactly the kind of fact a later spec edit forgets to carry
 * forward. This test is the check that makes the forgetting visible:
 * it parses the same generated table and fails the moment the two
 * disagree, rather than leaving CATALOG to say something the spec no
 * longer does.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CATALOG, toolNameFor } from "../src/queryTools.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = join(HERE, "..", "..", "spec", "query-reference.md");

interface ReferenceRow {
  section: string;
  id: string;
  title: string;
  summary: string;
  params: string[];
}

/** The "At a glance" table — one row per query, §, id, title, and all. */
function parseReference(): ReferenceRow[] {
  const text = readFileSync(REFERENCE, "utf8");
  const rowRe =
    /^\| (12\.\d+) \| \*\*(Q\d\d)\*\* (.+?) \| (.+?) \| (.+?) \|$/gm;
  const rows: ReferenceRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const [, section, id, title, summary, takes] = m as unknown as
      [string, string, string, string, string, string];
    const params = takes === "*no parameters*"
      ? [] : takes.split(", ").map((p) => p.replace(/`/g, ""));
    rows.push({ section: `§${section}`, id, title, summary, params });
  }
  return rows;
}

describe("queryTools CATALOG vs. the generated spec/query-reference.md",
    () => {
  const reference = parseReference();

  test("the reference table parses as all 16 queries (sanity check on " +
      "this test's own regex, not on the spec)", () => {
    expect(reference.length).toBe(16);
  });

  test("every CATALOG entry's id/title/section/summary matches its " +
      "reference row", () => {
    for (const spec of CATALOG) {
      const row = reference.find((r) => r.id === spec.id);
      expect(row, `${spec.id} has no row in query-reference.md`)
        .toBeDefined();
      expect([spec.id, spec.title, spec.section, spec.summary]).toEqual(
        [row?.id, row?.title, row?.section, row?.summary]);
    }
  });

  test("every CATALOG entry's param names match its reference row's, " +
      "order aside", () => {
    for (const spec of CATALOG) {
      const row = reference.find((r) => r.id === spec.id);
      expect(Object.keys(spec.shape).sort())
        .toEqual([...(row?.params ?? [])].sort());
    }
  });

  test("CATALOG covers every reference row except Q14 (that's " +
      "`readiness`, registered separately in server.ts)", () => {
    const catalogIds = new Set(CATALOG.map((s) => s.id));
    const referenceIds = reference.map((r) => r.id);
    expect(referenceIds.filter((id) => id !== "Q14").sort())
      .toEqual([...catalogIds].sort());
  });

  test("derived tool names are unique — no two titles collide once " +
      "slugified", () => {
    const names = CATALOG.map((s) => toolNameFor(s.title));
    expect(new Set(names).size).toBe(names.length);
  });
});
