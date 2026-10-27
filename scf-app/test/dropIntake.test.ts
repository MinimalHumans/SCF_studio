// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * dropIntake.ts — addressing real, absolute paths from a drop against
 * the asset root (file-management-plan.md Step 3): a file under the
 * root becomes a candidate, a folder is reported rather than walked,
 * and a path outside the root is reported by name.
 */

import { describe, expect, test, vi } from "vitest";
import { posixPaths } from "@scf-host/paths.ts";

const dirs = new Set(["/project/sub"]);
const stats = new Map<string, { size: number; modified: string }>([
  ["/project/a.png", { size: 10, modified: "t1" }],
]);

vi.mock("../src/host/tauriPlatform.ts", () => ({
  createTauriPlatform: () => Promise.resolve({
    paths: posixPaths,
    stat: (path: string) => Promise.resolve(stats.get(path) ?? null),
    readDir: (path: string) => dirs.has(path)
      ? Promise.resolve([]) : Promise.reject(new Error("not a directory")),
  }),
}));

const { addressPaths } = await import("../src/files/dropIntake.ts");

const ROOT = "/project";

describe("addressPaths", () => {
  test("a file under the root becomes a candidate", async () => {
    const intake = await addressPaths(ROOT, ["/project/a.png"]);
    expect(intake.candidates).toEqual([{
      identifier: "@project/a.png", name: "a.png",
      sizeBytes: 10, mtime: "t1",
    }]);
    expect(intake.outside).toEqual([]);
    expect(intake.folders).toEqual([]);
  });

  test("a folder is reported, not walked", async () => {
    const intake = await addressPaths(ROOT, ["/project/sub"]);
    expect(intake.folders).toEqual(["sub"]);
    expect(intake.candidates).toEqual([]);
  });

  test("a path outside the root is reported by name", async () => {
    const intake = await addressPaths(ROOT, ["/elsewhere/b.png"]);
    expect(intake.outside).toEqual(["b.png"]);
    expect(intake.candidates).toEqual([]);
  });

  test("a mixed drop sorts each path into its own bucket", async () => {
    const intake = await addressPaths(ROOT, [
      "/project/a.png", "/project/sub", "/elsewhere/b.png",
    ]);
    expect(intake.candidates.map((c) => c.name)).toEqual(["a.png"]);
    expect(intake.folders).toEqual(["sub"]);
    expect(intake.outside).toEqual(["b.png"]);
  });
});
