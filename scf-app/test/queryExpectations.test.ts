/**
 * queryExpectations.test.ts — the canonical query expectations, as data.
 *
 * `conformance.md` §5.4 has said since it was written that these live
 * inside test code, so a second implementation has to port TypeScript
 * rather than read a file. This moves them out.
 *
 * WHAT IS BLESSED, and why not the payload.
 *
 * The obvious move is to serialise each runner's payload. It is the
 * wrong one: payloads carry `id`, `created_at` and `updated_at`, and
 * every foreign key is a row id. Row ids are local to a file (spec
 * §6.2), so a second implementation reading the same fixture would
 * legitimately produce different ones, and timestamps change whenever
 * the fixture is rebuilt. Expectations full of both would fail for
 * reasons unrelated to correctness — the worst kind of test, because
 * the response is to stop believing it.
 *
 * So two artifacts, neither containing anything file-local:
 *
 *   <Q>.expected.md   the rendered context markdown — what a consumer
 *                     of these queries actually receives. Names, not
 *                     ids. Diffs legibly.
 *   shapes.json       the payload's STRUCTURE: key names, array
 *                     lengths, volatile fields dropped. Catches a
 *                     structural regression the prose would not show.
 *
 * Parameters resolve from stable SELECTORS — scene number 12, the
 * character named Eleanor — recorded alongside, for the same reason.
 *
 * Blessing:  npm run bless-queries   (vitest --mode bless)
 * Checking:  npm test                (this file, every run)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import type { ScfContext } from "@scf-core/resolution.ts";
import { QUERIES, type ParamValues } from "../src/ui/queries/runners.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "fixtures", "expectations");
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const REGISTRY = join(HERE, "..", "..", "scf-core", "registry",
                      "registry.json");

const BLESS = import.meta.env.MODE === "bless";

const VOLATILE = new Set(["id", "created_at", "updated_at"]);

/**
 * The payload's shape: what keys exist and how many of each, with
 * nothing file-local. An array becomes its length plus the shape of its
 * first element — thirty rows differing only in id have one shape, not
 * thirty.
 */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return { length: 0, of: null };
    const first: unknown = value[0];
    // A list of tuples — [name, row] pairs, as the cascade layers are —
    // must be shaped POSITIONALLY. Shaping only element 0 would collapse
    // `[["sonic_identity", {...30 fields}]]` to "an array of two
    // strings", which is exactly the row structure worth pinning.
    if (Array.isArray(first)) {
      return {
        length: value.length,
        tuple: first.map((v) => shapeOf(v, depth + 1)),
      };
    }
    return { length: value.length, of: shapeOf(first, depth + 1) };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      if (VOLATILE.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      // A foreign key is a row id: record that it is present and
      // populated, never what it points at.
      if (key.endsWith("_id")) {
        out[key] = v === null ? "null" : "<row-ref>";
        continue;
      }
      out[key] = shapeOf(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

/** Selectors, not ids: each names a fixture row by its content. */
const SELECTORS: Record<string, string> = {
  eleanor: "SELECT id FROM character WHERE name LIKE '%Eleanor%'",
  sc9: "SELECT id FROM scene WHERE scene_number = '9'",
  sc12: "SELECT id FROM scene WHERE scene_number = '12'",
  shot1204: "SELECT id FROM shot WHERE name LIKE '%12-04%'",
};

const PARAMS: Record<string, Record<string, string>> = {
  Q03: { scene_id: "sc12" },
  Q05: { character_id: "eleanor", scene_id: "sc12" },
  Q06: { character_id: "eleanor", scene_id: "sc12" },
  Q07: { scene_id: "sc12", shot_id: "shot1204" },
  Q08: { scene_id: "sc12" },
  Q12: { scene_a: "sc9", scene_b: "sc12" },
  Q13: { subject: "character", subject_id: "eleanor",
         intent: "visual_identity", scene_id: "sc12",
         shot_id: "shot1204" },
  Q14: { target: "Q05", character_id: "eleanor", scene_id: "sc12" },
};

let db: NodeDatabase;
let ctx: ScfContext;
let resolved: Record<string, number>;
let schemaVersion: string;

beforeAll(async () => {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  schemaVersion = registry.schemaVersion;
  db = openNodeDatabase(FIXTURE, { readOnly: true });
  ctx = { exec: db.exec, registry };

  resolved = {};
  for (const [name, sql] of Object.entries(SELECTORS)) {
    const rows = await db.exec(sql);
    const id = rows[0]?.["id"];
    if (id === undefined) throw new Error(`selector ${name} matched nothing`);
    resolved[name] = Number(id);
  }
  if (BLESS) mkdirSync(OUT, { recursive: true });
});

afterAll(() => { db.close(); });

const valuesFor = (id: string): ParamValues => {
  const out: Record<string, unknown> = {};
  for (const [key, sel] of Object.entries(PARAMS[id] ?? {})) {
    out[key] = Object.hasOwn(resolved, sel) ? resolved[sel] : sel;
  }
  return out as ParamValues;
};

describe.each(Object.keys(PARAMS))("%s expectations", (id) => {
  test("rendered context matches the blessed markdown", async () => {
    const spec = QUERIES.find((s) => s.id === id);
    expect(spec).toBeDefined();
    const values = valuesFor(id);
    const markdown = spec!.toMarkdown(await spec!.run(ctx, values), values);
    const path = join(OUT, `${id}.expected.md`);

    if (BLESS) {
      writeFileSync(path, markdown, "utf8");
      return;
    }
    expect(existsSync(path), `${id}.expected.md missing — run bless-queries`)
      .toBe(true);
    expect(markdown).toBe(readFileSync(path, "utf8"));
  });

  test("the blessed markdown carries no row ids or timestamps", () => {
    // The property that makes these portable. If a runner starts
    // printing an id, the expectation silently stops being something a
    // second implementation could reproduce.
    if (BLESS) return;
    const text = readFileSync(join(OUT, `${id}.expected.md`), "utf8");
    expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/);
    expect(text).not.toMatch(/"id"\s*:/);
  });
});

describe("payload shapes", () => {
  test("match the blessed structure", async () => {
    const queries: Record<string, unknown> = {};
    for (const id of Object.keys(PARAMS)) {
      const spec = QUERIES.find((s) => s.id === id)!;
      queries[id] = {
        name: spec.name,
        selectors: PARAMS[id],
        shape: shapeOf(await spec.run(ctx, valuesFor(id))),
      };
    }
    const text = `${JSON.stringify({
      $comment:
        "GENERATED by scf-app/test/queryExpectations.test.ts. The " +
        "canonical query expectations, spec/conformance.md §5.4. " +
        "Selectors resolve fixture rows by content, never by row id, " +
        "which is file-local (spec §6.2). Shapes drop id, created_at " +
        "and updated_at for the same reason.",
      fixture: "fixtures/hollow_creek.scf",
      schemaVersion,
      selectors: SELECTORS,
      queries,
    }, null, 2)}\n`;
    const path = join(OUT, "shapes.json");

    if (BLESS) {
      writeFileSync(path, text, "utf8");
      return;
    }
    expect(existsSync(path), "shapes.json missing — run bless-queries")
      .toBe(true);
    expect(text).toBe(readFileSync(path, "utf8"));
  });
});

describe("the expectation set as a whole", () => {
  test("covers the queries that take parameters", () => {
    // Q00/Q01/Q02/Q04/Q09/Q10/Q11/Q15 are not blessed here: they either
    // take no parameters or enumerate the whole project, so their
    // output is a function of the fixture rather than of a position in
    // it. Worth adding, and honest to say they are not covered yet.
    expect(Object.keys(PARAMS).length).toBe(8);
    expect(QUERIES.length).toBe(16);
  });
});
