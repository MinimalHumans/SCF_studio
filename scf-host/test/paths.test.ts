// SPDX-License-Identifier: Apache-2.0
/**
 * paths.ts spells paths as node:path would, for the paths the host
 * holds: absolute, already resolved.
 */

import { posix, win32 } from "node:path";
import { describe, expect, test } from "vitest";
import { posixPaths, windowsPaths } from "../src/paths.ts";

// Already in one spelling, as `real` hands them over: node:path's
// dirname does not normalise, so only these compare.
const WINDOWS = [
  "C:\\", "C:\\films", "C:\\films\\", "C:\\films\\a.scf",
  "D:\\Deep\\er\\x", "\\\\srv\\share\\films\\a.scf",
];
const POSIX = ["/", "/films", "/films/", "/films/a.scf"];

describe("windows", () => {
  test.each(WINDOWS)("dirname and basename of %s", (p) => {
    expect(windowsPaths.dirname(p)).toBe(win32.dirname(p));
    expect(windowsPaths.basename(p)).toBe(win32.basename(p));
  });
  test("join", () => {
    expect(windowsPaths.join("C:\\films", "a.scf")).toBe("C:\\films\\a.scf");
    expect(windowsPaths.join("C:\\", "a.scf")).toBe("C:\\a.scf");
    expect(windowsPaths.join("C:\\films\\", "x", "a.scf"))
      .toBe(win32.join("C:\\films\\", "x", "a.scf"));
    expect(windowsPaths.join("\\\\srv\\share\\", "a.scf"))
      .toBe(win32.join("\\\\srv\\share\\", "a.scf"));
  });
  test("a share's root is its own parent", () => {
    expect(windowsPaths.dirname("\\\\srv\\share\\"))
      .toBe("\\\\srv\\share\\");
  });
  test("forward slashes and repeats come out as one backslash", () => {
    expect(windowsPaths.dirname("C:/films//b/c.scf")).toBe("C:\\films\\b");
  });
  test("within ignores case and needs a whole name", () => {
    expect(windowsPaths.within("C:\\Films", "c:\\films\\a.scf")).toBe(true);
    expect(windowsPaths.within("C:\\films", "C:\\films")).toBe(true);
    expect(windowsPaths.within("C:\\films", "C:\\films2\\a.scf")).toBe(false);
    expect(windowsPaths.within("C:\\", "C:\\a\\b")).toBe(true);
    expect(windowsPaths.within("C:\\films", "D:\\films")).toBe(false);
  });
});

describe("posix", () => {
  test.each(POSIX)("dirname and basename of %s", (p) => {
    expect(posixPaths.dirname(p)).toBe(posix.dirname(p));
    expect(posixPaths.basename(p)).toBe(posix.basename(p));
  });
  test("join", () => {
    expect(posixPaths.join("/films", "a.scf")).toBe("/films/a.scf");
    expect(posixPaths.join("/", "a.scf")).toBe("/a.scf");
    expect(posixPaths.dirname("/a//b///c.scf")).toBe("/a/b");
  });
  test("within minds case and needs a whole name", () => {
    expect(posixPaths.within("/films", "/films/a.scf")).toBe(true);
    expect(posixPaths.within("/Films", "/films/a.scf")).toBe(false);
    expect(posixPaths.within("/films", "/films2/a.scf")).toBe(false);
    expect(posixPaths.within("/", "/a")).toBe(true);
  });
});

