import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import {
  captureForUndo, restoreFromUndo, undoSummary,
} from "../src/state/undoDelete.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("undoing a delete", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let registry: Registry;
  let sequenceId: number;

  beforeEach(async () => {
    registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    await db.exec("INSERT INTO scene (name, scene_number) VALUES ('A', 1)");
    await db.exec("INSERT INTO scene (name, scene_number) VALUES ('B', 2)");
    await db.exec(
      "INSERT INTO sequence (name, sequence_number, start_scene_id) " +
      "VALUES ('The Siege', 1, 1)");
    sequenceId = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
    for (const scene of [1, 2]) {
      await db.exec(
        "INSERT INTO scene_sequence (scene_id, sequence_id, " +
        "order_in_sequence) VALUES (?, ?, ?)",
        [scene, sequenceId, scene]);
    }
  });

  const capture = () => captureForUndo(
    db.exec, registry, "sequence", sequenceId, "The Siege");

  test("captures the row and what pointed at it", async () => {
    const undo = await capture();
    expect(undo).not.toBe(null);
    expect(undo!.row["name"]).toBe("The Siege");
    const links = undo!.dependants.find((d) => d.entity === "scene_sequence");
    expect(links?.rows).toHaveLength(2);
  });

  test("restores the row with its original id and uuid", async () => {
    const undo = await capture();
    const uuid = undo!.row["uuid"];
    await db.exec("DELETE FROM sequence WHERE id = ?", [sequenceId]);
    await db.exec("DELETE FROM scene_sequence WHERE sequence_id = ?",
                  [sequenceId]);

    await restoreFromUndo(db.exec, undo!);
    const back = await db.exec("SELECT id, uuid, start_scene_id " +
                               "FROM sequence");
    expect(back).toHaveLength(1);
    // The id matters: anything else referencing it would otherwise be
    // restored into a dangling reference.
    expect(back[0]!["id"]).toBe(sequenceId);
    expect(back[0]!["uuid"]).toBe(uuid);
    expect(back[0]!["start_scene_id"]).toBe(1);
  });

  test("brings the linked rows back too", async () => {
    const undo = await capture();
    await db.exec("DELETE FROM sequence WHERE id = ?", [sequenceId]);
    await db.exec("DELETE FROM scene_sequence WHERE sequence_id = ?",
                  [sequenceId]);
    await restoreFromUndo(db.exec, undo!);
    const links = await db.exec(
      "SELECT scene_id FROM scene_sequence ORDER BY scene_id");
    expect(links.map((r) => r["scene_id"])).toEqual([1, 2]);
  });

  test("says what it is offering to put back", async () => {
    const undo = await capture();
    expect(undoSummary(undo!)).toBe("Deleted The Siege and 2 linked rows");
  });

  test("a row with nothing pointing at it says so plainly", async () => {
    await db.exec("INSERT INTO act (name, act_number) VALUES ('Act I', 1)");
    const id = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
    const undo = await captureForUndo(db.exec, registry, "act", id, "Act I");
    expect(undoSummary(undo!)).toBe("Deleted Act I");
  });

  test("capturing a row that is not there yields nothing", async () => {
    expect(await captureForUndo(db.exec, registry, "act", 9999, "x"))
      .toBe(null);
  });
});
