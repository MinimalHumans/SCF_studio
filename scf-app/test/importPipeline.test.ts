// SPDX-License-Identifier: Apache-2.0
/**
 * importPipeline.test.ts — the whole Part 3 import path against a real
 * database, headless. This is the closest this environment gets to the
 * manual browser walk: prepare (repair→parse→propose) → applyImport
 * (entities machine-marked, rows blank-free, ids threaded) → the editor
 * loads it → export reproduces spec-shaped Fountain.
 */

import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { readScreenplay } from "@scf-core/screenplay/rowModel.ts";
import { parseFountain } from "@scf-core/fountain/index.ts";
import {
  applyImport, defaultAcceptance, prepareImport,
} from "../src/editor/importPipeline.ts";
import {
  blocksToFountain, rowsToBlocks,
} from "../src/editor/screenplayDoc.ts";
import { subjectStatsSql } from "../src/state/subjectStats.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, "../../scf-core/registry/registry.json");
const ALEXIS_NEXUS = join(
  HERE, "../../corpus/public/scripts/alexis-nexus.fountain");

let db: NodeDatabase;

beforeAll(async () => {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry);
});
afterAll(() => db.close());

describe("import pipeline end to end (Alexis Nexus, public tier)", () => {
  test("prepare -> accept best guess -> apply -> editable rows", async () => {
    const text = await readFile(ALEXIS_NEXUS, "utf8");
    const prepared = prepareImport(text, "fountain");
    expect(prepared.repairs).toEqual([]); // clean input: repair inert

    const accepted = defaultAcceptance(prepared.proposals);
    const result = await applyImport(db.exec, prepared, accepted);

    expect(result.scenes).toBe(prepared.proposals.scenes.length);
    expect(result.characters).toBe(accepted.characterNames.size);
    expect(result.props).toBe(0); // never by default
    expect(result.links).toBeGreaterThan(0);
    expect(result.lines).toBeGreaterThan(100);

    // Machine-created marking on every imported PRINCIPAL entity.
    // (Junctions have no identity columns in schema 2.3 — a stated gap;
    // the design's machine-marked links await an additive schema change.)
    for (const t of ["scene", "location", "character"]) {
      const unmarked = await db.exec(
        `SELECT COUNT(*) AS n FROM ${t} ` +
        `WHERE external_id_namespace IS NOT 'scf:import'`);
      expect(unmarked[0]!["n"], t).toBe(0);
    }

    // Rows are blank-free (blanks are never stored) and contiguous.
    const rows = (await readScreenplay(db.exec)).lines;
    expect(rows.length).toBe(result.lines);
    expect(rows.some((r) => r.lineType === "blank")).toBe(false);
    expect(rows.map((r) => r.lineOrder))
      .toEqual(rows.map((_, i) => i));

    // Threading: every non-heading row after the first heading carries a
    // scene id; heading rows carry their own scene's id.
    const firstHeading = rows.findIndex(
      (r) => r.lineType === "heading");
    expect(firstHeading).toBeGreaterThanOrEqual(0);
    const after = rows.slice(firstHeading);
    expect(after.every((r) => r.sceneId !== null)).toBe(true);

    // Dialogue rows carry their speaker where the cue was accepted.
    const cueRows = rows.filter((r) => r.lineType === "character" &&
                                       r.characterId !== null);
    expect(cueRows.length).toBeGreaterThan(0);
    for (const cue of cueRows.slice(0, 20)) {
      const next = rows[cue.lineOrder + 1];
      if (next !== undefined && next.lineType === "dialogue") {
        expect(next.characterId).toBe(cue.characterId);
      }
    }

    // The editor loads these rows and its export re-parses to the same
    // block sequence — the structured data IS the screenplay.
    const blocks = rowsToBlocks(rows);
    const exported = blocksToFountain(blocks);
    const reparsed = rowsToBlocks(
      (await import("@scf-core/screenplay/rowModel.ts"))
        .linesToRows(parseFountain(exported)).lines);
    expect(reparsed.map((b) => [b.type, b.text]))
      .toEqual(blocks.map((b) => [b.type, b.text]));

    // Scene links match the accepted character count per the proposals.
    const links = await db.exec(
      "SELECT COUNT(*) AS n FROM scene_character");
    expect(links[0]!["n"]).toBe(result.links);
  });
});

describe("accepted props are placed, not left floating", () => {
  test("each accepted prop gets a scene_prop row per scene it appears in",
       async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    const fresh = openNodeDatabase(":memory:");
    await initDatabase(fresh.exec, registry);
    try {
      const prepared = prepareImport(
        await readFile(ALEXIS_NEXUS, "utf8"), "fountain");
      // Take the strongest few, as a user ticking the top of the list
      // would — best-guess still accepts none.
      // The size of the medium tier is a property of the script, not of
      // the pipeline: assert that there is a tier to tick, then carry the
      // actual count through, rather than pinning a corpus-specific number.
      const picked = prepared.proposals.props
        .filter((p) => p.confidence === "medium").slice(0, 5);
      expect(picked.length).toBeGreaterThanOrEqual(3);
      const accepted = {
        ...defaultAcceptance(prepared.proposals),
        props: new Map(picked.map((p) => [p.name.toUpperCase(), p.name])),
      };

      const result = await applyImport(fresh.exec, prepared, accepted);
      expect(result.props).toBe(picked.length);
      expect(result.propLinks).toBe(
        picked.reduce((n, p) => n + p.sceneLines.length, 0));
      // More links than props means at least one prop appears in more than
      // one scene — the point of the placement pass.
      expect(result.propLinks).toBeGreaterThan(picked.length);

      const rows = await fresh.exec(
        "SELECT p.name AS prop, s.scene_number AS scene " +
        "FROM scene_prop sp " +
        "JOIN prop p ON p.id = sp.prop_id " +
        "JOIN scene s ON s.id = sp.scene_id");
      expect(rows.length).toBe(result.propLinks);
      // No orphans: every link names a real prop and a real scene.
      expect(rows.every((r) => r["prop"] !== null && r["scene"] !== null))
        .toBe(true);
      // And a prop that was read from two scenes lands in two scenes.
      const perProp = new Map<string, number>();
      for (const r of rows) {
        const k = String(r["prop"]);
        perProp.set(k, (perProp.get(k) ?? 0) + 1);
      }
      for (const p of picked) {
        expect(perProp.get(p.name), p.name).toBe(p.sceneLines.length);
      }
    } finally {
      fresh.close();
    }
  });
});

describe("subject rail statistics run against a real database", () => {
  test("counts and first appearances come back for every path shape",
       async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    const fresh = openNodeDatabase(":memory:");
    await initDatabase(fresh.exec, registry);
    try {
      const prepared = prepareImport(
        await readFile(ALEXIS_NEXUS, "utf8"), "fountain");
      await applyImport(fresh.exec, prepared,
                        defaultAcceptance(prepared.proposals));

      // character: reached through a junction.
      // location:  reached by scene pointing at it.
      // scene:     its own position, plus 38 incoming paths.
      for (const subject of ["character", "location", "scene"]) {
        const sql = subjectStatsSql(registry, subject);
        expect(sql, subject).not.toBe(null);
        const rows = await fresh.exec(sql!);
        expect(rows.length, subject).toBeGreaterThan(0);
        for (const r of rows) {
          expect(Number(r["uses"])).toBeGreaterThan(0);
          expect(Number(r["scenes"])).toBeGreaterThan(0);
          expect(Number(r["first_scene_id"])).toBeGreaterThan(0);
        }
      }

      // The busiest character should be one of the leads, not a walk-on.
      const charStats = await fresh.exec(
        subjectStatsSql(registry, "character")! +
        " ORDER BY uses DESC LIMIT 1");
      const topId = Number(charStats[0]!["sid"]);
      const top = await fresh.exec(
        "SELECT name FROM character WHERE id = ?", [topId]);
      expect(String(top[0]!["name"]).length).toBeGreaterThan(0);
      expect(Number(charStats[0]!["scenes"])).toBeGreaterThan(1);
    } finally {
      fresh.close();
    }
  });
});
