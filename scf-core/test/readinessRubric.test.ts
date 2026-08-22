// SPDX-License-Identifier: Apache-2.0
/**
 * readinessRubric.test.ts — the published rubric and Q14 agree.
 *
 * WHY THIS EXISTS.
 *
 * `spec/readiness-rubrics.json` is generated from `QUERY_PATHS` and
 * published as the rubric Q14 assesses against (§12.9). `readiness.ts`
 * does NOT walk `QUERY_PATHS` — it has a hand-written assessment per
 * query. So the published rubric is a SECOND description of what Q14
 * does, and nothing made the two agree.
 *
 * That is the shape of every recurring defect in this repository, and
 * the consequence here is specific: a third party reproduces the rubric
 * faithfully, gets a different set of findings from the reference
 * implementation, and has no way to tell which of them is wrong.
 *
 * These tests do not merge the two — collapsing the hand-written
 * assessments into a rubric walk would change what Q14 says, and Q14's
 * messages carry judgement a rubric cannot ("Physical state persists
 * here (wounded) with no vocal state — does it color the voice?"). They
 * pin the agreement instead: every entity Q14 reports must be one the
 * rubric declares for that query.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { QUERY_PATHS } from "../src/queryPaths.ts";
import { loadRegistry } from "../src/registry.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RUBRICS = join(ROOT, "spec", "readiness-rubrics.json");
const REGISTRY = join(HERE, "..", "registry", "registry.json");

interface Step {
  entities: string[];
  requirement: string;
  purpose: string;
  label: string;
  filter?: { field: string; values: string[] };
  intent?: string;
}

const published = JSON.parse(readFileSync(RUBRICS, "utf8")) as {
  queries: { query: string; steps: Step[] }[];
};
const registry = loadRegistry(
  JSON.parse(readFileSync(REGISTRY, "utf8")));

describe("the published rubric resolves", () => {
  test("every step names at least one entity", () => {
    for (const q of published.queries) {
      for (const step of q.steps) {
        expect(step.entities.length,
               `${q.query}: "${step.label}" names none`).toBeGreaterThan(0);
      }
    }
  });

  test("every entity named is a registry entity", () => {
    // The generator refuses to publish otherwise; this checks the
    // published artifact rather than the code that wrote it, so a
    // hand-edit is caught too.
    for (const q of published.queries) {
      for (const step of q.steps) {
        for (const name of step.entities) {
          expect(registry.entities.has(name),
                 `${q.query}: ${name} is not a registry entity`).toBe(true);
        }
      }
    }
  });

  test("every filter names a column those entities have", () => {
    for (const q of published.queries) {
      for (const step of q.steps) {
        if (step.filter === undefined) continue;
        for (const name of step.entities) {
          const entity = registry.entities.get(name);
          expect(entity?.fields.some((f) => f.name === step.filter?.field),
                 `${q.query}: ${name} has no ${step.filter.field}`).toBe(true);
        }
      }
    }
  });

  test("no label is parsed for meaning", () => {
    // The label is derived, so it must not be the only place something
    // is said. Anything in a label that looks like a qualifier must
    // appear structurally too.
    for (const q of published.queries) {
      for (const step of q.steps) {
        if (/\(/.test(step.label)) {
          expect(step.filter,
                 `${q.query}: "${step.label}" qualifies in prose only`)
            .toBeDefined();
        }
        if (step.label.startsWith("media:")) {
          expect(step.intent,
                 `${q.query}: "${step.label}" names an intent in prose only`)
            .toBeDefined();
        }
      }
    }
  });
});

describe("the rubric and Q14 describe the same thing", () => {
  test("the published rubric covers exactly the walkable queries", () => {
    expect(published.queries.map((q) => q.query).sort())
      .toEqual(Object.keys(QUERY_PATHS).sort());
  });

  test("Q14's findings name only entities the rubric declares", () => {
    // The one that matters. `readiness.ts` assesses by hand, so it can
    // report an entity no step mentions — which is how a rubric and an
    // implementation drift apart while both look right on their own.
    const q14 = JSON.parse(readFileSync(
      join(ROOT, "fixtures", "expectations", "Q14.result.json"),
      "utf8")) as {
        parameters: { target: string };
        result: { findings: { entity: string }[] };
      };

    const target = q14.parameters.target;
    const rubric = published.queries.find((q) => q.query === target);
    expect(rubric, `no rubric for ${target}`).toBeDefined();

    const declared = new Set(rubric?.steps.flatMap((s) => s.entities));
    const reported = [...new Set(
      q14.result.findings.map((f) => f.entity))].sort();

    const undeclared = reported.filter((e) => !declared.has(e));
    expect(undeclared,
           `${target}: Q14 reports ${undeclared.join(", ")}, which the ` +
           "published rubric does not declare. Either readiness.ts " +
           "assesses something the rubric omits, or the rubric names it " +
           "differently — a third party reproducing the rubric would " +
           "disagree with this implementation and could not tell why.")
      .toEqual([]);
  });
});
