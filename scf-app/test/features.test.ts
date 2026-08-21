// SPDX-License-Identifier: Apache-2.0
/**
 * features.test.ts — beats (G5), versions, prop tags, headless against a
 * real database. The re-anchoring tests exercise the exact contract the
 * lineState events were designed for.
 */

import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { parseFountain } from "@scf-core/fountain/index.ts";
import { linesToRows, writeScreenplay }
  from "@scf-core/screenplay/rowModel.ts";
import {
  beatAnchoredLineIds, beatsForLine, createBeatForLine,
  diffVersionAgainstCurrent, listVersions, publishVersion,
  reanchorForEvents, tagPropRange, validateTags,
} from "../src/editor/features.ts";
import { rowsToBlocks } from "../src/editor/screenplayDoc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, "../../scf-core/registry/registry.json");

const SCRIPT = `INT. KITCHEN - NIGHT

Eleanor sets the kettle on.

ELEANOR
You came back.

MARCUS
I never left.`;

let db: NodeDatabase;

beforeAll(async () => {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry);

  // Seed entities + screenplay rows (blank-free blocks, ids threaded).
  await db.exec("INSERT INTO scene (name) VALUES ('Kitchen night')");
  await db.exec("INSERT INTO character (name) VALUES ('Eleanor')");
  await db.exec("INSERT INTO prop (name) VALUES ('Kettle')");
  const rows = linesToRows(parseFountain(SCRIPT)).lines;
  rows.forEach((r, i) => { r.uuid = `line-${i}`; });
  const blocks = rowsToBlocks(rows);
  await writeScreenplay(db.exec, {
    bom: false, titlePage: [],
    lines: blocks.map((b, i) => ({
      lineOrder: i, lineType: b.type, content: b.text,
      sceneId: 1,
      characterId: b.type === "dialogue" && b.text.includes("came")
        ? 1 : null,
      locationId: null, metadata: null, uuid: b.id,
    })),
  });
});
afterAll(() => db.close());

describe("beats: G5 line_ref authoring and re-anchoring", () => {
  test("createBeatForLine anchors to the line uuid", async () => {
    const id = await createBeatForLine(db.exec, {
      id: "line-4", type: "dialogue", text: "You came back.",
      sceneId: 1, characterId: 1, locationId: null, metadata: null,
    }, "vocal", "You came back.");
    expect(id).not.toBeNull();
    const beats = await beatsForLine(db.exec, "line-4");
    expect(beats).toHaveLength(1);
    expect(beats[0]!["modality"]).toBe("vocal");
    expect(beats[0]!["character_name"]).toBe("Eleanor");
    expect(beats[0]!["line_ref"]).toBe("line-4");
    expect((await beatAnchoredLineIds(db.exec)).has("line-4")).toBe(true);
  });

  test("refuses lines without scene + character context", async () => {
    const id = await createBeatForLine(db.exec, {
      id: "line-1", type: "action", text: "x", sceneId: 1,
      characterId: null, locationId: null, metadata: null,
    }, "physical", "x");
    expect(id).toBeNull();
  });

  test("merge re-anchors to the survivor; split needs nothing",
      async () => {
    const moved = await reanchorForEvents(db.exec, [
      { kind: "split", originalId: "line-4", newIds: ["fresh-1"] },
      { kind: "merge", survivorId: "line-3", absorbedIds: ["line-4"] },
    ]);
    expect(moved).toBe(1);
    expect(await beatsForLine(db.exec, "line-4")).toHaveLength(0);
    const onSurvivor = await beatsForLine(db.exec, "line-3");
    expect(onSurvivor).toHaveLength(1);
    // put it back for later tests
    await reanchorForEvents(db.exec, [
      { kind: "merge", survivorId: "line-4", absorbedIds: ["line-3"] },
    ]);
  });
});

describe("versions: snapshot and diff", () => {
  test("publish snapshots lines with counts; diff sees edits",
      async () => {
    const v1 = await publishVersion(db.exec, "first draft");
    const versions = await listVersions(db.exec);
    expect(versions).toHaveLength(1);
    expect(versions[0]!["version_number"]).toBe(1);
    expect(versions[0]!["line_count"]).toBe(6);
    expect(versions[0]!["scene_count"]).toBe(1);
    expect(versions[0]!["word_count"]).toBeGreaterThan(10);

    const clean = await diffVersionAgainstCurrent(db.exec, v1);
    expect(clean.kept).toBe(6);
    expect(clean.added).toBe(0);
    expect(clean.removed).toBe(0);

    // Edit one line, add one line — diff reports it against v1.
    await db.exec(
      "UPDATE screenplay_lines SET content = 'You actually came back.' " +
      "WHERE uuid = 'line-4'");
    await db.exec(
      `INSERT INTO screenplay_lines
         (line_order, line_type, content, uuid)
       VALUES (6, 'action', 'She smiles.', 'line-new')`);
    const diff = await diffVersionAgainstCurrent(db.exec, v1);
    expect(diff.kept).toBe(5);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);

    const v2 = await publishVersion(db.exec, "revised");
    const clean2 = await diffVersionAgainstCurrent(db.exec, v2);
    expect(clean2.added + clean2.removed).toBe(0);
  });
});

describe("prop tags: block-anchored ranges, honest validation", () => {
  test("anchored -> reanchored -> detached lifecycle", async () => {
    // "Eleanor sets the kettle on." — tag "kettle" at its offsets.
    const text = "Eleanor sets the kettle on.";
    const at = text.indexOf("kettle");
    await tagPropRange(db.exec, "line-1", 1, "kettle", at, at + 6);

    let tags = await validateTags(db.exec,
      new Map([["line-1", text]]));
    expect(tags[0]!.status).toBe("anchored");

    // Text edited before the word: offsets stale, text present.
    tags = await validateTags(db.exec,
      new Map([["line-1", "She sets the kettle on."]]));
    expect(tags[0]!.status).toBe("reanchored");
    expect(tags[0]!.startOffset).toBe(13);
    // Persisted: validating again with the same text is anchored.
    tags = await validateTags(db.exec,
      new Map([["line-1", "She sets the kettle on."]]));
    expect(tags[0]!.status).toBe("anchored");

    // Word removed entirely: detached, row NOT deleted.
    tags = await validateTags(db.exec,
      new Map([["line-1", "She sets the pot on."]]));
    expect(tags[0]!.status).toBe("detached");
    const still = await db.exec(
      "SELECT COUNT(*) AS n FROM screenplay_prop_tags");
    expect(still[0]!["n"]).toBe(1);
  });
});
