// SPDX-License-Identifier: Apache-2.0
/**
 * scf-core's source must load under Node's type stripping.
 *
 * The package's scripts (`scripts/scf_check.mjs`, the emitters) run
 * scf-core from `src/` with no build, which only works while the source
 * uses nothing that needs compiling: no parameter properties
 * (`constructor(readonly x)`), enums, namespaces or decorators. `tsc`
 * accepts all of those, so it takes a real load to notice one.
 */

import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
const SRC = new URL("../src/", import.meta.url);

function load(entry: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [
    "--experimental-strip-types", "--no-warnings",
    "--conditions=scf-source", "--input-type=module",
    "-e", `await import(${JSON.stringify(new URL(entry, SRC).href)});`,
  ], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stderr: r.stderr };
}

describe("scf-core loads without a build", () => {
  test.each(["index.ts", "node.ts"])("%s", (entry) => {
    const r = load(entry);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  }, 90_000);
});
