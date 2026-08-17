/**
 * build_negative.mjs — the negative fixtures.
 *
 * Hollow Creek contains authored ABSENCES: a thin vocal profile, a
 * missing voice bundle, gapped scene numbers. What it has never
 * contained is authored ERRORS, so nothing pinned what a conforming
 * implementation should SAY when a file is wrong. `conformance.md` §5.3
 * has named that gap since it was written.
 *
 * Each case is a minimal database plus exactly the damage its name
 * describes. Minimal on purpose: a case that trips three findings tells
 * you nothing about which code belongs to which condition.
 *
 * The .scf files are BUILT, not checked in. Ten fresh databases is
 * several megabytes of binary in a repo whose whole point is a
 * text-first format, and they are perfectly reproducible from here. The
 * blessed reports ARE checked in — those are the artifact, and they are
 * diffable, which the databases would not be.
 *
 *   node --experimental-strip-types scripts/build_negative.mjs
 *   node --experimental-strip-types scripts/build_negative.mjs --check
 *
 * --check rebuilds and compares against the blessed reports without
 * writing, for CI.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync }
  from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../src/db.ts";
import { loadRegistry } from "../src/registry.ts";
import { openNodeDatabase } from "../src/node.ts";
import { validationReport } from "../src/report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "fixtures", "negative");
const BUILD = join(OUT, "build");

const registry = loadRegistry(JSON.parse(readFileSync(
  join(HERE, "..", "registry", "registry.json"), "utf8")));

/**
 * Deterministic, well-formed uuids. The first draft of this file used
 * readable strings like 'ch-1', and every case then reported
 * identity.uuid_malformed alongside the thing it was actually meant to
 * demonstrate — a case that trips two findings tells you nothing about
 * which code belongs to which condition. The fixtures have to be clean
 * everywhere except the one place they are dirty.
 */
const uuid = (n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * Each case: a name, one sentence on what is wrong, and the damage.
 * The comment on each is the interesting part — it says what a reader
 * is supposed to conclude, which is the thing being pinned.
 */
const CASES = [
  {
    name: "uuid-missing",
    about: "A row with no uuid. Nothing can track it across a file.",
    damage: async (exec) => {
      await exec("INSERT INTO scene (name, uuid) VALUES ('INT. VOID', NULL)");
    },
  },
  {
    name: "uuid-duplicate",
    about: "Two rows sharing a uuid. Lineage becomes ambiguous.",
    damage: async (exec) => {
      // The unique index is what normally prevents this, so it has to be
      // dropped first — which is itself a finding, and the reason this
      // case reports two things rather than one.
      await exec("DROP INDEX IF EXISTS idx_scene_uuid");
      await exec("INSERT INTO scene (name, uuid) VALUES ('A', ?)", [uuid(1)]);
      await exec("INSERT INTO scene (name, uuid) VALUES ('B', ?)", [uuid(1)]);
    },
  },
  {
    name: "uuid-malformed",
    about: "A uuid that is not uuid-shaped.",
    damage: async (exec) => {
      await exec("INSERT INTO scene (name, uuid) VALUES ('C', 'not-a-uuid')");
    },
  },
  {
    name: "relationship-endpoint-absent",
    about: "A relationship pointing at a character that is not here.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO character (name, uuid) VALUES ('ELEANOR', ?)",
        [uuid(1)]);
      await exec(
        "INSERT INTO character_relationship (character_a_id, " +
        "character_b_id, directionality, uuid) VALUES (1, 404, 'mutual', ?)",
        [uuid(2)]);
    },
  },
  {
    name: "relationship-contradictory",
    about:
      "One pair described as both mutual and directed. No tool can pick " +
      "the winner — the case §6.5's directionality flag exists for.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO character (name, uuid) VALUES ('ELEANOR', ?)",
        [uuid(1)]);
      await exec(
        "INSERT INTO character (name, uuid) VALUES ('MARCUS', ?)",
        [uuid(2)]);
      await exec(
        "INSERT INTO character_relationship (character_a_id, " +
        "character_b_id, directionality, uuid) VALUES (1, 2, 'mutual', ?)",
        [uuid(3)]);
      await exec(
        "INSERT INTO character_relationship (character_a_id, " +
        "character_b_id, directionality, uuid) VALUES (1, 2, 'a_to_b', ?)",
        [uuid(4)]);
    },
  },
  {
    name: "relationship-directionality-absent",
    about:
      "A relationship with no symmetry fact. Readable, but nothing can " +
      "tell a duplicate from a second direction. Note the explicit " +
      "NULL: the column defaults to 'mutual', so this state is only " +
      "reachable by clearing it — which is exactly what an import from " +
      "a tool that has no such concept would do.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO character (name, uuid) VALUES ('ELEANOR', ?)",
        [uuid(1)]);
      await exec(
        "INSERT INTO character (name, uuid) VALUES ('MARCUS', ?)",
        [uuid(2)]);
      await exec(
        "INSERT INTO character_relationship (character_a_id, " +
        "character_b_id, directionality, uuid) VALUES (1, 2, NULL, ?)",
        [uuid(3)]);
    },
  },
  {
    name: "span-boundary-dangling",
    about:
      "An act anchored to a scene that is not present. Structure must " +
      "still derive (§5.5) and say so.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO scene (name, scene_number, uuid) " +
        "VALUES ('INT. KITCHEN', '1', ?)", [uuid(1)]);
      await exec(
        "INSERT INTO act (name, act_number, start_scene_id, uuid) " +
        "VALUES ('Act I', 1, 999, ?)", [uuid(2)]);
    },
  },
  {
    name: "asset-escapes-root",
    about:
      "An identifier containing '..'. It cannot be resolved, and a " +
      "resolver that followed it would leave the project.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO asset (name, identifier, uuid) VALUES (?, ?, ?)",
        ["escape", "@project/../../etc/passwd", uuid(1)]);
    },
  },
  {
    name: "asset-absolute",
    about:
      "An absolute identifier. Representable on purpose (§8.2), " +
      "non-portable, and a warning rather than an error.",
    damage: async (exec) => {
      await exec(
        "INSERT INTO asset (name, identifier, uuid) VALUES (?, ?, ?)",
        ["plate", "/Volumes/plates/sh010.exr", uuid(1)]);
    },
  },
  {
    name: "unknown-table",
    about:
      "A table SCF does not define. Preserved and ignored (§10.1) — " +
      "reported at info, because unknown usually means historical.",
    damage: async (exec) => {
      await exec("CREATE TABLE legacy_pipeline (k TEXT, v TEXT)");
      await exec(
        "INSERT INTO legacy_pipeline (k, v) VALUES ('shotgun_id', 'sg-1')");
    },
  },
  {
    name: "header-unstamped",
    about:
      "No application id. Every file written before schema 2.10 looks " +
      "like this, and a reader MUST NOT refuse it (§1.2).",
    damage: async (exec) => {
      await exec("PRAGMA application_id = 0");
      await exec("PRAGMA user_version = 0");
    },
  },
];

/**
 * Record every statement a case issues, so the damage can be PUBLISHED
 * rather than only performed. A third party can build eleven damaged
 * databases from eleven descriptions; they cannot guess eleven reports.
 */
function recordingExec(exec, log) {
  return async (sql, params = []) => {
    log.push(params.length === 0
      ? sql
      : `${sql}   -- params: ${JSON.stringify(params)}`);
    return exec(sql, params);
  };
}

async function build(name, damage) {
  const path = join(BUILD, `${name}.scf`);
  rmSync(path, { force: true });
  const db = openNodeDatabase(path);
  await initDatabase(db.exec, registry);
  const statements = [];
  await damage(recordingExec(db.exec, statements));
  const report = await validationReport(db.exec, registry, {
    source: `fixtures/negative/build/${name}.scf`,
  });
  db.close();
  return { report, statements };
}

const check = process.argv.includes("--check");
mkdirSync(BUILD, { recursive: true });

let stale = [];
const casesDoc = [];
for (const { name, about, damage } of CASES) {
  const { report, statements } = await build(name, damage);
  casesDoc.push({ name, about, statements });
  const blessed = join(OUT, `${name}.expected.json`);
  const text = `${JSON.stringify({ about, ...report }, null, 2)}\n`;
  if (check) {
    const current = existsSync(blessed)
      ? readFileSync(blessed, "utf8") : "";
    if (current !== text) stale.push(name);
  } else {
    writeFileSync(blessed, text, "utf8");
  }
}

// The recipe file. Everything a third party needs to reconstruct the
// eleven databases without this repository: start from a database
// created per spec/scf-schema.sql, apply these statements, compare
// against the blessed report.
const recipe = `${JSON.stringify({
  $comment:
    "GENERATED by scf-core/scripts/build_negative.mjs. The negative " +
    "fixtures of spec/conformance.md §5.3. Each case: start from an " +
    "empty conforming database (spec/scf-schema.sql, plus the header " +
    "stamps and _scf_meta.schema_version of §1.2), apply `statements` " +
    "in order, then validate. The result must match the case's " +
    "<name>.expected.json.",
  schemaVersion: registry.schemaVersion,
  caseCount: CASES.length,
  cases: casesDoc,
}, null, 2)}\n`;
const recipePath = join(OUT, "CASES.json");

if (check) {
  const currentRecipe = existsSync(recipePath)
    ? readFileSync(recipePath, "utf8") : "";
  if (currentRecipe !== recipe) stale.push("CASES.json");
  if (stale.length > 0) {
    console.error(`[negative] STALE: ${stale.join(", ")}`);
    console.error("  run: npm run bless-negative");
    process.exit(1);
  }
  console.log(`[negative] up to date (${String(CASES.length)} cases).`);
} else {
  writeFileSync(recipePath, recipe, "utf8");
  console.log(
    `[negative] blessed ${String(CASES.length)} cases + CASES.json.`);
}
