#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// gen_licenses.mjs — regenerate the third-party license manifest the
// Open Source Licenses dialog reads.
//
//   node tools/gen_licenses.mjs   (from the repository root)
//
// Pulls from the two sources that already carry license data, rather
// than installing a dedicated scanner: npm's own lockfile (v3 records
// a `license` field per resolved package) and `cargo metadata`, which
// carries the same for every crate. Production deps only — a shipped
// app's third-party notices cover what it ships, not devDependencies
// that never leave the build machine. Run this after any dependency
// change and commit the result; nothing regenerates it automatically.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scf-app", "src", "generated", "licenses.json");

function npmPackages() {
  const lock = JSON.parse(
    readFileSync(join(ROOT, "scf-app", "package-lock.json"), "utf8"));
  const seen = new Map();
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    if (key === "" || pkg.dev === true) continue;
    const name = key.replace(/^.*node_modules\//, "");
    const license = typeof pkg.license === "string" ? pkg.license
      : Array.isArray(pkg.license) ? pkg.license.join(" OR ") : "UNKNOWN";
    // The same package can resolve at more than one version; keep one
    // row per name, since the license rarely changes between versions
    // and the dialog lists packages, not the full dependency graph.
    if (!seen.has(name)) seen.set(name, { name, version: pkg.version, license });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function cargoPackages() {
  const manifest = join(ROOT, "scf-app", "src-tauri", "Cargo.toml");
  const raw = execFileSync(
    "cargo", ["metadata", "--format-version=1", "--manifest-path", manifest],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const meta = JSON.parse(raw);
  return meta.packages
    .filter((p) => p.source !== null) // drop workspace members (our own code)
    .map((p) => ({
      name: p.name, version: p.version,
      license: p.license ?? (p.license_file !== null
        ? `see ${p.license_file}` : "UNKNOWN"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  npm: npmPackages(),
  cargo: cargoPackages(),
};
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `wrote ${String(manifest.npm.length)} npm and ` +
  `${String(manifest.cargo.length)} cargo packages to ${OUT}`);
