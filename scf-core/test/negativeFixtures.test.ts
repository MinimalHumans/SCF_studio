/**
 * The negative fixtures. Spec §9, `conformance.md` §5.3.
 *
 * Hollow Creek proves SCF reads a well-formed file. These prove it says
 * the right thing about a broken one, which is the half of conformance
 * a fixture full of authored absences could never cover.
 *
 * The blessed reports are the contract. If one changes, either a
 * finding's wording moved (fine, re-bless) or its CODE or SEVERITY moved
 * (not fine — that is a change to spec §9.4's catalog and needs saying
 * out loud).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FINDING_CATALOG, type FindingCode } from "../src/findings.ts";
import { REPORT_FORMAT_VERSION, type ValidationReport }
  from "../src/report.ts";

interface Blessed extends ValidationReport { about: string }

const read = (name: string): Blessed =>
  JSON.parse(readFileSync(fileURLToPath(new URL(
    `../../fixtures/negative/${name}.expected.json`, import.meta.url)),
    "utf8")) as Blessed;

/**
 * The case → code map, stated HERE rather than read from the blessed
 * file. Reading it from the file would make this test tautological: it
 * would assert that the report says whatever the report says. This is
 * the intent, written down independently.
 */
const EXPECTED: Array<[string, FindingCode[]]> = [
  ["uuid-missing", ["identity.uuid_missing"]],
  ["uuid-malformed", ["identity.uuid_malformed"]],
  ["uuid-duplicate",
   ["identity.uuid_duplicate", "identity.unique_index_absent"]],
  ["relationship-endpoint-absent", ["relationship.endpoint_absent"]],
  ["relationship-contradictory", ["relationship.contradictory_pair"]],
  ["relationship-directionality-absent",
   ["relationship.directionality_absent"]],
  ["span-boundary-dangling", ["structure.boundary_dangling"]],
  ["asset-escapes-root",
   ["asset.identifier_escapes_root", "asset.orphan"]],
  ["asset-absolute", ["asset.identifier_absolute", "asset.orphan"]],
  ["unknown-table", ["extension.unknown_table"]],
  ["header-unstamped", ["header.application_id_absent"]],
];

describe.each(EXPECTED)("negative fixture: %s", (name, codes) => {
  const report = read(name);

  test("reports exactly the codes the case is about", () => {
    expect(report.findings.map((f) => f.code)).toEqual(codes);
  });

  test("severity matches the catalog", () => {
    for (const f of report.findings) {
      expect(f.severity).toBe(FINDING_CATALOG[f.code].severity);
    }
  });

  test("counts agree with the findings", () => {
    const total = report.counts.error + report.counts.warning +
      report.counts.info;
    expect(total).toBe(report.findings.length);
  });

  test("clean is true exactly when there are no errors", () => {
    expect(report.clean).toBe(report.counts.error === 0);
  });

  test("carries a sentence explaining what it demonstrates", () => {
    expect(report.about.length).toBeGreaterThan(20);
  });
});

describe("the negative set as a whole", () => {
  const all = EXPECTED.map(([name]) => read(name));

  test("every report declares the current report format", () => {
    for (const r of all) {
      expect(r.reportFormat).toBe(REPORT_FORMAT_VERSION);
    }
  });

  test("no report carries a timestamp", () => {
    // Blessed files must be diffable. A timestamp would make every
    // rebuild look like a change.
    for (const r of all) expect(r.generatedAt).toBeUndefined();
  });

  test("some case is clean and some case is not", () => {
    // The set is useless if everything in it fails, or nothing does:
    // the exit-code split is what a CI job actually consumes.
    expect(all.some((r) => r.clean)).toBe(true);
    expect(all.some((r) => !r.clean)).toBe(true);
  });

  test("the set exercises all three severities", () => {
    const seen = new Set(all.flatMap((r) => r.findings.map((f) => f.severity)));
    expect([...seen].sort()).toEqual(["error", "info", "warning"]);
  });
});
