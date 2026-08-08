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
    // The author deletes Alexis's dialogue. writeScreenplay rewrites the
    // line table; nothing has ever swept the junction.
    await db.exec("DELETE FROM screenplay_lines WHERE uuid = 'L-cue'");
    const report = await scanIntegrity(db.exec, live("L-head"));
    expect(report.unjustifiedLinks).toHaveLength(1);
    expect(report.unjustifiedLinks[0]!.characterName).toBe("Alexis");
    expect(report.unjustifiedLinks[0]!.sceneNumber).toBe(1);

    await deleteSceneCharacter(db.exec, report.unjustifiedLinks[0]!.id);
    expect((await scanIntegrity(db.exec, live("L-head"))).total).toBe(0);
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
