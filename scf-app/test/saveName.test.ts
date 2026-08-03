import { describe, expect, it } from "vitest";
import { suggestSaveAsName } from "../src/state/saveName.ts";

describe("suggestSaveAsName", () => {
  it("bumps an unversioned file to v2", () => {
    expect(suggestSaveAsName("hollow_creek.scf", true))
      .toBe("hollow_creek_v2.scf");
  });

  it("steps an existing version marker, whatever its separator", () => {
    expect(suggestSaveAsName("hollow_creek_v2.scf", true))
      .toBe("hollow_creek_v3.scf");
    expect(suggestSaveAsName("hollow_creek-v9.scf", true))
      .toBe("hollow_creek-v10.scf");
    expect(suggestSaveAsName("hollow_creek.v1.scf", true))
      .toBe("hollow_creek.v2.scf");
  });

  it("keeps zero padding on numbered files", () => {
    expect(suggestSaveAsName("hollow_creek-004.scf", true))
      .toBe("hollow_creek-005.scf");
    expect(suggestSaveAsName("hollow_creek-099.scf", true))
      .toBe("hollow_creek-100.scf");
  });

  it("only adds the extension when there is no file yet", () => {
    // The demo and new projects have a display name, not a filename —
    // there is no earlier version to step past.
    expect(suggestSaveAsName("Hollow Creek (demo)", true))
      .toBe("Hollow Creek (demo).scf");
    expect(suggestSaveAsName("Untitled.scf", false))
      .toBe("Untitled.scf");
    expect(suggestSaveAsName(null, true)).toBe("project.scf");
  });

  it("leaves the name alone when not bumping (plain Save)", () => {
    expect(suggestSaveAsName("hollow_creek_v2.scf"))
      .toBe("hollow_creek_v2.scf");
  });

  it("does not mistake a year or scene number for a version", () => {
    expect(suggestSaveAsName("hollow creek.scf", true))
      .toBe("hollow creek_v2.scf");
  });
});
