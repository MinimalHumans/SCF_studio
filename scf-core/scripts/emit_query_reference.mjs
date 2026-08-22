// SPDX-License-Identifier: Apache-2.0
/**
 * emit_query_reference.mjs — write spec/query-reference.md.
 *
 * One page listing all sixteen canonical queries: what each answers,
 * what it takes, what its result carries, and where the normative
 * statement is.
 *
 * WHY THIS IS GENERATED, AND FROM WHAT.
 *
 * Nothing here is authored. Every fact is read from something that
 * already exists and is already checked:
 *
 *   spec/scf-spec.md §12.2–12.17   the query's number, id and title,
 *                                  and its one-line "what it answers"
 *   fixtures/expectations/*.json   the parameters and the result's
 *                                  top-level members, read from the
 *                                  published normative artifact
 *   src/queryPaths.ts              the resolution path and requirement
 *                                  levels, for the walkable queries
 *
 * A hand-written version would be a fourth description of the same
 * sixteen things. This is navigation over the spec, not a restatement
 * of it: §12 is where the rules are, and every row here links back.
 *
 * ORDERING. §12's sections run in a deliberate order that is not the
 * numeric order of the query ids — Q05 is §12.2 and Q00 is §12.12,
 * because the section builds from a single position outward to the
 * whole story. This document follows the SPEC's order and prints the
 * ids beside it, rather than sorting by id and quietly implying the
 * spec is disordered.
 *
 *   node --experimental-strip-types scripts/emit_query_reference.mjs
 *   node --experimental-strip-types scripts/emit_query_reference.mjs --check
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUERY_PATHS } from "../src/queryPaths.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const ROOT = join(PKG, "..");
const SPEC = join(ROOT, "spec", "scf-spec.md");
const EXPECT = join(ROOT, "fixtures", "expectations");
const OUT = join(ROOT, "spec", "query-reference.md");

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

// ── Parse §12's query sections ──────────────────────────────────────
const spec = readFileSync(SPEC, "utf8").split("\n");
const queries = [];
for (let i = 0; i < spec.length; i += 1) {
  const m = /^### (12\.\d+) (Q\d\d) — (.+)$/.exec(spec[i]);
  if (!m) continue;
  const [, section, id, title] = m;

  // The summary is the first bold paragraph under the heading, and it
  // MAY WRAP: §12.16's runs across two lines, which a single-line match
  // silently returned empty for. An empty cell in a generated table is
  // the kind of gap nobody reads twice, so the join is deliberate and
  // the absence below is fatal.
  let answers = "";
  let buffer = "";
  for (let j = i + 1; j < Math.min(i + 10, spec.length); j += 1) {
    const line = spec[j].trim();
    if (/^### /.test(line)) break;
    if (buffer === "" && !line.startsWith("**")) continue;
    buffer = buffer === "" ? line : `${buffer} ${line}`;
    const b = /^\*\*(.+?)\*\*$/s.exec(buffer);
    if (b) { answers = b[1].replace(/\s+/g, " "); break; }
  }
  queries.push({ section, id, title, answers });
}

if (queries.length !== 16) {
  console.error(`[query-reference] found ${queries.length} query sections ` +
                "in §12, expected 16. Either a query was added without a " +
                "section, or a heading no longer matches " +
                "'### 12.N QNN — Title'.");
  process.exit(1);
}

// ── Read the published normative results ────────────────────────────
const published = new Map();
for (const file of readdirSync(EXPECT)) {
  if (!file.endsWith(".result.json")) continue;
  const doc = JSON.parse(readFileSync(join(EXPECT, file), "utf8"));
  published.set(doc.query, {
    parameters: Object.keys(doc.parameters ?? {}),
    members: Object.keys(doc.result ?? {}),
    file: `fixtures/expectations/${file}`,
  });
}

const unsummarised = queries.filter((q) => !q.answers);
if (unsummarised.length > 0) {
  console.error("[query-reference] no summary line found for: " +
                unsummarised.map((q) => `${q.id} (§${q.section})`).join(", "));
  console.error("  Each §12 query section must open with a bold sentence " +
                "saying what the query answers.");
  process.exit(1);
}

const missing = queries.filter((q) => !published.has(q.id));
if (missing.length > 0) {
  console.error("[query-reference] no published result for: " +
                missing.map((q) => q.id).join(", "));
  process.exit(1);
}

// ── Emit ────────────────────────────────────────────────────────────
const lines = [
  "<!-- SPDX-License-Identifier: CC-BY-4.0 -->",
  "",
  "# Query reference",
  "",
  `**${queries.length} canonical queries.** Spec §12.`,
  "",
  "**Generated. Not normative, and not hand-edited.** §12 states the",
  "rules and each query's result shape; this is an index over it. Every",
  "fact below is read from the specification, from the published",
  "`.result.json` artifacts, or from `queryPaths.ts`.",
  "",
  "The order is §12's, which builds from a single position outward to",
  "the whole story. It is not the numeric order of the ids.",
  "",
  "## At a glance",
  "",
  "| § | Query | Answers | Takes |",
  "|---|---|---|---|",
  ...queries.map((q) => {
    const p = published.get(q.id);
    const params = p.parameters.length
      ? p.parameters.map((x) => `\`${x}\``).join(", ")
      : "*no parameters*";
    return `| ${q.section} | **${q.id}** ${esc(q.title)} | ` +
           `${esc(q.answers)} | ${params} |`;
  }),
  "",
  "Every result carries the envelope of §12.1.1 — `query`,",
  "`resultFormat`, `schemaVersion`, `parameters`, `result` — and the",
  "members listed below are those of `result`.",
  "",
  "**Rows appear as `{ uuid, fields }`** (§12.1.2). Row ids never appear;",
  "references resolve to uuids; empty fields are omitted. Values that are",
  "not rows follow §12.1.4, where an absent member is carried as `null`",
  "rather than dropped.",
  "",
];

for (const q of queries) {
  const p = published.get(q.id);
  lines.push("---", "", `## ${q.id} — ${esc(q.title)}`, "");
  if (q.answers) lines.push(`**${esc(q.answers)}**`, "");
  lines.push(`Specified in **§${q.section}**. Normative result: ` +
             `[\`${p.file}\`](../${p.file}).`, "");

  lines.push(p.parameters.length
    ? "Parameters: " + p.parameters.map((x) => `\`${x}\``).join(", ") + "."
    : "Takes no parameters — it answers about the whole project.", "");

  if (p.members.length > 0) {
    lines.push("Result members: " +
               p.members.map((m) => `\`${m}\``).join(", ") + ".", "");
  }

  const path = QUERY_PATHS[q.id];
  if (path) {
    lines.push("### What it needs", "",
               "From `queryPaths.ts`, which `readinessReport` walks to",
               "produce Q14. **Absence is not an error** — a missing",
               "`required` entity means the answer is impoverished and Q14",
               "says so (§12.9).", "",
               "| Entity | | Why |", "|---|---|---|");
    for (const step of path.steps) {
      lines.push(`| \`${esc(step.entity)}\` | ${esc(step.requirement)} | ` +
                 `${esc(step.purpose)} |`);
    }
    lines.push("");
  }
}

const walkable = queries.filter((q) => QUERY_PATHS[q.id]).length;
lines.push(
  "---", "",
  "## A note on the ones without a resolution path", "",
  `${walkable} of the ${queries.length} declare a path in`,
  "`queryPaths.ts`. The rest are **analytic**: they read whatever exists",
  "and have no readiness semantics of their own beyond those of the",
  "queries they are built from. That is a property of what they do, not",
  "an omission.", "",
  "Generated by `scf-core/scripts/emit_query_reference.mjs`.", "");

const text = lines.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) {
    console.error("[query-reference.md] STALE — run: " +
                  "npm run emit-query-reference");
    process.exit(1);
  }
  console.log(`[query-reference.md] up to date (${queries.length} queries, ` +
              `${walkable} with a resolution path).`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`[query-reference.md] wrote ${queries.length} queries, ` +
              `${walkable} with a resolution path.`);
}
