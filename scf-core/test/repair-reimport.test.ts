/**
 * repair-reimport.test.ts — the repair pass (scope-bounded) and the
 * revision flow's uuid-preserving diff.
 *
 * Repair scope is a project decision: reasonable error-proofing for
 * conventionally well-formed screenplays mangled by converters — not
 * idiot-proofing. The tests pin both directions: the two rules recover
 * the corpus's systematic damage, AND the pass is inert on every public
 * fixture and on legitimate uses of >, emphasis, and forced elements.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseFountain } from "../src/fountain/index.ts";
import { repairConversionArtifacts } from "../src/fountain/repair.ts";
import { linesToRows } from "../src/screenplay/rowModel.ts";
import { diffScreenplay } from "../src/screenplay/reimport.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "..", "..", "corpus");

describe("repair: the two rules", () => {
  test("emphasis-shredded keyword (Sinners pattern)", () => {
    const { text, repairs } = repairConversionArtifacts(
      "_**I_NT. DARK VOID - NIGHT**\n");
    expect(repairs).toHaveLength(1);
    expect(text).toBe("INT. DARK VOID - NIGHT\n");
  });

  test("> + glued number + emphasis (Wonka pattern); number kept",
      () => {
    const { text, repairs } = repairConversionArtifacts(
      "> 1**EXT. OCEAN - DAY**\n");
    expect(repairs[0]!.after).toBe("EXT. OCEAN - DAY #1#");
    const doc = parseFountain(text + "\n");
    expect(doc.lines[0]!.type).toBe("heading");
    expect(doc.lines[0]!.heading?.sceneNumber).toBe("1");
  });

  test("> + emphasized big number + shredded keyword (Andor pattern)",
      () => {
    const { repairs } = repairConversionArtifacts(
      "> **865_IN_T.  SENATE GRAND ATRIUM -- CORUSCANT -- NIGHT\n");
    expect(repairs[0]!.after)
      .toBe("INT.  SENATE GRAND ATRIUM -- CORUSCANT -- NIGHT #865#");
  });

  test("inert on legitimate >, emphasis, forced elements, prose", () => {
    const legit = [
      "> Burn to white.\n",
      ">THE END<\n",
      ".MONTAGE - THE SEASONS TURN\n",
      "He sees **something** move in the dark.\n",
      "CUT TO:\n",
      "~Willow, weep for me\n",
      "INT. ALREADY FINE - DAY\n",
    ].join("\n");
    const { text, repairs } = repairConversionArtifacts(legit);
    expect(repairs).toEqual([]);
    expect(text).toBe(legit);
  });

  test("inert on every public corpus file", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name))
          : /\.fountain$/.test(e.name) ? [join(dir, e.name)] : []);
    for (const f of walk(join(CORPUS, "public"))) {
      const original = readFileSync(f, "utf8");
      const { text, repairs } = repairConversionArtifacts(original);
      expect(repairs, f).toEqual([]);
      expect(text, f).toBe(original);
    }
  });
});

describe.skipIf(
  !existsSync(join(CORPUS, "private", "fountain")))(
  "repair: corpus recovery (private tier)", () => {
  const count = (name: string): { before: number; after: number } => {
    const text = readFileSync(
      join(CORPUS, "private", "fountain", name), "utf8");
    const before = parseFountain(text).lines
      .filter((l) => l.type === "heading").length;
    const after = parseFountain(repairConversionArtifacts(text).text)
      .lines.filter((l) => l.type === "heading").length;
    return { before, after };
  };

  test("the zero-heading conversions recover their scenes", () => {
    expect(count("wonka-2023.fountain.txt"))
      .toEqual({ before: 0, after: 124 });
    expect(count("sinners-2025.fountain.txt").after)
      .toBeGreaterThan(100);
    expect(count("andor-209-welcome-to-the-rebellion-2025.fountain.txt")
      .after).toBeGreaterThan(90);
  });

  test("already-parseable scripts only gain, never lose", () => {
    for (const name of ["aliens-1986.fountain.txt",
                        "f1-2025.fountain.txt",
                        "the-abyss-1989.fountain.txt"]) {
      const { before, after } = count(name);
      expect(after, name).toBeGreaterThanOrEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------
// Re-import diff
// ---------------------------------------------------------------------------

const V1 = `INT. KITCHEN - NIGHT

Eleanor sets the kettle on.

ELEANOR
You came back.

MARCUS
I never left.

EXT. CREEK - DAY

Water over stones.`;

function rowsOf(text: string) {
  const rows = linesToRows(parseFountain(text)).lines;
  rows.forEach((r, i) => { r.uuid = `uuid-${i}`; });
  return rows;
}

describe("re-import: uuid-preserving diff", () => {
  test("identical text keeps every uuid", () => {
    const old = rowsOf(V1);
    const d = diffScreenplay(old, linesToRows(parseFountain(V1)).lines);
    expect(d.kept).toBe(old.length);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.rows.map((r) => r.uuid)).toEqual(old.map((r) => r.uuid));
  });

  test("an edited line gets a fresh uuid; neighbors keep theirs", () => {
    const old = rowsOf(V1);
    const v2 = V1.replace("You came back.", "You actually came back.");
    const d = diffScreenplay(old, linesToRows(parseFountain(v2)).lines);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const edited = d.rows.find(
      (r) => r.content === "You actually came back.")!;
    expect(edited.uuid).toBeUndefined();
    const cue = d.rows.find((r) => r.content === "ELEANOR")!;
    const oldCue = old.find((r) => r.content === "ELEANOR")!;
    expect(cue.uuid).toBe(oldCue.uuid);
  });

  test("inserted scene shifts nothing else's identity", () => {
    const old = rowsOf(V1);
    const v2 = V1.replace("EXT. CREEK - DAY",
      "INT. HALL - LATER\n\nA beat.\n\nEXT. CREEK - DAY");
    const d = diffScreenplay(old, linesToRows(parseFountain(v2)).lines);
    expect(d.removed).toBe(0);
    expect(d.kept).toBe(old.length);
    expect(d.added).toBe(4); // heading, blank, action, blank
    const creek = d.rows.find(
      (r) => r.content === "EXT. CREEK - DAY")!;
    expect(creek.uuid).toBe(
      old.find((r) => r.content === "EXT. CREEK - DAY")!.uuid);
  });

  test("deleting a block reports removals; the rest survives", () => {
    const old = rowsOf(V1);
    const v2 = V1.replace(
      "\nMARCUS\nI never left.\n", "");
    const d = diffScreenplay(old, linesToRows(parseFountain(v2)).lines);
    expect(d.removed).toBe(3);
    expect(d.added).toBe(0);
    expect(d.kept).toBe(old.length - 3);
  });

  test("duplicate lines (blanks) still match by position", () => {
    // Blanks are non-unique everywhere; the gap-filling pass must carry
    // their uuids by position, not leave them all unmatched.
    const old = rowsOf(V1);
    const d = diffScreenplay(old, linesToRows(parseFountain(V1)).lines);
    const blanks = d.rows.filter((r) => r.lineType === "blank");
    expect(blanks.every((r) => r.uuid !== undefined)).toBe(true);
  });
});
