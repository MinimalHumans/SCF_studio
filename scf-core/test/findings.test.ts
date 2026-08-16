/**
 * Spec §9.5 — the finding vocabulary.
 *
 * Two things are being pinned. The catalog's integrity, because a code
 * with no spec reference or a severity assigned twice is how a
 * vocabulary rots. And DETERMINISM, because the whole point of codes is
 * that a validator's output can be diffed — between two runs, between
 * two versions, eventually between two implementations. A report that
 * reorders itself is not a report.
 */
import { afterEach, beforeAll, afterAll, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import {
  FINDING_CATALOG, FINDING_SEVERITY_RANK, collectFindings, sortFindings,
  type Finding, type FindingCode,
} from "../src/findings.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

let fixture: Fixture;

beforeAll(() => { fixture = openFixture(); });
afterAll(() => { fixture.close(); });

let scratch: NodeDatabase | null = null;
afterEach(() => { scratch?.close(); scratch = null; });

const fresh = async (): Promise<NodeDatabase> => {
  const d = openNodeDatabase(":memory:");
  await initDatabase(d.exec, registry);
  return d;
};

describe("the catalog", () => {
  const codes = Object.keys(FINDING_CATALOG) as FindingCode[];

  test("every code names the specification section it comes from", () => {
    const missing = codes.filter(
      (c) => !/^§[0-9]+(\.[0-9]+)*$/.test(FINDING_CATALOG[c].spec));
    expect(missing).toEqual([]);
  });

  test("every code carries a severity the scale defines", () => {
    for (const c of codes) {
      expect(FINDING_SEVERITY_RANK[FINDING_CATALOG[c].severity])
        .toBeTypeOf("number");
    }
  });

  test("codes are dotted area.condition, lower snake case", () => {
    const bad = codes.filter((c) => !/^[a-z]+\.[a-z0-9_]+$/.test(c));
    expect(bad).toEqual([]);
  });

  test("titles are one line and not empty", () => {
    for (const c of codes) {
      expect(FINDING_CATALOG[c].title).not.toBe("");
      expect(FINDING_CATALOG[c].title).not.toContain("\n");
    }
  });

  test("nothing at error severity is merely informational", () => {
    // A guard against severity drift: if `error` ever comes to mean
    // "worth mentioning", the scale has stopped carrying information.
    const errors = codes.filter(
      (c) => FINDING_CATALOG[c].severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThan(codes.length / 2);
  });
});

describe("ordering is deterministic", () => {
  const f = (code: FindingCode, table: string | null,
             rowIds: number[]): Finding => ({
    code,
    severity: FINDING_CATALOG[code].severity,
    table, rowIds, message: "", count: 1,
  });

  test("errors first, then warnings, then info", () => {
    const sorted = sortFindings([
      f("asset.orphan", "asset", [1]),
      f("identity.uuid_missing", "scene", [1]),
      f("relationship.duplicate_pair", "character_relationship", [1]),
    ]);
    expect(sorted.map((x) => x.severity))
      .toEqual(["error", "warning", "info"]);
  });

  test("ties break by code, then table, then first row id", () => {
    const sorted = sortFindings([
      f("identity.uuid_missing", "scene", [9]),
      f("identity.uuid_missing", "scene", [2]),
      f("identity.uuid_missing", "act", [5]),
      f("identity.uuid_duplicate", "scene", [1]),
    ]);
    expect(sorted.map((x) => [x.code, x.table, x.rowIds[0]])).toEqual([
      ["identity.uuid_duplicate", "scene", 1],
      ["identity.uuid_missing", "act", 5],
      ["identity.uuid_missing", "scene", 2],
      ["identity.uuid_missing", "scene", 9],
    ]);
  });

  test("sorting does not mutate its input", () => {
    const input = [
      f("asset.orphan", "asset", [1]),
      f("identity.uuid_missing", "scene", [1]),
    ];
    const before = input.map((x) => x.code);
    sortFindings(input);
    expect(input.map((x) => x.code)).toEqual(before);
  });
});

describe("collectFindings on the conformance fixture", () => {
  test("reports no errors", async () => {
    // The fixture contains authored ABSENCES, not authored errors —
    // spec/conformance.md §5.3. If this ever fails, either the fixture
    // has been damaged or a finding has been given the wrong severity.
    const report = await collectFindings(fixture.ctx.exec, registry);
    const errors = report.findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => `${f.code} ${f.message}`)).toEqual([]);
    expect(report.clean).toBe(true);
  });

  test("reports the fixture's schema version", async () => {
    const report = await collectFindings(fixture.ctx.exec, registry);
    expect(report.schemaVersion).toBe(registry.schemaVersion);
  });

  test("counts agree with the findings list", async () => {
    const report = await collectFindings(fixture.ctx.exec, registry);
    const total = report.counts.error + report.counts.warning +
      report.counts.info;
    expect(total).toBe(report.findings.length);
  });

  test("two runs produce identical reports", async () => {
    const a = await collectFindings(fixture.ctx.exec, registry);
    const b = await collectFindings(fixture.ctx.exec, registry);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("every finding raised is in the catalog", async () => {
    const report = await collectFindings(fixture.ctx.exec, registry);
    for (const f of report.findings) {
      expect(FINDING_CATALOG[f.code]).toBeDefined();
      // Severity comes from the catalog, never from the producer.
      expect(f.severity).toBe(FINDING_CATALOG[f.code].severity);
    }
  });
});

describe("collectFindings sees real problems", () => {
  test("a row with no uuid", async () => {
    scratch = await fresh();
    await scratch.exec(
      "INSERT INTO scene (name, uuid) VALUES ('INT. NOWHERE', NULL)");
    const report = await collectFindings(scratch.exec, registry);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("identity.uuid_missing");
    expect(report.clean).toBe(false);
  });

  test("a relationship pointing at a character that is not here",
       async () => {
    scratch = await fresh();
    await scratch.exec(
      "INSERT INTO character_relationship " +
      "(character_a_id, character_b_id, directionality, uuid) " +
      "VALUES (1, 999, 'mutual', 'r1')");
    const report = await collectFindings(scratch.exec, registry);
    expect(report.findings.map((f) => f.code))
      .toContain("relationship.endpoint_absent");
  });

  test("an asset identifier that escapes its root", async () => {
    scratch = await fresh();
    await scratch.exec(
      "INSERT INTO asset (name, identifier, uuid) VALUES (?, ?, ?)",
      ["escape", "@project/../../etc/passwd", "a1"]);
    const report = await collectFindings(scratch.exec, registry);
    const f = report.findings.find(
      (x) => x.code === "asset.identifier_escapes_root");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("error");
  });

  test("an absolute identifier is a warning, not an error", async () => {
    // Representable on purpose (spec §8.2). Non-portable, not invalid.
    scratch = await fresh();
    await scratch.exec(
      "INSERT INTO asset (name, identifier, uuid) VALUES (?, ?, ?)",
      ["abs", "/Volumes/plates/shot.exr", "a2"]);
    const report = await collectFindings(scratch.exec, registry);
    const f = report.findings.find(
      (x) => x.code === "asset.identifier_absolute");
    expect(f?.severity).toBe("warning");
  });

  test("an unknown table is reported at info, not treated as damage",
       async () => {
    scratch = await fresh();
    await scratch.exec("CREATE TABLE x_pipeline (k TEXT)");
    const report = await collectFindings(scratch.exec, registry);
    const f = report.findings.find(
      (x) => x.code === "extension.unknown_table" && x.table === "x_pipeline");
    expect(f?.severity).toBe("info");
    expect(report.clean).toBe(true);
  });

  test("an unstamped file is reported without being condemned",
       async () => {
    scratch = openNodeDatabase(":memory:");
    await initDatabase(scratch.exec, registry);
    await scratch.exec("PRAGMA application_id = 0");
    const report = await collectFindings(scratch.exec, registry);
    const f = report.findings.find(
      (x) => x.code === "header.application_id_absent");
    expect(f?.severity).toBe("info");
    expect(report.clean).toBe(true);
  });
});
