// SPDX-License-Identifier: Apache-2.0
/**
 * Spec §9.5 — the serialised report.
 *
 * The property that matters most is the boring one: two runs over an
 * unchanged file must produce byte-identical JSON. Everything else a
 * report is for — a CI baseline, a diff between schema versions, a
 * third party comparing their reader against yours — rests on that, and
 * a single stray timestamp destroys all of it.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import {
  REPORT_FORMAT_VERSION, renderReport, validationReport,
} from "../src/report.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

let fixture: Fixture;
beforeAll(() => { fixture = openFixture(); });
afterAll(() => { fixture.close(); });

describe("the report is diffable", () => {
  test("two runs over one file are byte-identical", async () => {
    const a = await validationReport(fixture.ctx.exec, registry,
                                     { source: "hollow_creek.scf" });
    const b = await validationReport(fixture.ctx.exec, registry,
                                     { source: "hollow_creek.scf" });
    expect(JSON.stringify(b, null, 2)).toBe(JSON.stringify(a, null, 2));
  });

  test("no timestamp unless asked for", async () => {
    const plain = await validationReport(fixture.ctx.exec, registry,
                                         { source: "x" });
    expect(plain.generatedAt).toBeUndefined();

    const stamped = await validationReport(fixture.ctx.exec, registry,
                                           { source: "x", timestamp: true });
    expect(stamped.generatedAt).toBeTypeOf("string");
  });
});

describe("the report carries what a consumer needs", () => {
  test("its own format version, on its own track", async () => {
    const r = await validationReport(fixture.ctx.exec, registry,
                                     { source: "x" });
    expect(r.reportFormat).toBe(REPORT_FORMAT_VERSION);
    // Distinct from the schema version: a report shape can change
    // without SCF changing, and vice versa.
    expect(r.reportFormat).not.toBe(r.toolSchemaVersion);
  });

  test("both schema versions, because they differ routinely", async () => {
    const r = await validationReport(fixture.ctx.exec, registry,
                                     { source: "x" });
    expect(r.toolSchemaVersion).toBe(registry.schemaVersion);
    expect(r.fileSchemaVersion).toBe(registry.schemaVersion);
  });

  test("each finding names the spec section it comes from", async () => {
    const db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO scene (name, uuid) VALUES ('X', NULL)");
    const r = await validationReport(db.exec, registry, { source: "x" });
    for (const f of r.findings) {
      expect(f.spec).toMatch(/^§/);
      expect(f.title).not.toBe("");
    }
    db.close();
  });

  test("source is carried verbatim", async () => {
    const r = await validationReport(fixture.ctx.exec, registry,
                                     { source: "some/odd path.scf" });
    expect(r.source).toBe("some/odd path.scf");
  });
});

describe("the prose rendering agrees with the JSON", () => {
  test("a file with nothing wrong still reports what is unfinished",
       async () => {
    // The fixture stopped being finding-free in 0.42, deliberately: it
    // gained a scene with no screenplay heading so that §4.1's fallback
    // is exercised by something. That raises `structure.scene_not_in_
    // script` at `info`, which is the point — §9.2 requires a reader to
    // answer usefully on half-placed data AND say what is missing, and
    // a fixture with nothing missing cannot demonstrate the second half.
    const report = await validationReport(
      fixture.ctx.exec, registry, { source: "hollow_creek.scf" });
    const text = renderReport(report);
    expect(text).toContain("hollow_creek.scf");

    // Nothing is WRONG with it.
    expect(report.counts.error).toBe(0);
    expect(report.counts.warning).toBe(0);
    expect(report.clean).toBe(true);

    // And something is unfinished, said plainly.
    expect(report.findings.map((f) => f.code))
      .toContain("structure.scene_not_in_script");
    expect(text).toContain("no story position");
  });

  test("a file with no findings at all says so without listing nothing",
       async () => {
    const db: NodeDatabase = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    try {
      const text = renderReport(await validationReport(
        db.exec, registry, { source: "empty.scf" }));
      expect(text).toContain("no findings");
    } finally {
      db.close();
    }
  });

  test("an error is named, counted, and explained", async () => {
    const db: NodeDatabase = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO scene (name, uuid) VALUES ('X', NULL)");
    const report = await validationReport(db.exec, registry,
                                          { source: "broken.scf" });
    const text = renderReport(report);

    expect(text).toContain("identity.uuid_missing");
    expect(text).toContain("1 error");
    // The §9.1 distinction, said out loud rather than left to the exit
    // code: errors mean readers disagree, not that the file is refused.
    expect(text).toContain("disagree");
    db.close();
  });

  test("every finding in the JSON appears in the prose", async () => {
    const db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("CREATE TABLE legacy (k TEXT)");
    await db.exec("INSERT INTO scene (name, uuid) VALUES ('X', NULL)");
    const report = await validationReport(db.exec, registry,
                                          { source: "mixed.scf" });
    const text = renderReport(report);
    for (const f of report.findings) expect(text).toContain(f.code);
    db.close();
  });
});
