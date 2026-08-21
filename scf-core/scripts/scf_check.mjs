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
import { loadRegistry, renderReport, validationReport }
  from "@minimalhumans/scf-core";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `scf-check — validate an SCF document

  scf-check [options] FILE...

  --json         emit the serialised report instead of prose
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
const quiet = argv.includes("--quiet");
const timestamp = argv.includes("--timestamp");
const paths = argv.filter((a) => !a.startsWith("--"));

if (paths.length === 0) {
  process.stderr.write("scf-check: no input files\n");
  process.exit(2);
}

const registry = loadRegistry(JSON.parse(readFileSync(
  join(HERE, "..", "registry", "registry.json"), "utf8")));

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

if (asJson && !quiet) {
  // One report for one file, an array for several. A caller passing one
  // path should not have to unwrap.
  process.stdout.write(
    `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`);
}

process.exit(worstExit);
