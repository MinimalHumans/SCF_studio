// SPDX-License-Identifier: Apache-2.0
/**
 * buildSidecar.mjs — the host as one executable, for the desktop app.
 *
 * The app's window is a client of `scf-host` exactly as it is in the
 * browser; the desktop shell only has to start one. So the host is
 * bundled (esbuild, CommonJS, which is what a Node single executable
 * runs) and injected into a copy of this Node binary, and the result
 * goes where Tauri's `externalBin` looks for it:
 * `src-tauri/binaries/scf-host-<target triple>[.exe]`.
 *
 *   node tools/buildSidecar.mjs
 *
 * The Node running this is the Node that ships, so it must be one with
 * `node:sqlite` (22.5+) — the same floor as the host itself.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const work = join(app, "src-tauri", "target", "sidecar");
const binaries = join(app, "src-tauri", "binaries");

const triple = /^host: (\S+)$/m.exec(
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (triple === undefined) throw new Error("rustc -vV named no host triple");
const exe = process.platform === "win32" ? ".exe" : "";
const out = join(binaries, `scf-host-${triple}${exe}`);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(binaries, { recursive: true });

const bundle = join(work, "scf-host.cjs");
await build({
  entryPoints: [resolve(app, "../scf-host/src/serve.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  conditions: ["scf-source"],
  // `ws` tries these and does without; they are native and not shipped.
  external: ["bufferutil", "utf-8-validate"],
  // scf-core loads `node:sqlite` through `createRequire(import.meta.url)`,
  // and CommonJS has no `import.meta`.
  define: { "import.meta.url": "__scfImportMetaUrl" },
  banner: {
    js: "const __scfImportMetaUrl = " +
        "require('node:url').pathToFileURL(__filename).href;",
  },
  logLevel: "warning",
});

const blob = join(work, "scf-host.blob");
const config = join(work, "sea-config.json");
writeFileSync(config, JSON.stringify({
  main: bundle, output: blob, disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ["--experimental-sea-config", config],
             { stdio: "inherit" });

copyFileSync(process.execPath, out);
const mac = process.platform === "darwin";
if (mac) execFileSync("codesign", ["--remove-signature", out]);
execFileSync(process.execPath, [
  join(app, "node_modules", "postject", "dist", "cli.js"),
  out, "NODE_SEA_BLOB", blob,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(mac ? ["--macho-segment-name", "NODE_SEA"] : []),
], { stdio: "inherit" });
if (mac) execFileSync("codesign", ["--sign", "-", out]);

console.log(`sidecar: ${out}`);
