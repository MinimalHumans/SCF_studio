#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// legal_files.mjs — put the repository's LICENSE and NOTICE into a package
// for the length of an `npm pack` / `npm publish`, and take them out again.
//
//   node ../tools/legal_files.mjs copy     (prepack, run from the package)
//   node ../tools/legal_files.mjs remove   (postpack)
//
// Apache-2.0 §4 requires both to travel with every distribution. npm only
// ships files inside the package directory, and the canonical copies live
// once, at the repository root — so `files` listed LICENSE and NOTICE and
// the tarball carried neither. Copying at pack time keeps one source of
// truth; the copies are gitignored, and `pack-test` asserts they arrive.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["LICENSE", "NOTICE"];
const mode = process.argv[2];
const pkg = process.cwd();

if (mode !== "copy" && mode !== "remove") {
  console.error("usage: legal_files.mjs copy|remove (from a package directory)");
  process.exit(2);
}
if (pkg === ROOT) {
  console.error("legal_files.mjs: run from a package directory, not the root");
  process.exit(2);
}
for (const name of FILES) {
  const target = join(pkg, name);
  if (mode === "copy") {
    const source = join(ROOT, name);
    if (!existsSync(source)) {
      console.error(`legal_files.mjs: ${source} is missing`);
      process.exit(1);
    }
    copyFileSync(source, target);
  } else {
    rmSync(target, { force: true });
  }
}
