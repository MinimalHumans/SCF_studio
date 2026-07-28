/**
 * celtx.test.ts — the import-normalization contract, pinned on the real
 * Celtx export that motivated it (skipped when the private corpus is
 * absent), plus commit-time linking/creation against a real database.
 */

import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFountain } from "@scf-core/fountain/index.ts";
import { linesToRows } from "@scf-core/screenplay/rowModel.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { rowsToBlocks, stripMarker } from "../src/editor/screenplayDoc.ts";
import { linkAndCreateAtCommit } from "../src/editor/features.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CELTX = join(
  HERE, "../../corpus/private/fountain/alexis-nexus-celtx.fountain");
const REGISTRY = join(HERE, "../../scf-core/registry/registry.json");

describe("stripMarker: layout whitespace and Celtx artifacts", () => {
  test("leading indentation trims for everything except action", () => {
    expect(stripMarker("character", "                ALEXIS"))
      .toBe("ALEXIS");
    expect(stripMarker("dialogue", "    Well, Mags, time to go."))
      .toBe("Well, Mags, time to go.");
    expect(stripMarker("parenthetical", "    (reluctantly)"))
      .toBe("(reluctantly)");
    expect(stripMarker("action", "    indented action stays"))
      .toBe("    indented action stays");
  });

  test("Celtx's stray '!' on dialogue strips; action's forced '!' too",
      () => {
    expect(stripMarker("dialogue", "!Um, sorry, but I think..."))
      .toBe("Um, sorry, but I think...");
    expect(stripMarker("action", "!We cut wider to reveal..."))
      .toBe("We cut wider to reveal...");
  });
});

describe.skipIf(!existsSync(CELTX))("the Alexis Celtx export", () => {
  test("blocks come out clean: no layout indents, no stray bangs",
      () => {
    const text = readFileSync(CELTX, "utf8");
    const blocks = rowsToBlocks(linesToRows(parseFountain(text)).lines);
    const cues = blocks.filter((b) => b.type === "character");
    expect(cues.length).toBeGreaterThan(400);
    expect(cues.every((b) => !b.text.startsWith(" "))).toBe(true);
    const dialogue = blocks.filter((b) => b.type === "dialogue");
    expect(dialogue.every((b) => !b.text.startsWith("!") &&
                                 !b.text.startsWith(" "))).toBe(true);
    expect(blocks.filter((b) => b.type === "heading")).toHaveLength(127);
  });
});

describe("linkAndCreateAtCommit", () => {
  let db: NodeDatabase;
  beforeAll(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec(
      "INSERT INTO character (name) VALUES ('Alexis')"); // pre-existing
  });
  afterAll(() => db.close());

  test("new heading creates scene+location; new cue creates character; " +
       "existing cue matches; junctions and threading follow", async () => {
    const rows = [
      { lineOrder: 0, lineType: "heading",
        content: "EXT. MONUMENT VALLEY - DAY", sceneId: null,
        characterId: null, locationId: null, metadata: null, uuid: "a" },
      { lineOrder: 1, lineType: "action", content: "Egg sizzles.",
        sceneId: null, characterId: null, locationId: null,
        metadata: null, uuid: "b" },
      { lineOrder: 2, lineType: "character", content: "ALEXIS",
        sceneId: null, characterId: null, locationId: null,
        metadata: null, uuid: "c" },
      { lineOrder: 3, lineType: "dialogue", content: "Time to ride.",
        sceneId: null, characterId: null, locationId: null,
        metadata: null, uuid: "d" },
      { lineOrder: 4, lineType: "character", content: "MAGS (V.O.)",
        sceneId: null, characterId: null, locationId: null,
        metadata: null, uuid: "e" },
      { lineOrder: 5, lineType: "dialogue", content: "Squawk.",
        sceneId: null, characterId: null, locationId: null,
        metadata: null, uuid: "f" },
    ];
    const result = await linkAndCreateAtCommit(db.exec, rows);
    expect(result.scenesCreated).toBe(1);
    expect(result.locationsCreated).toBe(1);
    expect(result.charactersCreated).toBe(1); // Mags; Alexis matched
    expect(result.linksCreated).toBe(2);

    // Threading: everything under the heading carries its scene; the
    // dialogue lines carry their speakers.
    expect(rows.every((r) => r.sceneId !== null)).toBe(true);
    expect(rows[3]!.characterId).toBe(rows[2]!.characterId);
    expect(rows[5]!.characterId).toBe(rows[4]!.characterId);
    expect(rows[2]!.characterId).not.toBe(rows[4]!.characterId);

    // Alexis matched the PRE-EXISTING row, case-insensitively.
    const alexis = await db.exec(
      "SELECT COUNT(*) AS n FROM character WHERE name LIKE 'Alexis'");
    expect(alexis[0]!["n"]).toBe(1);
    // Editor-created entities carry the scf:editor namespace.
    const mags = await db.exec(
      "SELECT external_id_namespace AS ns FROM character " +
      "WHERE name = 'Mags'");
    expect(mags[0]!["ns"]).toBe("scf:editor");
    const loc = await db.exec("SELECT name, external_id_namespace AS ns " +
                              "FROM location");
    expect(loc[0]!["name"]).toBe("Monument Valley");
    expect(loc[0]!["ns"]).toBe("scf:editor");

    // Idempotent: running again creates nothing.
    const again = await linkAndCreateAtCommit(db.exec, rows);
    expect(again.scenesCreated + again.locationsCreated +
           again.charactersCreated + again.linksCreated).toBe(0);
  });
});

describe("repair: export-mangled apostrophes", () => {
  test("letter + \\u0080?\\uFFFD becomes an apostrophe, reported", async () => {
    const { repairConversionArtifacts } =
      await import("@scf-core/fountain/repair.ts");
    const { text, repairs } = repairConversionArtifacts(
      ".INT. ALEXIS\u0080\uFFFD BEDROOM - NIGHT\n\nShe\uFFFDs here.\n");
    expect(text).toBe(".INT. ALEXIS' BEDROOM - NIGHT\n\nShe's here.\n");
    expect(repairs).toHaveLength(2);
    expect(repairs[0]!.rule).toBe("mangled-apostrophe");
  });

  test("inert without a preceding letter and on clean text", async () => {
    const { repairConversionArtifacts } =
      await import("@scf-core/fountain/repair.ts");
    const clean = repairConversionArtifacts("INT. HOUSE - DAY\n");
    expect(clean.repairs).toEqual([]);
    // A replacement char NOT after a letter is not our pattern: kept.
    const kept = repairConversionArtifacts("\uFFFD odd start\n");
    expect(kept.text).toBe("\uFFFD odd start\n");
    expect(kept.repairs).toEqual([]);
  });
});
