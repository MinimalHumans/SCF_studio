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
// that never leave the build machine.
//
// Each package is also tagged with the directly-declared dependency
// (from package.json / Cargo.toml) whose own dependency tree pulled it
// in, so a flat list of hundreds of transitive crates reads as "why is
// this here" instead of an undifferentiated dump. A crate reachable
// from more than one direct dependency is credited to whichever direct
// dependency has the smallest tree — the most specific explanation —
// so a focused dependency like `chrono` isn't swallowed into the one
// huge group (`tauri`) that happens to reach almost everything.
//
// Run this after any dependency change and commit the result; nothing
// regenerates it automatically.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scf-app", "src", "generated", "licenses.json");

/** Assign each node in `graph` (id -> adjacent ids) to the root (one of
 *  `roots`, ids) with the smallest reachable set that reaches it. */
function groupByNarrowestRoot(graph, roots) {
  const reachable = (start) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop();
      for (const next of graph.get(id) ?? []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    return seen;
  };
  const sets = roots.map((id) => ({ id, set: reachable(id) }))
    .sort((a, b) => a.set.size - b.set.size);
  const owner = new Map();
  for (const { id, set } of sets) {
    for (const member of set) if (!owner.has(member)) owner.set(member, id);
  }
  return owner;
}

function npmPackages() {
  const lock = JSON.parse(
    readFileSync(join(ROOT, "scf-app", "package-lock.json"), "utf8"));
  const packages = lock.packages ?? {};
  const nameOf = (key) => key.replace(/^.*node_modules\//, "");

  // Canonical key per name: prefer the top-level (hoisted) location,
  // since that is what a bare dependency name resolves to in practice.
  const canonical = new Map();
  for (const key of Object.keys(packages)) {
    if (key === "" || packages[key].dev === true) continue;
    const depth = key.split("node_modules/").length;
    const name = nameOf(key);
    const existing = canonical.get(name);
    if (existing === undefined || depth < existing.depth) {
      canonical.set(name, { key, depth });
    }
  }

  const graph = new Map();
  for (const [name, { key }] of canonical) {
    const deps = Object.keys(packages[key].dependencies ?? {});
    graph.set(key, deps.map((d) => canonical.get(d)?.key)
      .filter((k) => k !== undefined));
  }

  const rootDeps = Object.keys(packages[""].dependencies ?? {});
  const rootKeys = rootDeps.map((d) => canonical.get(d)?.key)
    .filter((k) => k !== undefined);
  const owner = groupByNarrowestRoot(graph, rootKeys);

  const rows = [];
  for (const [name, { key }] of canonical) {
    const pkg = packages[key];
    const license = typeof pkg.license === "string" ? pkg.license
      : Array.isArray(pkg.license) ? pkg.license.join(" OR ") : "UNKNOWN";
    const ownerKey = owner.get(key);
    rows.push({
      name, version: pkg.version, license,
      group: ownerKey !== undefined ? nameOf(ownerKey) : name,
      isRoot: rootKeys.includes(key),
    });
  }
  return rows.sort((a, b) =>
    a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

function cargoPackages() {
  const manifest = join(ROOT, "scf-app", "src-tauri", "Cargo.toml");
  const raw = execFileSync(
    "cargo", ["metadata", "--format-version=1", "--manifest-path", manifest],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const meta = JSON.parse(raw);
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const graph = new Map(
    meta.resolve.nodes.map((n) => [n.id, n.dependencies]));

  const localId = meta.packages.find((p) => p.source === null)?.id;
  const rootIds = localId !== undefined
    ? (graph.get(localId) ?? []) : [];
  const owner = groupByNarrowestRoot(graph, rootIds);

  const rows = [];
  for (const p of meta.packages) {
    if (p.source === null) continue; // the workspace member itself
    const ownerId = owner.get(p.id);
    const ownerName = ownerId !== undefined ? byId.get(ownerId)?.name : p.name;
    rows.push({
      name: p.name, version: p.version,
      license: p.license ?? (p.license_file !== null
        ? `see ${p.license_file}` : "UNKNOWN"),
      group: ownerName ?? p.name,
      isRoot: rootIds.includes(p.id),
    });
  }
  return rows.sort((a, b) =>
    a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
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
