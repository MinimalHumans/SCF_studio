import { describe, expect, test } from "vitest";
import { nextShotNumber, shotCode, shotLetter, restampShotNumber } from "../src/shots.ts";

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

describe("restampShotNumber", () => {
  test("swaps the scene prefix and keeps the letter", () => {
    expect(restampShotNumber("42A", 43)).toBe("43A");
    expect(restampShotNumber("7C", 1)).toBe("1C");
    expect(restampShotNumber("12AB", 3)).toBe("3AB");
  });

  test("returns null when nothing should change", () => {
    expect(restampShotNumber("42A", 42)).toBeNull();
    expect(restampShotNumber(null, 3)).toBeNull();
    expect(restampShotNumber("", 3)).toBeNull();
    // No scene number to build on.
    expect(restampShotNumber("42A", null)).toBeNull();
    // Not a code this scheme issued — an authored one stays authored.
    expect(restampShotNumber("pickup-3", 5)).toBeNull();
    expect(restampShotNumber("42", 5)).toBeNull();
  });

  test("round-trips against shotCode", () => {
    for (let i = 0; i < 30; i++) {
      expect(restampShotNumber(shotCode(9, i), 4)).toBe(shotCode(4, i));
    }
  });
});
