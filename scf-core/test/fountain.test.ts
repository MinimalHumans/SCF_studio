/**
 * fountain.test.ts — Stage 1 test suite.
 *
 * Three tiers, per the design doc's testing strategy:
 *  1. Spec unit tests — hand-verified behavior of the classifier's rules
 *     and meta extraction (cues, scene numbers, title page).
 *  2. Golden corpus harness — every corpus script's classification is
 *     compared against its blessed .types.txt; a fix that breaks another
 *     script is visible before merge. Public tier must be blessed;
 *     private tier (gitignored, local-only) is tested when present.
 *  3. Property tests — round-trip byte stability, and classification
 *     invariance under BOM prepending and LF→CRLF conversion, on every
 *     corpus script (v1's _normalize_encoding wounds, made properties).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseFountain, serialize } from "../src/fountain/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "..", "..", "corpus");

function* corpusScripts(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* corpusScripts(p);
    else if (/\.fountain(\.txt)?$/.test(entry)) yield p;
  }
}

const publicScripts = [...corpusScripts(join(CORPUS, "public"))];
const privateScripts = [...corpusScripts(join(CORPUS, "private"))];

// ---------------------------------------------------------------------------
// 1. Spec unit tests
// ---------------------------------------------------------------------------

const types = (text: string): string[] =>
  parseFountain(text).lines.map((l) => l.type);

describe("spec: cues and meta extraction", () => {
  test("cue with extensions and dual marker", () => {
    const doc = parseFountain("\nMARCUS (V.O.) (CONT'D) ^\nHello.\n");
    const cue = doc.lines[1]!;
    expect(cue.type).toBe("character");
    expect(cue.character).toEqual({
      name: "MARCUS", extensions: ["V.O.", "CONT'D"], dual: true,
      forced: false,
    });
  });

  test("forced @ cue permits lowercase; unforced does not", () => {
    expect(types("\n@McClane\nYippee.\n")[1]).toBe("character");
    expect(types("\nMcClane\nYippee.\n")[1]).toBe("action");
  });

  test("all-caps line is a cue only with non-blank after", () => {
    expect(types("\nELEANOR\nLine.\n")[1]).toBe("character");
    expect(types("\nELEANOR\n\nAction.\n")[1]).toBe("action");
  });

  test("scene number extraction", () => {
    const doc = parseFountain("\nEXT. CREEK - DAY #1A#\n\n");
    expect(doc.lines[1]!.type).toBe("heading");
    expect(doc.lines[1]!.heading?.sceneNumber).toBe("1A");
  });

  test("heading requires blank after; falls to cue per spec's letter",
      () => {
    const t = types("\nINT. NO BLANK AFTER\nfollows immediately.\n");
    expect(t[1]).toBe("character");
    expect(t[2]).toBe("dialogue");
  });

  test("forced heading, double-dot action", () => {
    expect(types(".MONTAGE\n")[0]).toBe("heading");
    expect(types("..literal dots\n")[0]).toBe("action");
  });

  test("transition needs TO: + caps + surrounding blanks; > forces",
      () => {
    expect(types("Action.\n\nCUT TO:\n\nINT. A - DAY\n\n")[2])
      .toBe("transition");
    expect(types("Action.\n\nCut to:\n\nMore.\n")[2]).toBe("action");
    expect(types("\n> Burn to white.\n")[1]).toBe("transition");
    expect(types("\n>CENTERED<\n")[1]).toBe("centered");
  });

  test("title page: keys, continuations, ends at blank", () => {
    const doc = parseFountain(
      "Title: T\nNotes:\n   indented value\n\nAction.\n");
    expect(doc.lines.map((l) => l.type)).toEqual(
      ["title_page", "title_page", "title_page", "blank", "action",
       "blank"]);
    expect(doc.lines[0]!.titlePage).toEqual({ key: "Title", value: "T" });
    expect(doc.lines[2]!.titlePage)
      .toEqual({ value: "indented value" });
  });

  test("no title page when first line is not Key: value", () => {
    expect(types("FADE IN:\n")[0]).toBe("action");
  });

  test("two-space line continues dialogue; empty line ends it", () => {
    const t = types("\nELEANOR\nFirst.\n  \nStill talking.\n\nAction.\n");
    expect(t.slice(1, 7)).toEqual(
      ["character", "dialogue", "dialogue", "dialogue", "blank",
       "action"]);
  });

  test("boneyard and note lines are transparent for adjacency", () => {
    const t = types(
      "Action.\n\n/* hidden */\nINT. ROOM - DAY\n[[note line]]\n\nGo.\n");
    expect(t).toEqual(["action", "blank", "boneyard", "heading", "note",
                       "blank", "action", "blank"]);
  });

  test("multi-line boneyard and note; blank closes an open note", () => {
    const t = types("/*\nhidden\n*/\n[[open note\nstill note\n\nAction.\n");
    expect(t).toEqual(["boneyard", "boneyard", "boneyard", "note", "note",
                       "blank", "action", "blank"]);
  });

  test("empty input is a single blank line", () => {
    expect(types("")).toEqual(["blank"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Golden corpus harness
// ---------------------------------------------------------------------------

function expectedPathFor(script: string): string {
  return script.replace(/\.fountain(\.txt)?$/, ".types.txt");
}

describe("golden corpus: public tier (blessed expectations required)",
    () => {
  test("public tier is present", () => {
    expect(publicScripts.length).toBeGreaterThan(0);
  });
  test.each(publicScripts)("%s matches blessed types", (script) => {
    const expected = expectedPathFor(script);
    expect(existsSync(expected),
           `missing blessed file — run npm run bless-corpus`).toBe(true);
    const text = readFileSync(script, "utf8");
    const actual = parseFountain(text).lines.map((l) => l.type)
      .join("\n") + "\n";
    expect(actual).toBe(readFileSync(expected, "utf8"));
  });
});

describe.skipIf(privateScripts.length === 0)(
  "golden corpus: private tier (local-only)", () => {
  test.each(privateScripts.filter(
    (s) => existsSync(expectedPathFor(s))))(
    "%s matches blessed types", (script) => {
      const text = readFileSync(script, "utf8");
      const actual = parseFountain(text).lines.map((l) => l.type)
        .join("\n") + "\n";
      expect(actual).toBe(readFileSync(expectedPathFor(script), "utf8"));
    });
});

// ---------------------------------------------------------------------------
// 3. Property tests over the whole corpus
// ---------------------------------------------------------------------------

const allScripts = [...publicScripts, ...privateScripts];

describe("properties over the corpus", () => {
  test.each(allScripts)("%s round-trips byte-stable", (script) => {
    const text = readFileSync(script, "utf8");
    expect(serialize(parseFountain(text))).toBe(text);
  });

  test.each(allScripts)(
    "%s classification invariant under BOM + CRLF", (script) => {
      const text = readFileSync(script, "utf8");
      const base = parseFountain(text).lines.map((l) => l.type);
      const perturbed = "\uFEFF" + text.replaceAll("\r\n", "\n")
        .replaceAll("\n", "\r\n");
      const doc = parseFountain(perturbed);
      expect(doc.bom).toBe(true);
      expect(doc.lines.map((l) => l.type)).toEqual(base);
      expect(serialize(doc)).toBe(perturbed);
    });
});
