// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import {
  baseNameOf, bumpVersionSuffix, stripVersionSuffix, withoutScfExtension,
} from "../src/projectName.ts";

describe("withoutScfExtension", () => {
  test("strips .scf, any case", () => {
    expect(withoutScfExtension("hollow_creek.scf")).toBe("hollow_creek");
    expect(withoutScfExtension("Hollow Creek.SCF")).toBe("Hollow Creek");
  });
  test("leaves a name with no extension alone", () => {
    expect(withoutScfExtension("Untitled")).toBe("Untitled");
  });
});

describe("stripVersionSuffix", () => {
  test("strips a version marker, whatever its separator", () => {
    expect(stripVersionSuffix("hollow_creek_v2")).toBe("hollow_creek");
    expect(stripVersionSuffix("hollow_creek-v9")).toBe("hollow_creek");
    expect(stripVersionSuffix("hollow_creek.v1")).toBe("hollow_creek");
  });
  test("strips a bare numbered suffix", () => {
    expect(stripVersionSuffix("hollow_creek-004")).toBe("hollow_creek");
  });
  test("leaves an unversioned name alone", () => {
    expect(stripVersionSuffix("hollow_creek")).toBe("hollow_creek");
  });
  test("does not mistake a year or scene number for a version", () => {
    expect(stripVersionSuffix("hollow creek")).toBe("hollow creek");
  });
});

describe("bumpVersionSuffix", () => {
  test("adds _v2 to an unversioned name", () => {
    expect(bumpVersionSuffix("hollow_creek")).toBe("hollow_creek_v2");
  });
  test("steps an existing marker", () => {
    expect(bumpVersionSuffix("hollow_creek_v2")).toBe("hollow_creek_v3");
    expect(bumpVersionSuffix("hollow_creek-v9")).toBe("hollow_creek-v10");
    expect(bumpVersionSuffix("hollow_creek.v1")).toBe("hollow_creek.v2");
  });
  test("keeps zero padding on a numbered file", () => {
    expect(bumpVersionSuffix("hollow_creek-004")).toBe("hollow_creek-005");
    expect(bumpVersionSuffix("hollow_creek-099")).toBe("hollow_creek-100");
  });
});

describe("baseNameOf", () => {
  test("strips the extension and any version suffix together", () => {
    expect(baseNameOf("hollow_creek_v2.scf")).toBe("hollow_creek");
    expect(baseNameOf("hollow_creek-004.scf")).toBe("hollow_creek");
    expect(baseNameOf("hollow_creek.scf")).toBe("hollow_creek");
  });
});
