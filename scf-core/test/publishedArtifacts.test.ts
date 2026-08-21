// SPDX-License-Identifier: Apache-2.0
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
import { junctionEntities, junctionKeyFields } from "../src/junctions.ts";
import { QUERY_PATHS } from "../src/queryPaths.ts";
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

interface JunctionDoc {
  entityCount: number;
  entities: Array<{ entity: string; keyFields: string[] }>;
}
const junctions = read("../../spec/junction-keys.json") as JunctionDoc;

interface RubricDoc {
  requirementToSeverity: Record<string, string>;
  queryCount: number;
  queries: Array<{
    query: string; name: string; params: string[];
    steps: Array<{ label: string; requirement: string; purpose: string }>;
  }>;
}
const rubrics = read("../../spec/readiness-rubrics.json") as RubricDoc & {
  $stepLabels: string;
};

describe("the published junction keys (§6.3)", () => {
  test("cover every link entity, with the keys the code computes", () => {
    const live = junctionEntities(registry)
      .map((e) => ({ entity: e.name, keyFields: junctionKeyFields(e) }))
      .sort((a, b) => a.entity.localeCompare(b.entity));
    expect(junctions.entities).toEqual(live);
    expect(junctions.entityCount).toBe(live.length);
  });

  test("every key field exists on its entity", () => {
    // A published key naming a column that is not there would be worse
    // than no published key: it looks authoritative.
    for (const { entity, keyFields } of junctions.entities) {
      const def = registry.entities.get(entity);
      expect(def, entity).toBeDefined();
      for (const field of keyFields) {
        expect(def?.fields.some((f) => f.name === field), `${entity}.${field}`)
          .toBe(true);
      }
    }
  });

  test("no key is empty", () => {
    for (const j of junctions.entities) {
      expect(j.keyFields.length, j.entity).toBeGreaterThan(0);
    }
  });
});

describe("the published readiness rubrics (§12.9.1)", () => {
  test("match QUERY_PATHS", () => {
    expect(rubrics.queries.map((q) => q.query))
      .toEqual(Object.keys(QUERY_PATHS).sort());
  });

  test("every step has a label, a known requirement and a purpose", () => {
    const known = new Set(["required", "recommended", "optional"]);
    for (const q of rubrics.queries) {
      expect(q.steps.length, q.query).toBeGreaterThan(0);
      for (const step of q.steps) {
        expect(step.label, q.query).not.toBe("");
        expect(known.has(step.requirement), step.requirement).toBe(true);
        expect(step.purpose).not.toBe("");
      }
    }
  });

  test("step labels are prose, and the artifact says so", () => {
    // They are not registry entity names — "sound_cue / music_cue",
    // "bundle + *_asset_binding", "performance_state (vocal)". Calling
    // the field `entity` claimed they resolved; they do not. A consumer
    // must be told which half is machine-readable.
    const unresolvable = rubrics.queries.flatMap(
      (q) => q.steps.map((s) => s.label))
      .filter((label) => !registry.entities.has(label));
    expect(unresolvable.length).toBeGreaterThan(0);
    expect(rubrics.$stepLabels).toContain("prose");
  });

  test("the requirement-to-severity map covers every requirement used",
       () => {
    // The map is the half a third party cannot guess: it is what turns a
    // rubric into findings at the severities §12.9 says carry the answer.
    for (const q of rubrics.queries) {
      for (const step of q.steps) {
        expect(rubrics.requirementToSeverity[step.requirement],
               step.requirement).toBeTypeOf("string");
      }
    }
    expect(rubrics.requirementToSeverity["present"]).toBe("ok");
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
