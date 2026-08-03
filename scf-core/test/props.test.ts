import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFountain } from "../src/fountain/tokenizer.ts";
import { propose } from "../src/proposals/propose.ts";

const FRANKENSTEIN = fileURLToPath(new URL(
  "../../corpus/public/scripts/frankenstein-2025.fountain", import.meta.url));

/** Propose over a scrap of action, and return the prop names. */
const props = (action: string): string[] =>
  propose(parseFountain(`INT. ROOM - DAY\n\n${action}\n`))
    .props.map((p) => p.name);

describe("props: capitalization alone is not a signal", () => {
  test("a capped verb is not a prop", () => {
    // The old pass proposed Pushes, Tosses The Men, Roars, Ice Cracks.
    expect(props("Victor PUSHES past him and SMASHES the glass."))
      .not.toContain("Pushes");
  });

  test("a capped phrase in noun position is", () => {
    expect(props("He lifts a RED BALL from the table."))
      .toContain("Red Ball");
  });

  test("a possessive counts as noun position", () => {
    expect(props("She wears MOTHER'S GLOVES.")).toContain("Mother's Gloves");
  });

  test("an all-caps line proposes nothing — no signal to read", () => {
    expect(props("THE MEN CHARGE THE SLED AND VANISH.")).toEqual([]);
  });
});

describe("props: handling verbs work at any capitalization", () => {
  test("the object of a handling verb is a candidate", () => {
    // The whole point: this script never capitalizes its props.
    expect(props("He picks up the umbrella and opens the shutters."))
      .toEqual(expect.arrayContaining(["Umbrella", "Shutters"]));
  });

  test("the phrase stops where the noun phrase does", () => {
    expect(props("She picks up the ball in the corner of the room."))
      .toContain("Ball");
  });

  test("a second determiner is not part of the name", () => {
    // "hands her a towel" — the verb pattern already ate "her".
    expect(props("He hands her a towel.")).toContain("Towel");
  });

  test("an em-dash remnant is not part of the name", () => {
    expect(props("He takes the cane- but does not lean on it."))
      .toContain("Cane");
  });

  test("an adverb is not part of the name", () => {
    expect(props("He raises the blade slowly.")).toContain("Blade");
  });
});

describe("props: the four reject classes", () => {
  const rejects = (action: string): string[] => props(action);

  test("people and roles", () => {
    expect(rejects("A BUTLER opens a door for the TWO OLD HUNTERS."))
      .not.toEqual(expect.arrayContaining(["Butler", "Two Old Hunters"]));
  });

  test("sounds", () => {
    expect(rejects("There is a KNOCK, then a distant HOWLING."))
      .toEqual([]);
  });

  test("weather, light, and the like", () => {
    expect(rejects("The SUN breaks through and a SNOWSTORM follows."))
      .toEqual([]);
  });

  test("body parts", () => {
    expect(rejects("He raises his HAND and covers his EYES.")).toEqual([]);
  });

  test("the head word decides — gloved hands are hands", () => {
    expect(props("She lifts her GLOVED HANDS.")).toEqual([]);
  });
});

describe("props: scoring", () => {
  test("two signals and recurrence outrank a single mention", () => {
    const doc = parseFountain(
      "INT. ROOM - DAY\n\nHe lifts a RIFLE from the rack.\n\n" +
      "INT. HALL - NIGHT\n\nHe picks up the rifle again.\n\n" +
      "He notices a spare CANDLE.\n");
    const p = propose(doc);
    const rifle = p.props.find((x) => x.name === "Rifle");
    expect(rifle).toBeDefined();
    expect(rifle!.signals).toEqual(
      expect.arrayContaining(["introduced", "handled", "recurring"]));
    expect(p.props[0]!.name).toBe("Rifle");
  });

  test("nothing ever reaches high — a human creates props", () => {
    const doc = parseFountain(readFileSync(FRANKENSTEIN, "utf8"));
    const p = propose(doc);
    expect(p.props.every((x) => x.confidence !== "high")).toBe(true);
  });
});

describe("props: Frankenstein, the corpus check", () => {
  const p = propose(parseFountain(readFileSync(FRANKENSTEIN, "utf8")));
  const strong = p.props.filter((x) => x.confidence === "medium")
    .map((x) => x.name);

  test("the strong tier reads like a props list", () => {
    expect(strong).toEqual(expect.arrayContaining(
      ["Rifle", "Umbrella", "Red Ball", "Blunderbuss", "Letter"]));
  });

  test("and no longer contains the old noise", () => {
    // Every one of these led the previous version's list.
    for (const junk of ["Sun", "Men", "Howling", "Two Old Hunters",
                        "Explosion", "Pushes", "Tosses The Men"]) {
      expect(p.props.map((x) => x.name), junk).not.toContain(junk);
    }
  });

  test("candidates are ordered strongest first", () => {
    const scores = p.props.map((x) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
