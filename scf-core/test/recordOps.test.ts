// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "../src/node.ts";
import { initDatabase } from "../src/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "../src/registry.ts";
import {
  createRecord, deleteRecord, updateRecord,
} from "../src/ops/recordOps.ts";
import { restoreFromUndo } from "../src/ops/undoDelete.ts";

const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));

describe("record operations", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
  });

  test("create stamps a uuid and returns the new id", async () => {
    const id = await createRecord(db.exec, registry, "character",
                                  { name: "ELEANOR" });
    const rows = await db.exec(
      "SELECT name, uuid FROM character WHERE id = ?", [id]);
    expect(rows[0]!["name"]).toBe("ELEANOR");
    expect(String(rows[0]!["uuid"]).length).toBeGreaterThan(8);
  });

  test("create ignores unknown fields and leaves empty ones to defaults",
      async () => {
    const id = await createRecord(db.exec, registry, "character",
      { name: "MARCUS", not_a_field: "x", summary: "", role: null });
    const rows = await db.exec("SELECT * FROM character WHERE id = ?", [id]);
    expect(rows[0]!["name"]).toBe("MARCUS");
    expect(Object.keys(rows[0]!)).not.toContain("not_a_field");
    expect(rows[0]!["summary"] ?? null).toBeNull();
  });

  test("create rejects an entity the registry does not know", async () => {
    await expect(createRecord(db.exec, registry, "nope", { name: "x" }))
      .rejects.toThrow(/unknown entity/);
  });

  test("update writes the whole row and stamps updated_at", async () => {
    const id = await createRecord(db.exec, registry, "character",
      { name: "ELEANOR", summary: "old" });
    await db.exec(
      "UPDATE character SET updated_at = '2000-01-01 00:00:00' WHERE id = ?",
      [id]);
    await updateRecord(db.exec, registry, "character", id,
                       { name: "ELEANOR VANCE" });
    const row = (await db.exec(
      "SELECT name, summary, updated_at FROM character WHERE id = ?",
      [id]))[0]!;
    expect(row["name"]).toBe("ELEANOR VANCE");
    // Whole-row: a field absent from the values is cleared, as the form
    // would have it.
    expect(row["summary"]).toBeNull();
    expect(row["updated_at"]).not.toBe("2000-01-01 00:00:00");
  });

  test("a shot moved to another scene is renumbered by the update",
      async () => {
    const five = await createRecord(db.exec, registry, "scene",
      { name: "A", scene_number: "5" });
    const sixtySix = await createRecord(db.exec, registry, "scene",
      { name: "B", scene_number: "66" });
    const shot = await createRecord(db.exec, registry, "shot",
      { name: "", scene_id: five, shot_number: "5A" });
    await updateRecord(db.exec, registry, "shot", shot,
      { name: "", scene_id: sixtySix, shot_number: "5A" });
    const row = (await db.exec(
      "SELECT scene_id, shot_number FROM shot WHERE id = ?", [shot]))[0]!;
    expect(row["scene_id"]).toBe(sixtySix);
    expect(row["shot_number"]).toBe("66A");
  });

  test("a shot keeps its number when its scene does not change",
      async () => {
    const scene = await createRecord(db.exec, registry, "scene",
      { name: "A", scene_number: "42" });
    const shot = await createRecord(db.exec, registry, "shot",
      { name: "", scene_id: scene, shot_number: "42B" });
    await updateRecord(db.exec, registry, "shot", shot,
      { name: "wide", scene_id: scene, shot_number: "42B" });
    const row = (await db.exec(
      "SELECT shot_number FROM shot WHERE id = ?", [shot]))[0]!;
    expect(row["shot_number"]).toBe("42B");
  });

  test("delete returns an undo that restores the row and its dependants",
      async () => {
    const scene = await createRecord(db.exec, registry, "scene",
      { name: "INT. KITCHEN - NIGHT", scene_number: "1" });
    const shot = await createRecord(db.exec, registry, "shot",
      { name: "", scene_id: scene, shot_number: "1A" });
    const undo = await deleteRecord(db.exec, registry, "scene", scene);
    expect(undo).not.toBeNull();
    expect(undo!.entity).toBe("scene");
    expect(await db.exec("SELECT id FROM scene WHERE id = ?", [scene]))
      .toHaveLength(0);
    await restoreFromUndo(db.exec, undo!);
    expect(await db.exec("SELECT id FROM scene WHERE id = ?", [scene]))
      .toHaveLength(1);
    expect(await db.exec("SELECT id FROM shot WHERE id = ?", [shot]))
      .toHaveLength(1);
  });

  test("deleting an anchor scene hands the act boundary to its successor",
      async () => {
    const first = await createRecord(db.exec, registry, "scene",
      { name: "ONE", scene_number: "1" });
    const second = await createRecord(db.exec, registry, "scene",
      { name: "TWO", scene_number: "2" });
    for (const [i, id] of [first, second].entries()) {
      await db.exec(
        "INSERT INTO screenplay_lines (uuid, line_order, line_type, " +
        "content, scene_id) VALUES (?, ?, 'heading', ?, ?)",
        [`line-${String(i)}`, i + 1, `SCENE ${String(i)}`, id]);
    }
    const act = await createRecord(db.exec, registry, "act",
      { name: "Act", start_scene_id: first });
    await deleteRecord(db.exec, registry, "scene", first);
    const row = (await db.exec(
      "SELECT start_scene_id FROM act WHERE id = ?", [act]))[0]!;
    expect(row["start_scene_id"]).toBe(second);
  });

  test("deleting a row that is not there returns no undo", async () => {
    expect(await deleteRecord(db.exec, registry, "character", 9999))
      .toBeNull();
  });
});
