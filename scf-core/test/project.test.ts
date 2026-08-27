// SPDX-License-Identifier: Apache-2.0
/**
 * project.test.ts — the folder-is-a-project rule.
 *
 * The interesting cases are the malformed ones: the rule must never
 * guess which of two .scf files was meant, and must never mistake a
 * SQLite sidecar for a project.
 */

import { describe, expect, test } from "vitest";
import { chooseProjectFile, classifyRootPairing, isProjectFile }
  from "../src/project.ts";

describe("isProjectFile", () => {
  test("accepts a .scf in any case", () => {
    expect(isProjectFile("hollow_creek.scf")).toBe(true);
    expect(isProjectFile("Hollow Creek.SCF")).toBe(true);
  });

  test("rejects sidecars, dotfiles and everything else", () => {
    expect(isProjectFile("hollow_creek.scf-wal")).toBe(false);
    expect(isProjectFile("hollow_creek.scf-shm")).toBe(false);
    expect(isProjectFile("hollow_creek.scf-journal")).toBe(false);
    expect(isProjectFile(".hollow_creek.scf")).toBe(false);
    expect(isProjectFile("notes.md")).toBe(false);
    expect(isProjectFile("scf")).toBe(false);
  });
});

describe("chooseProjectFile", () => {
  test("exactly one .scf is the project", () => {
    const pick = chooseProjectFile([
      "hollow_creek.scf", "assets", "notes.md",
    ]);
    expect(pick.file).toBe("hollow_creek.scf");
    expect(pick.findings).toEqual([]);
  });

  test("no .scf is reported, not thrown", () => {
    const pick = chooseProjectFile(["assets", "notes.md"]);
    expect(pick.file).toBeNull();
    expect(pick.findings.map((f) => f.kind)).toEqual(["no-project-file"]);
  });

  test("several .scf files never resolve to a guess", () => {
    const pick = chooseProjectFile(["b.scf", "a.scf"]);
    expect(pick.file).toBeNull();
    expect(pick.candidates).toEqual(["a.scf", "b.scf"]);
    expect(pick.findings.map((f) => f.kind))
      .toEqual(["several-project-files"]);
  });

  test("a sidecar is a warning but does not block a clean pick", () => {
    const pick = chooseProjectFile([
      "hollow_creek.scf", "hollow_creek.scf-wal",
    ]);
    expect(pick.file).toBe("hollow_creek.scf");
    expect(pick.findings.map((f) => f.kind)).toEqual(["sidecar-present"]);
  });

  test("an empty folder is a finding, not a crash", () => {
    expect(chooseProjectFile([]).file).toBeNull();
  });

  test("a fruitless scan reports what it did see", () => {
    const pick = chooseProjectFile(["notes.md", "shotlist.csv"]);
    expect(pick.seen).toEqual(["notes.md", "shotlist.csv"]);
    expect(pick.findings[0]?.message).toContain("notes.md");
  });

  test("an empty scan says so differently from a wrong-contents one", () => {
    const empty = chooseProjectFile([]);
    expect(empty.seen).toEqual([]);
    expect(empty.findings[0]?.message).toContain("scanned as empty");
    expect(empty.findings[0]?.message).not.toContain("Saw:");
  });

  test("seen carries files even on a clean pick", () => {
    const pick = chooseProjectFile(["hollow_creek.scf", "notes.md"]);
    expect(pick.seen).toEqual(["hollow_creek.scf", "notes.md"]);
  });

  test("candidates come back sorted so the picker is stable", () => {
    expect(chooseProjectFile(["zeta.scf", "alpha.scf", "mid.scf"])
      .candidates).toEqual(["alpha.scf", "mid.scf", "zeta.scf"]);
  });
});

/**
 * The file-first order. `resolve()` is mocked here to its three
 * possible answers, because the whole point of keeping this rule
 * browser-free is that it can be tested without a directory handle.
 */
describe("classifyRootPairing", () => {
  test("the folder holding the .scf directly is the project", () => {
    const p = classifyRootPairing("hollow_creek", "hollow_creek.scf",
                                  ["hollow_creek.scf"]);
    expect(p.kind).toBe("at-root");
    expect(p.path).toBe("hollow_creek.scf");
  });

  test("an ancestor folder is refused, and says where the file is", () => {
    const p = classifyRootPairing("Projects", "hollow_creek.scf",
                                  ["hollow_creek", "hollow_creek.scf"]);
    expect(p.kind).toBe("below-root");
    expect(p.path).toBe("hollow_creek/hollow_creek.scf");
    expect(p.message).toContain("hollow_creek/hollow_creek.scf");
  });

  test("null means not below the folder at all", () => {
    const p = classifyRootPairing("Downloads", "hollow_creek.scf", null);
    expect(p.kind).toBe("outside-root");
    expect(p.path).toBeNull();
  });

  // A file handle can never BE a directory handle, so an empty array is
  // not a real answer. Trusting it would map @project onto the file.
  test("an empty segment list is not treated as a match", () => {
    expect(classifyRootPairing("x", "x.scf", []).kind)
      .toBe("outside-root");
  });

  test("every message names both the file and the folder", () => {
    for (const segments of [null, [], ["a", "x.scf"]]) {
      const p = classifyRootPairing("Shots", "x.scf", segments);
      expect(p.message).toContain("x.scf");
      expect(p.message).toContain("Shots");
    }
  });
});
