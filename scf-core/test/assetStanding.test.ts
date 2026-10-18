// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { assetStanding } from "../src/assetStanding.ts";

describe("whether a file is current or history", () => {
  test("active, draft and unset are current, split by whether used", () => {
    for (const status of ["active", "draft", null]) {
      expect(assetStanding(status, true).kind).toBe("in-use");
      expect(assetStanding(status, false).kind).toBe("unreferenced");
      expect(assetStanding(status, true).historic).toBe(false);
    }
  });

  test("the four editorial statuses are history", () => {
    for (const status of ["superseded", "cut", "archived", "deprecated"]) {
      const s = assetStanding(status, false);
      expect(s.kind).toBe(status);
      expect(s.historic).toBe(true);
      expect(s.stillAttached).toBe(false);
    }
  });

  test("history still attached is flagged, since only cut stops resolving",
       () => {
    const s = assetStanding("superseded", true, "board_v2.png");
    expect(s.stillAttached).toBe(true);
    expect(s.label).toBe("superseded → board_v2.png");
    expect(s.title).toMatch(/still gets this version/);
    expect(assetStanding("cut", true).title).toMatch(/detach it or restore/);
  });

  test("a superseded file with no named successor still says so", () => {
    expect(assetStanding("superseded", false).label).toBe("superseded");
  });
});
