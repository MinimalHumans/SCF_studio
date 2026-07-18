/**
 * screenplay.test.ts — Stages 2 and 3.
 *
 * Stage 2: the row model round-trips text byte-stable through rows AND
 * through the database (v1's tables, now created by initDatabase);
 * applyAssignments threads context deterministically and creates nothing.
 *
 * Stage 3: proposals against the corpus. Frankenstein (public) pins the
 * clean-input behavior; Aliens (private, when present) pins the payoff —
 * converter garbage arriving as low-confidence, suspicion-annotated
 * proposals instead of entities. acceptBestGuess must exclude every
 * suspect cue.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { parseFountain } from "../src/fountain/index.ts";
import {
  applyAssignments, initScreenplayTables, linesToRows, readScreenplay,
  rowsToText, writeScreenplay,
} from "../src/screenplay/rowModel.ts";
import { acceptBestGuess, normalizeCue, parseHeading, propose }
  from "../src/proposals/propose.ts";
import { initDatabase } from "../src/db.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "..", "..", "corpus");
const FRANKENSTEIN =
  join(CORPUS, "public", "scripts", "frankenstein-2025.fountain");
const ALIENS =
  join(CORPUS, "private", "fountain", "aliens-1986.fountain.txt");

// ---------------------------------------------------------------------------
// Stage 2
// ---------------------------------------------------------------------------

const SAMPLE = `INT. KITCHEN - NIGHT #2#

Eleanor sets the KETTLE on the stove.

ELEANOR
You came back.

MARCUS (V.O.)
(quietly)
I never left.

EXT. CREEK - DAY

Water over stones.`;

describe("stage 2: row model", () => {
  test("text -> rows -> text is byte-stable (no title page)", () => {
    for (const text of [SAMPLE, SAMPLE + "\n", "\uFEFF" + SAMPLE,
                        SAMPLE.replaceAll("\n", "\r\n")]) {
      const rows = linesToRows(parseFountain(text));
      expect(rowsToText(rows)).toBe(text);
    }
  });

  test("full corpus scripts are byte-stable through rows", () => {
    const text = readFileSync(FRANKENSTEIN, "utf8");
    const doc = parseFountain(text);
    const hasTitle = doc.lines.some((l) => l.type === "title_page");
    if (!hasTitle) {
      expect(rowsToText(linesToRows(doc))).toBe(text);
    } else {
      // Title pages re-emit from key/value rows (normalized whitespace);
      // the body after the title block must still be byte-identical.
      const rows = linesToRows(doc);
      const body = rowsToText({ ...rows, titlePage: [], bom: false });
      const originalBody = text.slice(text.indexOf("\n\n") + 2);
      expect(body.endsWith(originalBody)).toBe(true);
    }
  });

  test("metadata carries stage-1 meta and non-default eols", () => {
    const rows = linesToRows(parseFountain(
      "INT. A - DAY #7#\r\n\r\nELEANOR (V.O.)\nHi.")).lines;
    expect(rows[0]!.metadata).toMatchObject(
      { eol: "\r\n", sceneNumber: "7" });
    expect(rows[2]!.metadata).toMatchObject(
      { character: { name: "ELEANOR", extensions: ["V.O."] } });
    // The final unterminated line records eol:"" — byte fidelity
    // requires it (a null here would append a newline on export).
    expect(rows[3]!.metadata).toEqual({ eol: "" });
  });

  test("applyAssignments threads context and creates nothing", () => {
    const rows = linesToRows(parseFountain(SAMPLE)).lines;
    const headings = rows.filter((r) => r.lineType === "heading");
    const cues = rows.filter((r) => r.lineType === "character");
    const threaded = applyAssignments(
      rows,
      new Map([[headings[0]!.lineOrder, 101],
               [headings[1]!.lineOrder, 102]]),
      new Map([[cues[0]!.lineOrder, 7], [cues[1]!.lineOrder, 8]]));
    // Everything up to the second heading is scene 101, after it 102.
    const secondHeading = headings[1]!.lineOrder;
    for (const r of threaded) {
      expect(r.sceneId).toBe(r.lineOrder < secondHeading ? 101 : 102);
    }
    // Dialogue + parenthetical inherit their cue's character.
    const marcusBlock = threaded.filter(
      (r) => r.lineOrder > cues[1]!.lineOrder &&
             (r.lineType === "dialogue" || r.lineType === "parenthetical"));
    expect(marcusBlock.every((r) => r.characterId === 8)).toBe(true);
    // Action lines carry no character.
    expect(threaded.find((r) => r.content.includes("KETTLE"))!
      .characterId).toBeNull();
    // Input untouched.
    expect(rows.every((r) => r.sceneId === null)).toBe(true);
  });
});

describe("stage 2: database round-trip and parity", () => {
  let db: NodeDatabase;
  let fx: Fixture;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    fx = openFixture();
  });
  afterAll(() => {
    db.close();
    fx.close();
  });

  test("initDatabase now creates the screenplay tables with uuid + 2.3",
      async () => {
    const tables = await db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' " +
      "AND name LIKE 'screenplay%'");
    expect(new Set(tables.map((r) => r["name"]))).toEqual(new Set([
      "screenplay_lines", "screenplay_title_page", "screenplay_versions",
      "screenplay_version_lines", "screenplay_version_title_page",
      "screenplay_prop_tags",
    ]));
    // 2.3 identity extends exactly to the tables Python's migration
    // covers (title-page key/value rows are config, not identity rows).
    for (const t of registry.uuidExtraTables) {
      const cols = await db.exec(`PRAGMA table_info("${t}")`);
      expect(cols.map((c) => c["name"]), t).toContain("uuid");
    }
    const tp = await db.exec('PRAGMA table_info("screenplay_title_page")');
    expect(tp.map((c) => c["name"])).not.toContain("uuid");
  });

  test("screenplay table columns match the fixture (parity extends)",
      async () => {
    for (const t of ["screenplay_lines", "screenplay_title_page",
                     "screenplay_versions", "screenplay_version_lines",
                     "screenplay_version_title_page",
                     "screenplay_prop_tags"]) {
      const ours = (await db.exec(`PRAGMA table_info("${t}")`))
        .map((c) => String(c["name"])).sort();
      const theirs = (await fx.ctx.exec(`PRAGMA table_info("${t}")`))
        .map((c) => String(c["name"])).sort();
      expect(ours, `columns of ${t}`).toEqual(theirs);
    }
  });

  test("write/read round-trip preserves rows, metadata, and text",
      async () => {
    const sp = linesToRows(parseFountain(SAMPLE));
    await writeScreenplay(db.exec, sp);
    const back = await readScreenplay(db.exec);
    expect(back.lines.map((l) => [l.lineOrder, l.lineType, l.content]))
      .toEqual(sp.lines.map((l) => [l.lineOrder, l.lineType, l.content]));
    expect(back.lines.every((l) => l.uuid !== undefined &&
                                   l.uuid.length === 36)).toBe(true);
    expect(rowsToText({ ...back, bom: false })).toBe(SAMPLE);
  });
});

// ---------------------------------------------------------------------------
// Stage 3
// ---------------------------------------------------------------------------

describe("stage 3: heading parsing and cue normalization", () => {
  test("parseHeading splits int/ext, location, time, number", () => {
    expect(parseHeading("INT. ELEANOR'S KITCHEN - NIGHT #12#")).toEqual({
      intExt: "INT", locationName: "ELEANOR'S KITCHEN",
      timeOfDay: "NIGHT", sceneNumber: "12",
    });
    expect(parseHeading("I/E BARN - MOMENTS LATER").intExt)
      .toBe("INT/EXT");
    expect(parseHeading(".MONTAGE - THE SEASONS TURN").locationName)
      .not.toBeNull();
  });

  test("normalizeCue shows its work on corpus damage patterns", () => {
    const quoted = normalizeCue('"RIPLEY');
    expect(quoted.name).toBe("RIPLEY");
    expect(quoted.steps.some((s) => s.step.includes("quotes"))).toBe(true);

    const starred = normalizeCue("**RIPLEY **");
    expect(starred.name).toBe("RIPLEY");

    const sentence = normalizeCue(
      "Ignoring the man she grabs the cat and hugs it to her.");
    expect(sentence.suspicions).toContain("!forced cue reads like prose");
    expect(sentence.suspicions).toContain("!reads like a sentence");

    const furniture = normalizeCue("(CONTINUED) A86");
    expect(furniture.suspicions.some(
      (s) => s.includes("page furniture"))).toBe(true);

    const transitiony = normalizeCue("DISSOLVE TO: A86");
    expect(transitiony.suspicions.length).toBeGreaterThan(0);
  });
});

describe("stage 3: proposals on Frankenstein (public tier)", () => {
  const doc = parseFountain(readFileSync(FRANKENSTEIN, "utf8"));
  const p = propose(doc);

  test("scene proposals are one per heading, high confidence", () => {
    const headings = doc.lines.filter((l) => l.type === "heading");
    expect(p.scenes.length).toBe(headings.length);
    expect(p.scenes.every((s) => s.confidence === "high")).toBe(true);
  });

  test("locations dedup across headings", () => {
    expect(p.locations.length).toBeGreaterThan(0);
    expect(p.locations.length).toBeLessThan(p.scenes.length);
    const total = p.locations.reduce((n, l) => n + l.occurrences, 0);
    expect(total).toBe(p.scenes.filter(
      (s) => s.locationName !== null).length);
  });

  test("speaking characters propose at accept-worthy confidence", () => {
    const accepted = acceptBestGuess(p);
    expect(accepted.characters.length).toBeGreaterThan(2);
    expect(accepted.machineCreated).toBe(true);
    // Every accepted character actually speaks (has cue lines).
    expect(accepted.characters.every((c) => c.occurrences >= 1))
      .toBe(true);
    // Links only reference accepted characters.
    const names = new Set(accepted.characters.map((c) => c.name));
    expect(accepted.links.every((l) => names.has(l.characterName)))
      .toBe(true);
  });

  test("props are never auto-accepted", () => {
    expect(acceptBestGuess(p).props).toEqual([]);
    // …but candidates exist for the staging screen.
    expect(p.props.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!existsSync(ALIENS))(
  "stage 3: the corpus payoff (Aliens, private tier)", () => {
  const doc = parseFountain(readFileSync(ALIENS, "utf8"));
  const p = propose(doc);
  const accepted = acceptBestGuess(p);

  test("converter garbage arrives as suspicions, not entities", () => {
    const bad = p.characters.filter((c) => c.suspicions.length > 0);
    expect(bad.length).toBeGreaterThan(30); // the ~89 sus cues surface
    expect(bad.every((c) => c.confidence !== "high")).toBe(true);
  });

  test("accept-best-guess keeps the real cast, drops the garbage", () => {
    const names = accepted.characters.map((c) => c.name.toUpperCase());
    for (const real of ["RIPLEY", "HICKS", "HUDSON", "NEWT", "BURKE",
                        "BISHOP", "VASQUEZ", "GORMAN"]) {
      expect(names, `missing ${real}`).toContain(real);
    }
    for (const c of accepted.characters) {
      expect(c.name.length, `garbage accepted: ${c.name}`)
        .toBeLessThanOrEqual(30);
      expect(/[a-z]{3,}/.test(c.name),
             `sentence accepted: ${c.name}`).toBe(false);
    }
  });

  test("quote-wrapped cues merge into their clean counterparts", () => {
    // "RIPLEY and **RIPLEY ** normalize into RIPLEY's group.
    const ripley = p.characters.find(
      (c) => c.name.toUpperCase() === "RIPLEY");
    expect(ripley).toBeDefined();
    expect(ripley!.rawCues.length).toBeGreaterThan(1);
    expect(ripley!.normalizations.length).toBeGreaterThan(0);
  });
});

describe("stage 3: leak patterns pinned (each once accepted, then fixed)",
    () => {
  const low = (raw: string): void => {
    const doc = parseFountain(`\n${raw}\nSome dialogue follows.\n`);
    const p = propose(doc);
    const match = p.characters.find((c) => c.rawCues.includes(raw));
    expect(match, raw).toBeDefined();
    expect(match!.confidence, `${raw} must stay out of best-guess`)
      .toBe("low");
  };

  test("digit-heavy furniture (OUT 35 35)", () => low("OUT 35 35"));
  test("stopword cue (@The)", () => low("@The"));
  test("long caps phrase (SECOND GRADE CITIZENSHIP AWARD)", () =>
    low("SECOND GRADE CITIZENSHIP AWARD"));
  test("number-glued heading (182-82-INT. CORRIDOR)", () =>
    low("182-82-INT. CORRIDOR - ELEVATORS"));

  test("OCR variants demote to merge candidates of the clean cue", () => {
    const doc = parseFountain(
      "\nRIPLEY\nOne.\n\nRIPLEY\nTwo.\n\nRIPL.EY\nThree.\n\n" +
      "\\_ GORMAN\nFour.\n\nGORMAN\nFive.\n");
    const p = propose(doc);
    const ripley = p.characters.find((c) => c.name === "RIPLEY")!;
    const variant = p.characters.find((c) => c.name === "RIPL.EY")!;
    expect(variant.confidence).toBe("low");
    expect(variant.suspicions.some((s) => s.includes("near-duplicate")))
      .toBe(true);
    expect(ripley.mergeCandidates).toContain("RIPL.EY");
    // "\_ GORMAN" strips its edge artifacts and merges into GORMAN's
    // group outright — one proposal, two raw cues.
    const gorman = p.characters.find((c) => c.name === "GORMAN")!;
    expect(gorman.rawCues.length).toBe(2);
    const accepted = acceptBestGuess(p).characters.map((c) => c.name);
    expect(accepted).toContain("RIPLEY");
    expect(accepted).toContain("GORMAN");
    expect(accepted).not.toContain("RIPL.EY");
  });
});
