import { describe, expect, it } from "vitest";
import {
  suggestExportName, suggestSaveAsName,
} from "../src/state/saveName.ts";

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

/**
 * Every export used to land as the constant "screenplay.fountain",
 * regardless of project — which is how an export can end up beside, or
 * on top of, the file it was imported from. (The import itself cannot
 * write: it reads through a plain file input, which hands the page a
 * read-only snapshot and no handle back to the disk.)
 */
describe("suggestExportName", () => {
  it("names the export after the project", () => {
    expect(suggestExportName("hollow_creek.scf"))
      .toBe("hollow_creek.fountain");
    expect(suggestExportName("hollow_creek_v3.scf"))
      .toBe("hollow_creek_v3.fountain");
  });

  it("tolerates a name with no extension", () => {
    expect(suggestExportName("Untitled")).toBe("Untitled.fountain");
  });

  it("falls back when there is no project name yet", () => {
    expect(suggestExportName(null)).toBe("screenplay.fountain");
    expect(suggestExportName("")).toBe("screenplay.fountain");
    expect(suggestExportName("   ")).toBe("screenplay.fountain");
    expect(suggestExportName(".scf")).toBe("screenplay.fountain");
  });

  it("two projects cannot collide on one export name", () => {
    expect(suggestExportName("act_one.scf"))
      .not.toBe(suggestExportName("act_two.scf"));
  });
});
