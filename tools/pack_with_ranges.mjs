#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// pack_with_ranges.mjs — pack or publish a package whose sibling
// dependencies are `file:` paths, with those paths replaced by version
// ranges for the length of the command.
//
//   node ../tools/pack_with_ranges.mjs pack    [npm args…]   npm pack
//   node ../tools/pack_with_ranges.mjs publish [npm args…]   npm publish
//   node ../tools/pack_with_ranges.mjs plan     print the rewrite; exit 1
//                                               if one cannot be made
//   node ../tools/pack_with_ranges.mjs check    exit 1 if a `file:`
//                                               dependency remains
//                                               (the prepublishOnly guard)
//
// WHY. scf-mcp depends on `"@minimalhumans/scf-core": "file:../scf-core"`,
// which is right inside this repository — a change to scf-core is tested
// against scf-mcp at once — and broken in a published package, where no
// `../scf-core` exists. So the repository keeps `file:`, and only what is
// packed says `^<scf-core's version>`.
//
// WHY A WRAPPER AND NOT A prepack HOOK. `npm publish` re-reads package.json
// after packing to build the registry metadata. A hook that rewrote it at
// prepack and restored it at postpack would publish a correct tarball
// with metadata still naming `file:`. Rewriting around the whole command,
// and restoring in a `finally`, has no such window. The `check` mode, run
// as prepublishOnly, makes a bare `npm publish` refuse rather than ship
// the broken form.
//
// Replaced when the repository becomes an npm workspace (release
// checklist §F): a workspace resolves a real range locally, and none of
// this is needed.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [mode, ...npmArgs] = process.argv.slice(2);
const pkgDir = process.cwd();
const manifestPath = join(pkgDir, "package.json");
const original = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(original);
const SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Every `file:` dependency, and the range it becomes. */
function plan() {
  const out = [];
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
      const target = resolve(pkgDir, spec.slice("file:".length));
      let sibling;
      try {
        sibling = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
      } catch {
        out.push({ section, name, spec, error: `no package.json at ${target}` });
        continue;
      }
      if (sibling.name !== name) {
        out.push({ section, name, spec,
                   error: `${target} is ${sibling.name}, not ${name}` });
        continue;
      }
      out.push({ section, name, spec, range: `^${sibling.version}` });
    }
  }
  return out;
}

const steps = plan();
const broken = steps.filter((s) => s.error !== undefined);

if (mode === "check") {
  if (steps.length === 0) process.exit(0);
  console.error(
    `refusing to publish: ${steps.map((s) => `${s.name} is ${s.spec}`).join(", ")}.\n` +
    "A published package cannot resolve a file: path. Use\n" +
    "  npm run publish:release\n" +
    "which publishes with version ranges and restores package.json after.");
  process.exit(1);
}

if (mode === "plan") {
  for (const s of steps) {
    console.log(s.error === undefined
      ? `${s.section}: ${s.name} ${s.spec} -> ${s.range}`
      : `${s.section}: ${s.name} ${s.spec} -> CANNOT: ${s.error}`);
  }
  if (steps.length === 0) console.log("no file: dependencies");
  process.exit(broken.length > 0 ? 1 : 0);
}

if (mode !== "pack" && mode !== "publish") {
  console.error("usage: pack_with_ranges.mjs pack|publish|plan|check [npm args…]");
  process.exit(2);
}
if (broken.length > 0) {
  for (const s of broken) console.error(`cannot rewrite ${s.name}: ${s.error}`);
  process.exit(1);
}

const rewritten = structuredClone(manifest);
for (const s of steps) rewritten[s.section][s.name] = s.range;

let status = 1;
try {
  writeFileSync(manifestPath, JSON.stringify(rewritten, null, 2) + "\n");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // A shell on Windows: Node will not start a .cmd without one
  // (CVE-2024-27980). The arguments are ours or the caller's own.
  const result = spawnSync(npm, [mode, ...npmArgs],
    { stdio: "inherit", shell: process.platform === "win32" });
  status = result.status ?? 1;
} finally {
  // Byte-for-byte what was there, whatever npm did.
  writeFileSync(manifestPath, original);
}
process.exit(status);
