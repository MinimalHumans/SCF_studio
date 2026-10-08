// SPDX-License-Identifier: Apache-2.0
/**
 * pack_test.mjs — prove a consumer can actually use this package.
 *
 * Every other check in this repository runs INSIDE the repository,
 * where the source is on disk, the tsconfig is ours, and Node is started
 * with type stripping enabled. None of that is true for a consumer, and
 * the gap between the two is where packaging bugs live — a check can
 * pass everywhere except on a runner starting from nothing.
 *
 * So this builds a real tarball with `npm pack`, installs it into a
 * throwaway project, and checks three things that fail for different
 * reasons:
 *
 *   1. A plain JavaScript consumer can import and call something.
 *   2. A TYPESCRIPT consumer that EMITS JAVASCRIPT can compile against
 *      it. Exporting `./src/index.ts` directly passes every check here
 *      and fails TS5097 on every import for a consumer whose tsc emits
 *      anything, because the internal imports carry `.ts` extensions.
 *   3. `scf-check` runs from the installed bin, on a real .scf, with no
 *      flags — which is what `npx scf-check` would do.
 *
 *   node --experimental-strip-types scripts/pack_test.mjs
 *   node --experimental-strip-types scripts/pack_test.mjs --keep
 */

import { execFileSync, execSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const FIXTURE = resolve(PKG, "..", "fixtures", "hollow_creek.scf");

const KEEP = process.argv.includes("--keep");
const sandbox = mkdtempSync(join(tmpdir(), "scf-pack-"));

/**
 * On Windows `npm`, `npx` and an installed bin are `.cmd` launchers, and
 * Node refuses to start a `.cmd` or `.bat` without a shell (the fix for
 * CVE-2024-27980), failing with EINVAL. Those go through the shell, and
 * with a shell nothing escapes the arguments, so each is quoted: the
 * sandbox lives under the user's temp folder, whose path may hold a
 * space. Everything else is started directly, as on every other OS.
 */
const isWindowsLauncher = (cmd) =>
  process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
const quoted = (s) =>
  /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

const run = (cmd, args, cwd, label) => {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    // One command line, quoted here, rather than an argument list Node
    // would join unescaped (DEP0190).
    return isWindowsLauncher(cmd)
      ? execSync([cmd, ...args].map(quoted).join(" "), options)
      : execFileSync(cmd, args, options);
  } catch (err) {
    console.error(`\n[pack-test] FAILED: ${label}\n`);
    console.error(err.stdout ?? "");
    console.error(err.stderr ?? "");
    if (!KEEP) rmSync(sandbox, { recursive: true, force: true });
    process.exit(1);
  }
};

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

console.log("[pack-test] building and packing…");
run(npm, ["run", "build"], PKG, "npm run build");
const packed = run(npm, ["pack", "--pack-destination", sandbox, "--silent"],
                   PKG, "npm pack").trim().split("\n").pop().trim();
const tarball = join(sandbox, packed);

console.log("[pack-test] installing into a throwaway project…");
const consumer = join(sandbox, "consumer");
run(npm, ["init", "-y"], sandbox, "npm init");
// npm init writes to the sandbox root; give the consumer its own dir.
run(npm, ["init", "-y"], sandbox, "npm init");
writeFileSync(join(sandbox, "package.json"),
  JSON.stringify({ name: "scf-pack-consumer", private: true, type: "module" },
                 null, 2));
run(npm, ["install", tarball, "--no-audit", "--no-fund"], sandbox,
    "npm install <tarball>");
run(npm, ["install", "-D", "typescript", "--no-audit", "--no-fund"], sandbox,
    "npm install typescript");

// ---- 0. the licence travels with the package ----------------------
// Apache-2.0 §4. `files` listed LICENSE and NOTICE while neither existed
// in scf-core/, and npm packed 224 files and no licence without a word.
// The prepack hook copies the root's in; this is what notices if it
// stops. Byte-equal, so a stale or hand-edited copy fails too.
{
  const installed = join(sandbox, "node_modules", "@minimalhumans", "scf-core");
  for (const name of ["LICENSE", "NOTICE"]) {
    const got = join(installed, name);
    const want = join(PKG, "..", name);
    if (!existsSync(got) ||
        !readFileSync(got).equals(readFileSync(want))) {
      console.error(`\n[pack-test] FAILED: ${name} is ` +
        `${existsSync(got) ? "not the repository's" : "missing from the tarball"}` +
        " (Apache-2.0 §4 requires it in every distribution)");
      if (!KEEP) rmSync(sandbox, { recursive: true, force: true });
      process.exit(1);
    }
  }
  console.log("  LICENSE and NOTICE ship with the package");
}

// ---- 1. a plain JavaScript consumer -------------------------------
writeFileSync(join(sandbox, "smoke.mjs"), `
import { loadRegistry, SCF_APPLICATION_ID } from "@minimalhumans/scf-core";
if (typeof loadRegistry !== "function") throw new Error("loadRegistry missing");
if (!SCF_APPLICATION_ID) throw new Error("SCF_APPLICATION_ID missing");
console.log("  js consumer ok");
`);
process.stdout.write(run(process.execPath, ["smoke.mjs"], sandbox,
                         "javascript consumer imports the package"));

// ---- 2. a TypeScript consumer that EMITS --------------------------
// No allowImportingTsExtensions, and outDir set, deliberately: this is
// an ordinary downstream project, and it is the configuration that
// failed before the package was built rather than shipped as source.
writeFileSync(join(sandbox, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, outDir: "out", skipLibCheck: false,
  },
  include: ["app.ts"],
}, null, 2));
writeFileSync(join(sandbox, "app.ts"), `
import {
  loadRegistry, collectFindings, type Registry, type RegistryJson,
} from "@minimalhumans/scf-core";

// Named type imports, not just values: types are the half a consumer
// cannot get from a runtime import, and the half that only exists if
// declarations were actually emitted.
export function load(json: RegistryJson): Registry {
  return loadRegistry(json);
}
export const findings: typeof collectFindings = collectFindings;
`);
run(npx, ["tsc"], sandbox, "typescript consumer compiles and emits");
console.log("  ts consumer ok (emitting, skipLibCheck off)");

// ---- 3. the installed bin -----------------------------------------
copyFileSync(FIXTURE, join(sandbox, "hollow_creek.scf"));
const report = run(join(sandbox, "node_modules", ".bin",
                        process.platform === "win32"
                          ? "scf-check.cmd" : "scf-check"),
                   ["hollow_creek.scf"], sandbox,
                   "installed scf-check runs with no flags");
// What this step is about is that the INSTALLED BIN RUNS: resolves its
// imports from the package, opens a real .scf, and reports on it. It is
// not about what the fixture happens to contain.
//
// Asserting `no findings` here would couple a packaging test to the
// fixture's contents, and the fixture carries a deliberate `info`
// finding. This file is a script rather than a test and does not run
// under vitest, so it is easily missed when the fixture changes.
const wanted = ["hollow_creek.scf", "(schema", "0 error", "0 warning"];
const missing = wanted.filter((s) => !report.includes(s));
if (missing.length > 0) {
  console.error("[pack-test] the installed scf-check did not report as "
              + `expected — missing ${missing.join(", ")}:`);
  console.error(report);
  process.exit(1);
}
console.log("  scf-check ok");

if (KEEP) {
  console.log(`\n[pack-test] sandbox kept at ${sandbox}`);
} else {
  rmSync(sandbox, { recursive: true, force: true });
}
console.log("\n[pack-test] a consumer can install, import, compile and run.");
