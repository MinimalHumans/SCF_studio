// SPDX-License-Identifier: Apache-2.0
/**
 * fdx.test.ts — FDX import onto the shared typed line stream.
 *
 * The synthetic public fixture (corpus/public/spec/features.fdx)
 * exercises what the real private-tier file doesn't: styles-as-marks,
 * scene numbers, dual dialogue, title page, revision marks, unmapped
 * paragraph types, entity decoding. The real file (when present locally)
 * pins the paragraph-count mapping.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseFdx } from "../src/fdx/parser.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "..", "..", "corpus");
const SYNTHETIC = join(CORPUS, "public", "spec", "features.fdx");
const REAL = join(CORPUS, "private", "fdx", "For A Few Days More.fdx");

describe("fdx: synthetic feature fixture", () => {
  const doc = parseFdx(readFileSync(SYNTHETIC, "utf8"));

  test("type sequence", () => {
    expect(doc.lines.map((l) => l.type)).toEqual([
      "title_page", "title_page", "blank",
      "heading", "blank",
      "action", "blank",
      "character", "dialogue", "blank",
      "character", "parenthetical", "dialogue", "blank",
      "action", "blank",
      "transition",
    ]);
  });

  test("title page keys parsed", () => {
    expect(doc.lines[0]!.titlePage)
      .toEqual({ key: "Title", value: "Feature Test" });
  });

  test("scene number kept on the heading", () => {
    expect(doc.lines[3]!.heading?.sceneNumber).toBe("1A");
  });

  test("styled runs flatten with offset marks; revision recorded",
      () => {
    const action = doc.lines[5]!;
    expect(action.raw).toBe("Plain then bold then both.");
    expect(action.fdx?.marks).toEqual([
      { start: 11, end: 15, styles: ["Bold"] },
      { start: 21, end: 25, styles: ["Bold", "Italic"] },
    ]);
    expect(action.fdx?.revisionId).toBe("3");
  });

  test("dual dialogue: second cue carries the flag; extensions parsed",
      () => {
    expect(doc.lines[7]!.character).toEqual({
      name: "ELEANOR", extensions: ["V.O."], dual: false, forced: false,
    });
    expect(doc.lines[10]!.character?.dual).toBe(true);
  });

  test("unmapped paragraph type -> action with origin; entities decode",
      () => {
    const shot = doc.lines[14]!;
    expect(shot.type).toBe("action");
    expect(shot.fdx?.originalType).toBe("Shot");
    expect(shot.raw).toBe("CLOSE ON the locket & chain.");
  });
});

describe.skipIf(!existsSync(REAL))("fdx: real file (private tier)",
    () => {
  test("paragraph counts map one-to-one from the XML", () => {
    const doc = parseFdx(readFileSync(REAL, "utf8"));
    const counts: Record<string, number> = {};
    for (const l of doc.lines) counts[l.type] = (counts[l.type] ?? 0) + 1;
    expect(counts["heading"]).toBe(13);
    expect(counts["character"]).toBe(87);
    expect(counts["dialogue"]).toBe(88);
    expect(counts["parenthetical"]).toBe(13);
    expect(counts["transition"]).toBe(2);
    expect(counts["action"]).toBe(42);
    expect(doc.lines.find((l) => l.type === "heading")!.raw)
      .toBe("INT. DRISKILL HOTEL SEMINAR ROOM - DAY");
  });
});
