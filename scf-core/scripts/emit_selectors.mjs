// SPDX-License-Identifier: Apache-2.0
/**
 * emit_selectors.mjs — write fixtures/expectations/selectors.json.
 *
 * WHAT §5.4 PROMISED, AND WHAT SHIPPED.
 *
 * `conformance.md` §5.4 has said since it was written that parameters
 * resolve from selectors "recorded alongside the expectations, so
 * another implementation can resolve them for itself". **No such file
 * existed.** The selectors lived in two test files, one of which covers
 * only the eight queries with rendered markdown.
 *
 * The fourth reader run recovered five selectors from prose in §5.4 and
 * §5.1 — someone had written those down deliberately, and they worked —
 * and then read **four more out of the `parameters` block of the
 * artifact it was about to be graded against**: Q10's theme, Q13's
 * intent, Q14's target, Q15's entityType.
 *
 * Q13's is the sharpest. `intent` is a literal that appears *in* the
 * result (§12.8), so the reader had to read the answer in order to
 * learn the question. That is not a conformance exercise.
 *
 * WHY SELECTORS RATHER THAN VALUES.
 *
 * A selector resolves a fixture row by its CONTENT — scene number 12,
 * the character named Eleanor — never by row id, which is file-local
 * (§6.2) and would break the moment the fixture was rebuilt. The
 * fixture IS rebuilt, from `hollow_creek.data.json`, and its row ids
 * changed the last time it was.
 *
 * Literals are published as literals: `visual_identity` is an asset
 * intent, not a row, and nothing resolves it.
 *
 *   node --experimental-strip-types scripts/emit_selectors.mjs
 *   node --experimental-strip-types scripts/emit_selectors.mjs --check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE = join(ROOT, "fixtures", "hollow_creek.scf");
const OUT = join(ROOT, "fixtures", "expectations", "selectors.json");

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

/**
 * One selector per named row. SQL against the fixture, returning a
 * single row, chosen so that it survives a rebuild.
 */
const SELECTORS = {
  eleanor: {
    sql: "SELECT id, uuid FROM character WHERE name LIKE '%Eleanor%'",
    note: "The protagonist. Named rather than numbered — surnames have "
        + "changed in this fixture's history and the given name has not.",
  },
  marcus: {
    sql: "SELECT id, uuid FROM character WHERE name LIKE '%Marcus%'",
    note: "The second character, used where a pair is needed.",
  },
  scene12: {
    sql: "SELECT id, uuid FROM scene WHERE scene_number = '12'",
    note: "The most heavily authored scene. Most expectations key on it.",
  },
  scene16: {
    sql: "SELECT id, uuid FROM scene WHERE scene_number = '16'",
    note: "The LATER of the two Q12 positions in story order, despite "
        + "the lower number — scene numbers are labels (§4.2).",
  },
  scene19: {
    sql: "SELECT id, uuid FROM scene WHERE scene_number = '19'",
    note: "The EARLIER of the two Q12 positions. 19 to 16 is forward.",
  },
  shot1204: {
    sql: "SELECT id, uuid FROM shot WHERE name LIKE '%12-04%'",
    note: "A shot in scene 12 carrying an override.",
  },
  forgiveness: {
    sql: "SELECT id, uuid FROM theme WHERE name LIKE '%Forgiveness%'",
    note: "The theme Q10 traces.",
  },
};

/** What each query was asked, per its published result. */
const PARAMETERS = {
  Q00: {},
  Q01: { subjectType: { literal: "character" }, subject: { selector: "eleanor" } },
  Q02: { subjectType: { literal: "character" }, subject: { selector: "eleanor" },
         scene: { selector: "scene12" }, shot: { selector: "shot1204" } },
  Q03: { scene: { selector: "scene19" } },
  Q04: { scene: { selector: "scene12" } },
  Q05: { character: { selector: "eleanor" }, scene: { selector: "scene12" } },
  Q06: { character: { selector: "eleanor" }, scene: { selector: "scene12" } },
  Q07: { scene: { selector: "scene12" }, shot: { selector: "shot1204" } },
  Q08: { scene: { selector: "scene12" }, shot: { literal: null } },
  Q09: { scene: { selector: "scene12" } },
  Q10: { theme: { selector: "forgiveness" } },
  Q11: { scene: { selector: "scene12" } },
  Q12: { from: { selector: "scene19" }, to: { selector: "scene16" } },
  Q13: { subjectType: { literal: "character" }, subject: { selector: "eleanor" },
         intent: { literal: "visual_identity" },
         scene: { selector: "scene12" }, shot: { selector: "shot1204" } },
  Q14: { target: { literal: "Q05" }, character: { selector: "eleanor" },
         scene: { selector: "scene12" }, shot: { literal: null } },
  Q15: { entityType: { literal: "scene" }, row: { selector: "scene12" } },
};

// ── Resolve, and check every selector actually matches ───────────────
const db = new DatabaseSync(FIXTURE, { readOnly: true });
const resolved = {};
const broken = [];
for (const [name, sel] of Object.entries(SELECTORS)) {
  const rows = db.prepare(sel.sql).all();
  if (rows.length !== 1) {
    broken.push(`${name}: matched ${String(rows.length)} rows, expected 1`);
    continue;
  }
  resolved[name] = { uuid: String(rows[0].uuid) };
}
db.close();

if (broken.length > 0) {
  console.error("[selectors] selectors that do not resolve against the "
                + "fixture:");
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}

// ── Check the published results agree ────────────────────────────────
const mismatched = [];
for (const [id, params] of Object.entries(PARAMETERS)) {
  let published;
  try {
    published = JSON.parse(readFileSync(
      join(ROOT, "fixtures", "expectations", `${id}.result.json`), "utf8"));
  } catch {
    mismatched.push(`${id}: no published result`);
    continue;
  }
  for (const [key, spec] of Object.entries(params)) {
    const want = "literal" in spec ? spec.literal : resolved[spec.selector]?.uuid;
    const got = published.parameters?.[key];
    if (want !== got) {
      mismatched.push(`${id}.${key}: selector gives ${String(want)}, `
                    + `artifact says ${String(got)}`);
    }
  }
  for (const key of Object.keys(published.parameters ?? {})) {
    if (!(key in params)) mismatched.push(`${id}.${key}: not in the selectors`);
  }
}

if (mismatched.length > 0) {
  // The whole point: if these disagree, a third party resolving the
  // selectors gets a different question from the one the artifact
  // answers, and would report a divergence that is ours.
  console.error("[selectors] selectors and published parameters disagree:");
  for (const m of mismatched) console.error(`  ${m}`);
  process.exit(1);
}

const text = `${JSON.stringify({
  $comment:
    "GENERATED by scf-core/scripts/emit_selectors.mjs. The parameters "
    + "every published .result.json was asked, as SELECTORS that resolve "
    + "against fixtures/hollow_creek.scf by content rather than by row "
    + "id. Conformance.md §5.4 promised these; before 0.40 they were not "
    + "published, and a third party had to read parameters out of the "
    + "artifact it was being graded against.",
  fixture: "fixtures/hollow_creek.scf",
  $selectors:
    "Each is SQL returning exactly one row. Row ids are file-local "
    + "(§6.2) and change when the fixture is rebuilt; uuids do not, and "
    + "are given here for convenience.",
  selectors: Object.fromEntries(Object.entries(SELECTORS).map(
    ([k, v]) => [k, { sql: v.sql, note: v.note, uuid: resolved[k].uuid }])),
  $parameters:
    "Per query: each parameter is either a `selector` naming one of the "
    + "above, or a `literal` carried as-is. A null literal means the "
    + "parameter was supplied as absent.",
  parameters: PARAMETERS,
}, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) {
    console.error("[selectors.json] STALE — run: npm run emit-selectors");
    process.exit(1);
  }
  console.log(`[selectors.json] up to date `
            + `(${String(Object.keys(SELECTORS).length)} selectors, `
            + `${String(Object.keys(PARAMETERS).length)} queries).`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`[selectors.json] wrote `
            + `${String(Object.keys(SELECTORS).length)} selectors across `
            + `${String(Object.keys(PARAMETERS).length)} queries.`);
}
