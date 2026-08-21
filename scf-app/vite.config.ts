// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Build identity, injected at build time.
 *
 * "Which build am I looking at" is the first question anyone asks about
 * a bug report, and until now the app could not answer it. The version
 * comes from package.json; the commit is best-effort, because a build
 * from a tarball has no git and that is not a reason to fail.
 */
const pkg = JSON.parse(
  readFileSync(resolve(here, "package.json"), "utf8")) as {
    version: string;
  };

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// scf-core is consumed as TypeScript source via alias — no build step for
// the core package until it publishes (design decision 6).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@scf-core": resolve(here, "../scf-core/src"),
      "@registry": resolve(here, "../scf-core/registry"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
});
