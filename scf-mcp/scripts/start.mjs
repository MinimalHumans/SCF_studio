#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * start.mjs — run scf-mcp from source, with no build.
 *
 * Point an MCP client (Claude Desktop, etc.) at this file instead of
 * `dist/server.js`. It runs `src/server.ts` directly under Node's type
 * stripping, and resolves `@minimalhumans/scf-core` to scf-core's
 * `src/` through the `scf-source` export condition rather than to its
 * `dist/`. Nothing is compiled, so nothing can be missing or stale
 * after a fresh clone or a `git pull`.
 *
 * What it needs is `npm ci` in scf-mcp (once). If that is missing it
 * says so and exits; it does not install anything itself.
 *
 * stdout belongs to the MCP protocol. Every message written here goes
 * to stderr, which clients surface in their server logs.
 *
 * The published package still runs from dist (`bin` in package.json);
 * this is the development entry point.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const CORE = join(PKG, "..", "scf-core");

function fail(message, hint) {
  process.stderr.write(`scf-mcp: ${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(1);
}

// Node needs type stripping: behind a flag from 22.6, on by default from
// 22.18 (and 23.6). Older than 22.6 cannot run the source at all.
const [major, minor] = process.versions.node.split(".").map(Number);
const hasStripTypes = major > 23 || (major === 23 && minor >= 6) ||
  (major === 22 && minor >= 18);
if (major < 22 || (major === 22 && minor < 6)) {
  fail(`Node ${process.versions.node} cannot run TypeScript source; ` +
    "Node 22.6 or newer is required.",
    `Running: ${process.execPath}`);
}

if (!existsSync(join(CORE, "src", "index.ts"))) {
  fail(`scf-core source not found at ${CORE}.`,
    "scf-mcp expects scf-core as a sibling directory in the same checkout.");
}
if (!existsSync(join(PKG, "node_modules", "@modelcontextprotocol"))) {
  fail("dependencies are not installed.",
    `Run: cd ${PKG} && npm ci`);
}
if (!existsSync(join(PKG, "node_modules", "@minimalhumans", "scf-core"))) {
  fail("scf-core is not linked into node_modules.",
    `Run: cd ${PKG} && npm ci`);
}

const args = [
  ...(hasStripTypes ? [] : ["--experimental-strip-types"]),
  "--conditions=scf-source",
  // Type stripping and node:sqlite each print an ExperimentalWarning;
  // they are noise in a client's log.
  "--disable-warning=ExperimentalWarning",
  join(PKG, "src", "server.ts"),
  ...process.argv.slice(2),
];

// Same Node that is running this script, so a client configured with an
// absolute `command` gets the version it chose. stdio is inherited: the
// child speaks MCP on the client's own pipes.
const child = spawn(process.execPath, args, { stdio: "inherit" });

// A client closes a server by signal. Pass it on, or the child outlives it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (err) => fail(`could not start Node: ${err.message}`));
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
