#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * scf-check — validate a .scf and report findings. Spec §9.
 *
 * The point of this tool is that it is not the editor. Anyone with a
 * `.scf` can run it and get the same answer, which is what turns a
 * conformance claim from an assertion into something a stranger can
 * test.
 *
 * It deliberately does very little of its own thinking: everything it
 * reports comes from `collectFindings`, the same function the editor's
 * panels and the test suite use. A validator that had its own opinion
 * about what is wrong with a file would eventually disagree with the
 * implementation it is supposed to be checking.
 *
 *   scf-check FILE...            human-readable report
 *   scf-check --json FILE...     the serialised report (spec §9.6)
 *   scf-check --quiet FILE...    exit code only
 *   scf-check --cut FILE...      list the cut rows (spec §6.6.2)
 *
 * `--cut` is a separate path from the report on purpose. §6.6.2 says an
 * implementation offering a view of cut rows SHOULD keep it distinct
 * from the resolvers, so the two cannot be confused at a call site — and
 * a cut row is not a finding: it is a deliberate authorial act, not
 * something wrong with the file.
 *
 * Exit codes:
 *   0  no errors  (warnings and info do not fail — spec §9.1: findings
 *                  are reported, never a reason to refuse a file)
 *   1  at least one error finding
 *   2  the file could not be read at all
 *
 * The 1/2 split matters. A file with errors is still a file SCF read
 * and understood; a file it could not open is a different kind of
 * problem, and a CI job should be able to tell them apart.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// SELF-REFERENCE, not a relative path into src/. Two reasons, and the
// first is not a preference:
//
// Node REFUSES to strip types for files under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Importing "../src/*.ts"
// works when this script is run from a checkout and fails the moment the
// package is installed, which is the only way anyone else will ever run
// it. `npx scf-check` was broken by exactly this.
//
// Second, resolving through the package's own `exports` means this CLI
// consumes the library the way a stranger does. If it ever needs
// something the entry points do not expose, that fails here rather than
// in somebody else's project.
import { loadRegistry, renderReport, rowsIncludingCut, validationReport }
  from "@minimalhumans/scf-core";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `scf-check — validate an SCF document

  scf-check [options] FILE...

  --json         emit the serialised report instead of prose
  --cut          list rows marked cut instead of validating (spec §6.6.2)
  --timestamp    include generatedAt (off by default: reports stay
                 diffable between runs)
  --quiet        no output; exit code only
  --help         this

exit: 0 clean of errors, 1 errors found, 2 unreadable
`;

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  process.stdout.write(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
}

const asJson = argv.includes("--json");
const cutList = argv.includes("--cut");
const quiet = argv.includes("--quiet");
const timestamp = argv.includes("--timestamp");
const paths = argv.filter((a) => !a.startsWith("--"));

if (paths.length === 0) {
  process.stderr.write("scf-check: no input files\n");
  process.exit(2);
}

const registry = loadRegistry(JSON.parse(readFileSync(
  join(HERE, "..", "registry", "registry.json"), "utf8")));

/**
 * Every cut row in the file, by table.
 *
 * Uses `rowsIncludingCut` — the one function in the library that reads
 * past §6.6.1's exclusion — and filters to the cut ones. Only entities
 * the registry says carry `lifecycle_status` are asked: eleven of
 * thirteen link entities do not, and a cut link is a state they cannot
 * be in.
 *
 * Row identity survives being cut (§6.1), so each row is named by uuid.
 * That is what makes this a usable audit view rather than a curiosity:
 * a uuid here is the same uuid that comes back if the row is restored.
 */
async function collectCut(exec, reg) {
  const out = [];
  for (const [name, entity] of reg.entities) {
    if (!entity.hasLifecycleStatus) continue;
    const rows = (await rowsIncludingCut(exec, name))
      .filter((r) => r["lifecycle_status"] === "cut");
    if (rows.length === 0) continue;
    out.push({
      entity: name,
      count: rows.length,
      rows: rows.map((r) => ({
        uuid: r["uuid"] ?? null,
        name: entity.nameField ? (r[entity.nameField] ?? null) : null,
      })),
    });
  }
  return out.sort((a, b) => a.entity.localeCompare(b.entity));
}

function renderCut(path, cut) {
  const total = cut.reduce((n, e) => n + e.count, 0);
  if (total === 0) {
    return `${path}\n\n  no cut rows\n\n`;
  }
  const lines = [path, "", `  ${String(total)} cut row(s) in ` +
                           `${String(cut.length)} table(s)`, ""];
  for (const entry of cut) {
    lines.push(`  ${entry.entity} (${String(entry.count)})`);
    for (const row of entry.rows) {
      lines.push(`    ${String(row.uuid)}` +
                 (row.name === null ? "" : `  ${String(row.name)}`));
    }
    lines.push("");
  }
  lines.push("  Cut rows appear in no query result (spec §6.6.1). They " +
             "keep their",
             "  identity and restoring one restores the same row (§6.1).",
             "");
  return lines.join("\n");
}

let worstExit = 0;
const reports = [];

for (const path of paths) {
  let db;
  try {
    db = openNodeDatabase(path, { readOnly: true });
  } catch (err) {
    // Unreadable is not a finding. A finding is something SCF has an
    // opinion about; this is a file it never got to look at.
    if (!quiet) {
      process.stderr.write(
        `scf-check: cannot open ${path}: ${String(err)}\n`);
    }
    worstExit = 2;
    continue;
  }

  try {
    if (cutList) {
      const cut = await collectCut(db.exec, registry);
      if (!quiet) {
        process.stdout.write(asJson
          ? `${JSON.stringify({ source: path, cut }, null, 2)}\n`
          : renderCut(path, cut));
      }
      continue;
    }

    const report = await validationReport(db.exec, registry, {
      source: path, timestamp,
    });
    reports.push(report);
    if (!report.clean && worstExit < 1) worstExit = 1;
    if (!quiet && !asJson) process.stdout.write(renderReport(report));
  } catch (err) {
    if (!quiet) {
      process.stderr.write(
        `scf-check: ${path} could not be read as SCF: ${String(err)}\n`);
    }
    worstExit = 2;
  } finally {
    db.close();
  }
}

if (asJson && !quiet && !cutList) {
  // One report for one file, an array for several. A caller passing one
  // path should not have to unwrap.
  process.stdout.write(
    `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`);
}

process.exit(worstExit);
