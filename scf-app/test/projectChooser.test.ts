// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { joinPath, withScfExtension } from "../src/files/projectChooser";

describe("chooser rules", () => {
  test("paths join with the folder's own separator", () => {
    expect(joinPath("/a/b", "c.scf")).toBe("/a/b/c.scf");
    expect(joinPath("/a/b/", "c.scf")).toBe("/a/b/c.scf");
    expect(joinPath("C:\\films", "c.scf")).toBe("C:\\films\\c.scf");
  });

  test(".scf is added once and case is respected", () => {
    expect(withScfExtension("Heist")).toBe("Heist.scf");
    expect(withScfExtension("Heist.scf")).toBe("Heist.scf");
    expect(withScfExtension("Heist.SCF")).toBe("Heist.SCF");
    expect(withScfExtension("  Heist ")).toBe("Heist.scf");
  });
});
