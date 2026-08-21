// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { nextShotNumber, parseShotCode, shotCode, shotLetter,
         restampShotNumber } from "../src/shots.ts";

describe("shot letters run like spreadsheet columns", () => {
  test("A through Z, then AA", () => {
    expect(shotLetter(0)).toBe("A");
    expect(shotLetter(25)).toBe("Z");
    expect(shotLetter(26)).toBe("AA");
    expect(shotLetter(27)).toBe("AB");
    expect(shotLetter(51)).toBe("AZ");
    expect(shotLetter(52)).toBe("BA");
  });
});

describe("shotCode", () => {
  test("scene number plus position", () => {
    expect(shotCode(42, 0)).toBe("42A");
    expect(shotCode(42, 4)).toBe("42E");
  });

  test("an unnumbered scene yields the letter alone", () => {
    // Better than inventing a number that would collide with a real one.
    expect(shotCode(null, 0)).toBe("A");
    expect(shotCode("", 2)).toBe("C");
  });
});

describe("nextShotNumber", () => {
  test("continues the scene's sequence", () => {
    expect(nextShotNumber(42, ["42A", "42B"])).toBe("42C");
  });

  test("continues past the highest, rather than filling a gap", () => {
    // If 42C was cut, the next setup is 42E — a second 42C meaning
    // something else is how a crew shoots the wrong thing.
    expect(nextShotNumber(42, ["42B", "42A", "42D"])).toBe("42E");
  });

  test("but a freed trailing code does come back", () => {
    // Honest limit: nothing records codes that once existed. The
    // stronger promise needs a stored counter.
    expect(nextShotNumber(42, ["42A"])).toBe("42B");
  });

  test("ignores blanks and matches case-insensitively", () => {
    expect(nextShotNumber(42, [null, "", "42a"])).toBe("42B");
  });

  test("starts at A in an empty scene", () => {
    expect(nextShotNumber(42, [])).toBe("42A");
  });

  test("an authored number outside the pattern does not block", () => {
    // "42X-INSERT" is not a code this function would generate, so it
    // simply never collides.
    expect(nextShotNumber(42, ["42X-INSERT"])).toBe("42A");
  });
});

describe("parseShotCode — the parse is relative to the scene (§4.4.2)", () => {
  test("strips the scene's own number, not the trailing letter run", () => {
    // The case the whole rule exists for. Taking the trailing run would
    // read "AB" here and call it ordinal 27.
    expect(parseShotCode("12AB", "12A")).toEqual({ index: 1 });
    expect(parseShotCode("12AB", 12)).toEqual({ index: 27 });
  });

  test("an A-page scene numbers its shots from A", () => {
    expect(parseShotCode("12AA", "12A")).toEqual({ index: 0 });
    expect(parseShotCode("A12B", "A12")).toEqual({ index: 1 });
  });

  test("an unnumbered scene yields the letter run alone", () => {
    expect(parseShotCode("C", null)).toEqual({ index: 2 });
  });

  test("null when the code does not belong to the scheme", () => {
    expect(parseShotCode("pickup-3", 5)).toBeNull();
    expect(parseShotCode("42", 42)).toBeNull();
    expect(parseShotCode("43A", 42)).toBeNull();   // prefix mismatch
    expect(parseShotCode(null, 42)).toBeNull();
  });

  test("case-insensitive", () => {
    expect(parseShotCode("12ab", "12a")).toEqual({ index: 1 });
  });
});

describe("restampShotNumber", () => {
  test("swaps the scene prefix and keeps the ordinal", () => {
    expect(restampShotNumber("42A", 42, 43)).toBe("43A");
    expect(restampShotNumber("7C", 7, 1)).toBe("1C");
    expect(restampShotNumber("12AB", 12, 3)).toBe("3AB");
  });

  test("an A-page scene restamps without inflating the ordinal", () => {
    // The regression. Under the old trailing-run parse this produced
    // "13AAB": "AB" read as ordinal 27 instead of "B" as ordinal 1.
    expect(restampShotNumber("12AB", "12A", "13A")).toBe("13AB");
    expect(restampShotNumber("12AB", "12A", 13)).toBe("13B");
  });

  test("returns null when nothing should change", () => {
    expect(restampShotNumber("42A", 42, 42)).toBeNull();
    expect(restampShotNumber(null, 42, 3)).toBeNull();
    expect(restampShotNumber("", 42, 3)).toBeNull();
    // No scene number to build on.
    expect(restampShotNumber("42A", 42, null)).toBeNull();
    // Not a code this scheme issued — an authored one stays authored.
    expect(restampShotNumber("pickup-3", 5, 6)).toBeNull();
    expect(restampShotNumber("42", 42, 5)).toBeNull();
    // Prefix does not match the scene it is supposed to be leaving.
    expect(restampShotNumber("42A", 7, 8)).toBeNull();
  });

  test("round-trips against shotCode", () => {
    for (let i = 0; i < 30; i++) {
      expect(restampShotNumber(shotCode(9, i), 9, 4)).toBe(shotCode(4, i));
    }
  });

  test("round-trips against shotCode on A-page scenes", () => {
    for (let i = 0; i < 30; i++) {
      expect(restampShotNumber(shotCode("9A", i), "9A", "10B"))
        .toBe(shotCode("10B", i));
    }
  });
});

describe("nextShotNumber on A-page scenes", () => {
  test("continues the sequence rather than misreading the prefix", () => {
    expect(nextShotNumber("12A", ["12AA", "12AB"])).toBe("12AC");
  });

  test("a sibling belonging to the bare-numbered scene does not count",
       () => {
    // "12B" is scene 12's coverage, not scene 12A's. It must not push
    // scene 12A's numbering to C.
    expect(nextShotNumber("12A", ["12B"])).toBe("12AA");
  });
});
