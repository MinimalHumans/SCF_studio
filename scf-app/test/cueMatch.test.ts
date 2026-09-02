// SPDX-License-Identifier: Apache-2.0
/**
 * The predicate exists because string equality reported eleven conflicts
 * on the conformance fixture and offered to break eleven correct links.
 * These pin both halves: the shorthand a screenplay always uses agrees,
 * and a cue that names someone else still does not.
 */
import { describe, expect, test } from "vitest";
import { cueMatchesEntity } from "../src/editor/cueMatch.ts";

describe("a cue as written against the entity it is linked to", () => {
  test("a first-name cue agrees with the full name", () => {
    expect(cueMatchesEntity("ELEANOR", "Eleanor Cade")).toBe(true);
    expect(cueMatchesEntity("MARCUS", "Marcus Cade")).toBe(true);
  });

  test("a surname cue agrees too — some scripts cue that way", () => {
    expect(cueMatchesEntity("CADE", "Eleanor Cade")).toBe(true);
    expect(cueMatchesEntity("SHAW", "Reverend Shaw")).toBe(true);
  });

  test("the full name agrees with itself, whatever its case", () => {
    expect(cueMatchesEntity("ELEANOR CADE", "Eleanor Cade")).toBe(true);
    expect(cueMatchesEntity("Reverend Shaw", "REVEREND SHAW")).toBe(true);
  });

  test("punctuation a cue picks up is not a disagreement", () => {
    expect(cueMatchesEntity("MRS. CADE", "Mrs Cade")).toBe(true);
    expect(cueMatchesEntity("O'NEILL", "Bridget ONeill")).toBe(true);
  });

  test("a different name still disagrees — the George/Jorge case", () => {
    expect(cueMatchesEntity("JORGE", "George Wells")).toBe(false);
    expect(cueMatchesEntity("ELEANOR", "Marcus Cade")).toBe(false);
  });

  test("a cue carrying a word the name does not still disagrees", () => {
    // A real question for the author: is OLD ELEANOR the same record?
    expect(cueMatchesEntity("OLD ELEANOR", "Eleanor Cade")).toBe(false);
  });

  test("agreement is by whole words, never substring", () => {
    // The reason the rule is not `includes`: ADA is inside ADAM.
    expect(cueMatchesEntity("ADA", "Adam Shaw")).toBe(false);
    expect(cueMatchesEntity("ANN", "Joanna Reed")).toBe(false);
  });

  test("an empty side agrees with nothing", () => {
    expect(cueMatchesEntity("", "Eleanor Cade")).toBe(false);
    expect(cueMatchesEntity("ELEANOR", "")).toBe(false);
  });
});
