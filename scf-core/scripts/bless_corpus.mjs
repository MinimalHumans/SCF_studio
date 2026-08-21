#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// bless_corpus.mjs — (re)generate expected classification files for the
// golden corpus. For every corpus script, writes <name>.types.txt beside
// it: one line type per input line. Private-tier expectations live in the
// gitignored private/ directory alongside their scripts.
//
// Usage (from scf-core): npm run bless-corpus [-- --check]
//   --check: exit 1 if any expected file is missing or stale (CI mode for
//            the public tier; private tier is reported, never fatal).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync }
  from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFountain, serialize }
  from "../src/fountain/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..",
                  "corpus");
const check = process.argv.includes("--check");

function* scripts(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* scripts(p);
    else if (/\.(fountain|fountain\.txt)$/.test(entry)) yield p;
  }
}

let stale = 0;
for (const tier of ["public", "private"]) {
  const dir = join(ROOT, tier);
  if (!existsSync(dir)) continue;
  for (const path of scripts(dir)) {
    const text = readFileSync(path, "utf8");
    const doc = parseFountain(text);
    if (serialize(doc) !== text) {
      console.error(`ROUND-TRIP FAILURE: ${path}`);
      process.exit(2);
    }
    const types = doc.lines.map((l) => l.type).join("\n") + "\n";
    const expectedPath = path.replace(/\.(fountain|fountain\.txt)$/,
                                      ".types.txt");
    const current = existsSync(expectedPath)
      ? readFileSync(expectedPath, "utf8") : null;
    if (current === types) continue;
    if (check && tier === "public") {
      console.error(`STALE/MISSING (public tier): ${expectedPath}`);
      stale++;
      continue;
    }
    writeFileSync(expectedPath, types);
    console.log(`${current === null ? "blessed" : "updated"}: ` +
                `${expectedPath.replace(ROOT + "/", "")}`);
  }
}
process.exit(stale > 0 ? 1 : 0);
