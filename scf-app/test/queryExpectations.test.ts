// SPDX-License-Identifier: Apache-2.0
/**
 * queryExpectations.test.ts — the canonical query expectations, as data.
 *
 * `conformance.md` §5.4 has said since it was written that these live
 * inside test code, so a second implementation has to port TypeScript
 * rather than read a file. This moves them out.
 *
 * WHAT THIS FILE BLESSES, and what it no longer does.
 *
 *   <Q>.expected.md   the rendered context markdown — what a consumer
 *                     of these queries actually receives. Names, not
 *                     ids. Diffs legibly. A CONVENIENCE, not a
 *                     contract: spec §12.0 says so for every query.
 *
 * It also blessed `shapes.json`, a structural sketch of each runner's
 * raw payload. That artifact was RETIRED in spec 0.29. It predated §12
 * and described the runners' own shape rather than the result structure
 * §12.1 defines — it recorded a flat row with a `<row-ref>` where a
 * result carries `{ uuid, fields }` with the reference resolved. Once
 * all sixteen queries had normative `.result.json` files, blessed by
 * `scf-core/test/canonicalQueries.test.ts`, it asserted a weaker version
 * of the same thing in a shape the specification does not describe. Two
 * artifacts for one property, disagreeing — the drift this repository is
 * built to avoid.
 *
 * The structural check now lives where the structure is defined:
 * `.result.json`, compared in full, in scf-core.
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

describe("the expectation set as a whole", () => {
  test("covers the queries whose markdown is worth pinning", () => {
    // Eight render markdown against a POSITION, so the rendering is
    // worth diffing. The other eight take no parameters or enumerate
    // the whole project, and their markdown is a function of the
    // fixture rather than of a position in it.
    //
    // All sixteen have normative `.result.json` files regardless —
    // blessed in scf-core, which is where the result structure lives.
    // Nothing here is the coverage story any more.
    expect(Object.keys(PARAMS).length).toBe(8);
    expect(QUERIES.length).toBe(16);
  });
});
