// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * pathIdentifier.ts — turning a real absolute path (from a native
 * dialog or a drop) into a project identifier, by stripping the asset
 * root's prefix. No traversal, no handle: just string arithmetic over
 * a real `HostPlatform.paths`.
 */

import { describe, expect, test } from "vitest";
import { posixPaths } from "@scf-host/paths.ts";
import type { HostPlatform } from "@scf-host/platform.ts";
import { candidateFor, isOutside, relativeToRoot }
  from "../src/files/pathIdentifier.ts";

const stats = new Map<string, { size: number; modified: string }>();

const platform = {
  paths: posixPaths,
  stat: (path: string) => Promise.resolve(stats.get(path) ?? null),
} as unknown as HostPlatform;

const ROOT = "/project";

test("relativeToRoot strips the root, with no leading separator", () => {
  expect(relativeToRoot(platform, ROOT, "/project/a/b.png")).toBe("a/b.png");
  expect(relativeToRoot(platform, ROOT, "/project/b.png")).toBe("b.png");
});

test("relativeToRoot is null for a path outside the root", () => {
  expect(relativeToRoot(platform, ROOT, "/elsewhere/b.png")).toBeNull();
});

describe("candidateFor", () => {
  test("a file under the root becomes an @project identifier", async () => {
    stats.set("/project/a/b.png", { size: 10, modified: "2026-01-01" });
    const c = await candidateFor(platform, ROOT, "/project/a/b.png");
    expect(isOutside(c)).toBe(false);
    if (!isOutside(c)) {
      expect(c.identifier).toBe("@project/a/b.png");
      expect(c.name).toBe("b.png");
      expect(c.sizeBytes).toBe(10);
      expect(c.mtime).toBe("2026-01-01");
    }
  });

  test("a file outside the root is reported by name, not addressed",
      async () => {
    const c = await candidateFor(platform, ROOT, "/elsewhere/b.png");
    expect(isOutside(c)).toBe(true);
    if (isOutside(c)) expect(c.outside).toBe("b.png");
  });

  test("a file that cannot be stat'd still gets an identifier, with " +
      "no size", async () => {
    const c = await candidateFor(platform, ROOT, "/project/gone.png");
    expect(isOutside(c)).toBe(false);
    if (!isOutside(c)) {
      expect(c.identifier).toBe("@project/gone.png");
      expect(c.sizeBytes).toBeNull();
      expect(c.mtime).toBeNull();
    }
  });
});
