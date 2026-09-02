// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { initScreenplayTables } from "@scf-core/screenplay/rowModel.ts";
import {
  deleteSceneCharacter, scanIntegrity, unanchorBeat,
} from "../src/editor/integrity.ts";
import { syncPropSceneLinks, tagPropRange }
  from "../src/editor/features.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("script integrity", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);

    await db.exec("INSERT INTO scene (name, scene_number) VALUES ('KITCHEN', 1)");
    await db.exec("INSERT INTO character (name) VALUES ('Alexis')");
    await db.exec("INSERT INTO prop (name) VALUES ('Kettle')");
    // A script holding the heading and one cue for Alexis.
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, uuid) VALUES (0, 'heading', 'INT. KITCHEN - DAY', 1, 'L-head')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, character_id, uuid) VALUES " +
      "(1, 'character', 'ALEXIS', 1, 1, 'L-cue')");
  });

  const live = (...ids: string[]) => new Set(ids);

  test("a tag on a line that is gone is reported", async () => {
    await db.exec(
      "INSERT INTO screenplay_prop_tags (tagged_text, prop_id, " +
      "line_uuid, start_offset, end_offset) " +
      "VALUES ('kettle', 1, 'L-dead', 0, 6)");
    const report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.detachedTags).toHaveLength(1);
    expect(report.detachedTags[0]!.propName).toBe("Kettle");
  });

  test("a tag on a live line is not", async () => {
    await db.exec(
      "INSERT INTO screenplay_prop_tags (tagged_text, prop_id, " +
      "line_uuid, start_offset, end_offset) " +
      "VALUES ('kettle', 1, 'L-cue', 0, 6)");
    const report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.detachedTags).toHaveLength(0);
  });

  test("a beat anchored to a dead line is reported, and can keep its scene",
       async () => {
    await db.exec(
      "INSERT INTO performance_beat (name, scene_id, character_id, " +
      "modality, line_ref, line_text) " +
      "VALUES ('Beat', 1, 1, 'vocal', 'L-dead', 'Not tonight.')");
    let report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.orphanBeats).toHaveLength(1);
    expect(report.orphanBeats[0]!.characterName).toBe("Alexis");

    await unanchorBeat(db.exec, report.orphanBeats[0]!.id);
    report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.orphanBeats).toHaveLength(0);
    // Unanchoring keeps the beat itself — only the dead line ref goes.
    const rows = await db.exec(
      "SELECT scene_id, line_ref FROM performance_beat");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["scene_id"]).toBe(1);
    expect(rows[0]!["line_ref"]).toBeNull();
  });

  test("a cast link the script still shows is left alone", async () => {
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 1, 1)");
    const report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.unjustifiedLinks).toHaveLength(0);
  });

  test("a cast link whose cue lines were deleted is reported", async () => {
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 1, 1)");
    // The scene keeps its action. That matters now: the report asks
    // whether a WRITTEN scene shows this character, so the scene has to
    // be written — see the slugline-only case below.
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "uuid) VALUES (2, 'action', 'The kettle boils. Nobody comes.', " +
      "'L-act')");
    // The author deletes Alexis's dialogue. writeScreenplay rewrites the
    // line table; nothing has ever swept the junction.
    await db.exec("DELETE FROM screenplay_lines WHERE uuid = 'L-cue'");
    const report = await scanIntegrity(db.exec, live("L-head", "L-act"));
    expect(report.unjustifiedLinks).toHaveLength(1);
    expect(report.unjustifiedLinks[0]!.characterName).toBe("Alexis");
    expect(report.unjustifiedLinks[0]!.sceneNumber).toBe("1");

    await deleteSceneCharacter(db.exec, report.unjustifiedLinks[0]!.id);
    expect((await scanIntegrity(db.exec, live("L-head", "L-act"))).total)
      .toBe(0);
  });

  test("a slugline with nothing under it justifies nothing either way",
       async () => {
    // The behaviour that changed. A heading alone does not show the
    // character — but it does not show ANYONE, and "not written yet" and
    // "written without them" are the same file. The conformance fixture
    // is mostly this shape on purpose (four scenes carry dialogue, the
    // rest stay sluglines), and reporting it called twelve deliberate
    // links leftovers.
    await db.exec("DELETE FROM screenplay_lines WHERE uuid = 'L-cue'");
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 1, 1)");
    const report = await scanIntegrity(db.exec, live("L-head"));
    expect(report.unjustifiedLinks).toHaveLength(0);
  });

  test("a cue justifies its link through the heading above it, not " +
       "its own scene_id", async () => {
    // Spec §3.4: a scene's text runs from its heading to the next one,
    // and a reader MUST NOT rely on screenplay_lines.scene_id. Only
    // headings carry it in a file this editor did not write — the
    // fixture leaves it null on all eleven of its cue lines — so
    // reading it here made the answer depend on who wrote the file.
    await db.exec("UPDATE screenplay_lines SET scene_id = NULL " +
                  "WHERE uuid = 'L-cue'");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "uuid) VALUES (2, 'dialogue', 'Not tonight.', 'L-dlg')");
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 1, 1)");
    const report = await scanIntegrity(
      db.exec, live("L-head", "L-cue", "L-dlg"));
    expect(report.unjustifiedLinks).toHaveLength(0);
  });

  test("a cue in the previous scene does not justify a link in this one",
       async () => {
    // The other half of the walk: agreeing that scene_id is the wrong
    // column is worth nothing if the replacement matches every line in
    // the file. Alexis speaks in scene 1 and is linked to scene 2.
    await db.exec("INSERT INTO scene (name, scene_number) " +
                  "VALUES ('RIDGE', 2)");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, uuid) VALUES " +
      "(2, 'heading', 'EXT. RIDGE - NIGHT', 2, 'L-head2')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "uuid) VALUES (3, 'action', 'Rain on the shale.', 'L-act2')");
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 2, 1)");
    const report = await scanIntegrity(
      db.exec, live("L-head", "L-cue", "L-head2", "L-act2"));
    expect(report.unjustifiedLinks).toHaveLength(1);
    expect(report.unjustifiedLinks[0]!.sceneNumber).toBe("2");
  });

  test("a scene with no heading in the script is never called unjustified",
       async () => {
    // An outlined scene's cast is authored, not derived — reporting it
    // would flag every scene the author has not written yet.
    await db.exec("INSERT INTO scene (name) VALUES ('RIDGE')");
    await db.exec(
      "INSERT INTO scene_character (name, scene_id, character_id) " +
      "VALUES ('ALEXIS', 2, 1)");
    const report = await scanIntegrity(db.exec, live("L-head", "L-cue"));
    expect(report.unjustifiedLinks).toHaveLength(0);
  });

  test("a clean script reports nothing", async () => {
    expect((await scanIntegrity(db.exec, live("L-head", "L-cue"))).total)
      .toBe(0);
  });
});

/**
 * Tagging a prop must also record that the prop is in the scene.
 *
 * Every query that asks "which props are in this scene" reads
 * scene_prop, including the Scene Rail's prop filter — so a prop created
 * by tagging appeared nowhere in that filter while imported props did,
 * because the importer writes the junction and tagging did not.
 */
describe("prop tagging links the scene", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);
    await db.exec("INSERT INTO scene (name) VALUES ('KITCHEN')");
    await db.exec("INSERT INTO prop (name) VALUES ('Kettle')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, uuid) VALUES (0, 'heading', 'INT. KITCHEN - DAY', 1, 'H1')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "uuid) VALUES (1, 'action', 'She fills the kettle.', 'L1')");
  });

  const links = async (): Promise<number> =>
    (await db.exec("SELECT id FROM scene_prop")).length;

  test("the junction is written from the governing heading", async () => {
    await tagPropRange(db.exec, "L1", 1, "kettle", 9, 15);
    const rows = await db.exec("SELECT scene_id, prop_id FROM scene_prop");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["scene_id"]).toBe(1);
    expect(rows[0]!["prop_id"]).toBe(1);
  });

  test("tagging the same prop twice in one scene links it once",
       async () => {
    await tagPropRange(db.exec, "L1", 1, "kettle", 9, 15);
    await tagPropRange(db.exec, "H1", 1, "KITCHEN", 5, 12);
    expect(await links()).toBe(1);
    // Both tags are kept — only the junction is deduplicated.
    expect(await db.exec("SELECT id FROM screenplay_prop_tags"))
      .toHaveLength(2);
  });

  test("a line with no heading above it links nothing", async () => {
    await db.exec("DELETE FROM screenplay_lines WHERE uuid = 'H1'");
    await tagPropRange(db.exec, "L1", 1, "kettle", 9, 15);
    expect(await links()).toBe(0);
    // The tag still stands; only the scene claim is withheld.
    expect(await db.exec("SELECT id FROM screenplay_prop_tags"))
      .toHaveLength(1);
  });
});

/**
 * The junction is also DERIVED at commit, because tagging is exactly the
 * moment someone writes a line and tags it in the same breath — the line
 * may not be in screenplay_lines yet, and its heading may not have a
 * scene record yet either. Deriving makes the link independent of when
 * the tag was made.
 */
describe("prop scene links derived at commit", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await initScreenplayTables(db.exec);
    await db.exec("INSERT INTO scene (name) VALUES ('KITCHEN')");
    await db.exec("INSERT INTO scene (name) VALUES ('RIDGE')");
    await db.exec("INSERT INTO prop (name) VALUES ('Kettle')");
    for (const [order, type, uuid, sceneId] of [
      [0, "heading", "H1", 1], [1, "action", "L1", null],
      [2, "heading", "H2", 2], [3, "action", "L2", null],
    ] as Array<[number, string, string, number | null]>) {
      await db.exec(
        "INSERT INTO screenplay_lines (line_order, line_type, content, " +
        "scene_id, uuid) VALUES (?, ?, 'x', ?, ?)",
        [order, type, sceneId, uuid]);
    }
  });

  const tag = async (lineUuid: string): Promise<void> => {
    await db.exec(
      "INSERT INTO screenplay_prop_tags (tagged_text, prop_id, " +
      "line_uuid, start_offset, end_offset) VALUES ('kettle', 1, ?, 0, 6)",
      [lineUuid]);
  };
  const links = async (): Promise<number[]> => {
    const rows = await db.exec(
      "SELECT scene_id FROM scene_prop ORDER BY scene_id");
    return rows.map((r) => r["scene_id"] as number);
  };

  test("a tag made before the line existed is picked up later",
       async () => {
    await tag("L2");
    expect(await links()).toEqual([]);
    expect(await syncPropSceneLinks(db.exec)).toBe(1);
    // The GOVERNING heading, not the first one in the script.
    expect(await links()).toEqual([2]);
  });

  test("it is idempotent", async () => {
    await tag("L1");
    expect(await syncPropSceneLinks(db.exec)).toBe(1);
    expect(await syncPropSceneLinks(db.exec)).toBe(0);
    expect(await links()).toEqual([1]);
  });

  test("tags in two scenes give two links", async () => {
    await tag("L1");
    await tag("L2");
    await syncPropSceneLinks(db.exec);
    expect(await links()).toEqual([1, 2]);
  });

  test("a tag whose line is gone links nothing", async () => {
    await tag("L-dead");
    expect(await syncPropSceneLinks(db.exec)).toBe(0);
    expect(await links()).toEqual([]);
  });

  test("it only ever adds", async () => {
    // A hand-authored link for a prop present but never named is a fact
    // the script cannot see, and this is not the place to second-guess.
    await db.exec(
      "INSERT INTO scene_prop (name, scene_id, prop_id) " +
      "VALUES ('Kettle', 2, 1)");
    await tag("L1");
    await syncPropSceneLinks(db.exec);
    expect(await links()).toEqual([1, 2]);
  });
});
