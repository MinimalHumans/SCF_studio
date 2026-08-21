// SPDX-License-Identifier: Apache-2.0
/**
 * pack_test.mjs — prove a consumer can actually use this package.
 *
 * Every other check in this repository runs INSIDE the repository, where
 * the source is on disk, the tsconfig is ours, and Node is started with
 * type stripping enabled. None of that is true for a consumer, and the
 * gap between the two is where packaging bugs live: this repository has
 * already shipped a CI workflow that passed everywhere except on a
 * runner starting from nothing.
 *
 * So this builds a real tarball with `npm pack`, installs it into a
 * throwaway project, and checks three things that fail for different
 * reasons:
 *
 *   1. A plain JavaScript consumer can import and call something.
 *   2. A TYPESCRIPT consumer that EMITS JAVASCRIPT can compile against
 *      it. This is the one that mattered: before this round the package
 *      exported `./src/index.ts` directly, whose internal imports carry
 *      `.ts` extensions, so any consumer whose tsc emits anything failed
 *      with TS5097 on every import. The only consumers who could use the
 *      package were ones that never compiled.
 *   3. `scf-check` runs from the installed bin, on a real .scf, with no
 *      flags — which is what `npx scf-check` would do.
 *
 *   node --experimental-strip-types scripts/pack_test.mjs
 *   node --experimental-strip-types scripts/pack_test.mjs --keep
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const FIXTURE = resolve(PKG, "..", "fixtures", "hollow_creek.scf");

const KEEP = process.argv.includes("--keep");
const sandbox = mkdtempSync(join(tmpdir(), "scf-pack-"));

const run = (cmd, args, cwd, label) => {
  try {
    return execFileSync(cmd, args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
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
if (!report.includes("no findings")) {
  console.error("[pack-test] scf-check did not report a clean fixture:");
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
