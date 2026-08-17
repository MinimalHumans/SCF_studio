/**
 * The published artifacts of spec §9.4 and `conformance.md` §5.3.
 *
 * Both exist because an independent implementation could not perform two
 * of the three Reader conformance steps: the finding catalog was
 * normative and unpublished, and the negative fixtures were not
 * distributable. A published artifact that has drifted from the code is
 * worse than no artifact, because it looks authoritative — so both are
 * generated, and both are checked here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FINDING_CATALOG, type FindingCode } from "../src/findings.ts";
import { REPORT_FORMAT_VERSION } from "../src/report.ts";
import { registry } from "./setup.ts";

const read = (url: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(url, import.meta.url)),
                          "utf8"));

interface CatalogEntry {
  code: FindingCode; severity: string; title: string; spec: string;
}
const catalog = read("../../spec/finding-catalog.json") as {
  catalogVersion: string;
  schemaVersion: string;
  reportFormat: string;
  severities: Array<{ name: string; rank: number; meaning: string }>;
  ordering: string[];
  codeCount: number;
  codes: CatalogEntry[];
};

describe("the published finding catalog", () => {
  test("holds every code the implementation can raise", () => {
    expect(catalog.codes.map((c) => c.code))
      .toEqual((Object.keys(FINDING_CATALOG) as FindingCode[]).sort());
  });

  test("agrees with the implementation on severity and spec section",
       () => {
    for (const entry of catalog.codes) {
      const live = FINDING_CATALOG[entry.code];
      expect(live, entry.code).toBeDefined();
      expect(entry.severity, entry.code).toBe(live.severity);
      expect(entry.spec, entry.code).toBe(live.spec);
      expect(entry.title, entry.code).toBe(live.title);
    }
  });

  test("counts itself correctly", () => {
    expect(catalog.codeCount).toBe(catalog.codes.length);
  });

  test("declares the severity scale in rank order, with meanings", () => {
    expect(catalog.severities.map((s) => s.name))
      .toEqual(["error", "warning", "info"]);
    for (const s of catalog.severities) {
      expect(s.meaning.length).toBeGreaterThan(20);
    }
    // The §9.1 distinction has to survive into the published artifact:
    // `error` is about reader disagreement, never about refusing a file.
    expect(catalog.severities[0]?.meaning).toContain("Not a reason to refuse");
  });

  test("states the ordering, since a report must be diffable", () => {
    expect(catalog.ordering.length).toBe(4);
    expect(catalog.ordering[0]).toContain("severity");
  });

  test("records which schema and report format it belongs to", () => {
    expect(catalog.schemaVersion).toBe(registry.schemaVersion);
    expect(catalog.reportFormat).toBe(REPORT_FORMAT_VERSION);
  });
});

interface Case { name: string; about: string; statements: string[] }
const cases = read("../../fixtures/negative/CASES.json") as {
  schemaVersion: string; caseCount: number; cases: Case[];
};

describe("the published negative-fixture recipes", () => {
  test("cover every case", () => {
    expect(cases.caseCount).toBe(cases.cases.length);
    expect(cases.caseCount).toBe(11);
  });

  test("each case carries statements a third party could replay", () => {
    for (const c of cases.cases) {
      expect(c.statements.length, c.name).toBeGreaterThan(0);
      for (const stmt of c.statements) {
        // Every statement must be self-contained: parameters inlined as
        // a comment rather than left as bare `?` placeholders nobody
        // outside this process can fill.
        if (stmt.includes("?")) {
          expect(stmt, c.name).toContain("-- params:");
        }
      }
    }
  });

  test("each case pairs with a blessed report", () => {
    for (const c of cases.cases) {
      const blessed = read(
        `../../fixtures/negative/${c.name}.expected.json`) as {
          about: string; findings: unknown[];
        };
      expect(blessed.about, c.name).toBe(c.about);
    }
  });

  test("every code the negative set raises is in the published catalog",
       () => {
    // The point of the pair: a third party runs the recipes, gets
    // findings, and can look every code up in a file they also have.
    const published = new Set(catalog.codes.map((c) => c.code));
    for (const c of cases.cases) {
      const blessed = read(
        `../../fixtures/negative/${c.name}.expected.json`) as {
          findings: Array<{ code: string }>;
        };
      for (const f of blessed.findings) {
        expect(published.has(f.code as FindingCode), `${c.name}: ${f.code}`)
          .toBe(true);
      }
    }
  });
});
