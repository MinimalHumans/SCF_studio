// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import {
  loadRegistry, type Registry, type RegistryJson,
} from "@scf-core/registry.ts";
import {
  addArc, addStage, addVariant, castActor, charactersNamed, cleanName,
  createCharacter, fromPointOfView, loadProfile, reassignActor, relate,
  setDirection, setField, addCostume, wearIn, ensureProgression,
  addMakeupFor, addHabit, addPlaceFor,
} from "../src/editor/elementOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

let db: ReturnType<typeof openNodeDatabase>;
let registry: Registry;
const one = async (sql: string, p: unknown[] = []):
    Promise<Record<string, unknown>> =>
  (await db.exec(sql, p as never[]))[0] ?? {};

beforeEach(async () => {
  registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry);
});

describe("making a character", () => {
  test("only a name is needed, tidied", async () => {
    const id = await createCharacter(db.exec, "  Eleanor   Cade ");
    const row = await one("SELECT name, uuid FROM character WHERE id = ?", [id]);
    expect(row["name"]).toBe("Eleanor Cade");
    expect(String(row["uuid"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a blank name is refused", async () => {
    await expect(createCharacter(db.exec, "   ")).rejects.toThrow(/name/);
    expect(cleanName(" \t ")).toBeNull();
  });

  test("an existing name is found whatever its case and spacing",
       async () => {
    await createCharacter(db.exec, "Eleanor Cade");
    expect(await charactersNamed(db.exec, "eleanor  CADE")).toHaveLength(1);
    expect(await charactersNamed(db.exec, "Marcus")).toHaveLength(0);
  });
});

describe("saving one field", () => {
  test("writes that column and no other", async () => {
    // Two fields edited close together: each save is one column, so the
    // second cannot put back the first's old value — the failure a
    // whole-row save from a stale draft would have.
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await db.exec("UPDATE character SET flaw = 'pride' WHERE id = ?", [id]);
    await setField(db.exec, registry, "character", id, "summary", "A widow.");
    const row = await one("SELECT flaw, summary FROM character WHERE id = ?",
                          [id]);
    expect(row).toEqual({ flaw: "pride", summary: "A widow." });
  });

  test("blank text is stored as null, not as an empty string", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await setField(db.exec, registry, "character", id, "summary", "  ");
    expect((await one("SELECT summary FROM character WHERE id = ?",
                      [id]))["summary"]).toBeNull();
  });

  test("refuses a column the registry does not declare as authored",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await expect(setField(db.exec, registry, "character", id,
                          "summary; DROP TABLE character", "x"))
      .rejects.toThrow(/not an authored field/);
    await expect(setField(db.exec, registry, "character", id,
                          "lifecycle_status", "cut"))
      .rejects.toThrow(/not an authored field/);
  });

  test("refuses to empty a required name", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await expect(setField(db.exec, registry, "character", id, "name", ""))
      .rejects.toThrow(/needs a name/);
  });
});

describe("casting", () => {
  test("one name makes an actor and a role", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const { actorId, roleId } = await castActor(db.exec, id, "Ana Ruiz");
    const role = await one(
      "SELECT actor_id, character_id, role_type FROM actor_character_role " +
      "WHERE id = ?", [roleId]);
    expect(role).toEqual({ actor_id: actorId, character_id: id,
                           role_type: "principal" });
  });

  test("an actor already in the project is reused, not duplicated",
       async () => {
    const a = await createCharacter(db.exec, "Eleanor Cade");
    const b = await createCharacter(db.exec, "Ada Cade");
    const first = await castActor(db.exec, a, "Ana Ruiz");
    const second = await castActor(db.exec, b, "ana  ruiz", "voice_double");
    expect(second.actorId).toBe(first.actorId);
    expect((await one("SELECT COUNT(*) AS n FROM actor"))["n"]).toBe(1);
  });

  test("changing who plays a role never renames the actor", async () => {
    // Ana is Eleanor AND Ada's voice double. Retyping Eleanor's actor
    // must not rename Ana out from under Ada.
    const a = await createCharacter(db.exec, "Eleanor Cade");
    const b = await createCharacter(db.exec, "Ada Cade");
    const eleanor = await castActor(db.exec, a, "Ana Ruiz");
    await castActor(db.exec, b, "Ana Ruiz", "voice_double");
    const newActor = await reassignActor(db.exec, eleanor.roleId, "Mia Holt");
    expect(newActor).not.toBe(eleanor.actorId);
    expect((await one("SELECT name FROM actor WHERE id = ?",
                      [eleanor.actorId]))["name"]).toBe("Ana Ruiz");
    expect((await one("SELECT actor_id FROM actor_character_role " +
                      "WHERE id = ?", [eleanor.roleId]))["actor_id"])
      .toBe(newActor);
  });
});

describe("the profile read", () => {
  test("principal first, cut variants left out", async () => {
    const id = await createCharacter(db.exec, "Marcus Cade");
    await castActor(db.exec, id, "Stunt Person", "stunt_double");
    await castActor(db.exec, id, "Lead Actor", "principal");
    const boy = await addVariant(db.exec, id, "Marcus, age nine");
    const gone = await addVariant(db.exec, id, "Marcus, drowned");
    await db.exec("UPDATE character_variant SET lifecycle_status = 'cut' " +
                  "WHERE id = ?", [gone]);
    const p = await loadProfile(db.exec, id);
    expect(p?.roles.map((r) => r.actorName))
      .toEqual(["Lead Actor", "Stunt Person"]);
    expect(p?.variants.map((v) => Number(v["id"]))).toEqual([boy]);
  });

  test("an unknown character is null", async () => {
    expect(await loadProfile(db.exec, 999)).toBeNull();
  });
});

describe("arcs and stages", () => {
  test("an arc is named by what changes; its name is left to derive",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const arc = await addArc(db.exec, id, " trust → betrayal ");
    expect(await one("SELECT axis, name, character_id FROM character_arc " +
                     "WHERE id = ?", [arc]))
      .toEqual({ axis: "trust → betrayal", name: null, character_id: id });
  });

  test("a stage starts at a scene, under the right parent column",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const arc = await addArc(db.exec, id, "competence → admission");
    await db.exec("INSERT INTO scene (name) VALUES ('EXT. ROAD')");
    const scene = Number((await one("SELECT last_insert_rowid() AS id"))["id"]);
    const stage = await addStage(db.exec, "character_arc_state", arc, scene,
                                 "walls up");
    expect(await one("SELECT character_arc_id, scene_id, stage_label " +
                     "FROM character_arc_state WHERE id = ?", [stage]))
      .toEqual({ character_arc_id: arc, scene_id: scene,
                 stage_label: "walls up" });
  });

  test("refuses a table that is not a stage table, and a blank label",
       async () => {
    await expect(addStage(db.exec, "character; DROP TABLE x", 1, 1, "a"))
      .rejects.toThrow(/not a stage table/);
    await expect(addStage(db.exec, "relationship_state", 1, 1, "  "))
      .rejects.toThrow(/label/);
  });
});

describe("relationships", () => {
  test("one relationship per pair, whichever side asks", async () => {
    const a = await createCharacter(db.exec, "Eleanor Cade");
    const b = await createCharacter(db.exec, "Marcus Cade");
    const first = await relate(db.exec, a, b);
    const again = await relate(db.exec, b, a);
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect((await one("SELECT COUNT(*) AS n FROM character_relationship"))
      ["n"]).toBe(1);
  });

  test("a character cannot be related to themself", async () => {
    const a = await createCharacter(db.exec, "Eleanor Cade");
    await expect(relate(db.exec, a, a)).rejects.toThrow(/themself/);
  });

  test("seen from either side", () => {
    const row = { character_a_id: 1, character_b_id: 2,
                  directionality: "a_to_b" };
    expect(fromPointOfView(row, 1)).toEqual({ otherId: 2, direction: "from" });
    expect(fromPointOfView(row, 2)).toEqual({ otherId: 1, direction: "to" });
    expect(fromPointOfView({ ...row, directionality: "mutual" }, 2))
      .toEqual({ otherId: 1, direction: "mutual" });
    expect(fromPointOfView({ ...row, directionality: null }, 1).direction)
      .toBeNull();
  });

  test("pointing it the other way swaps the sides; mutual leaves them",
       async () => {
    const a = await createCharacter(db.exec, "Eleanor Cade");
    const b = await createCharacter(db.exec, "Ada Cade");
    const { id } = await relate(db.exec, a, b);
    await setDirection(db.exec, id, { fromId: b });
    expect(await one("SELECT character_a_id, character_b_id, directionality " +
                     "FROM character_relationship WHERE id = ?", [id]))
      .toEqual({ character_a_id: b, character_b_id: a,
                 directionality: "a_to_b" });
    await setDirection(db.exec, id, "mutual");
    expect(await one("SELECT character_a_id, directionality " +
                     "FROM character_relationship WHERE id = ?", [id]))
      .toEqual({ character_a_id: b, directionality: "mutual" });
    const c = await createCharacter(db.exec, "Shaw");
    await expect(setDirection(db.exec, id, { fromId: c }))
      .rejects.toThrow(/not in this relationship/);
  });
});

describe("wardrobe and physicality", () => {
  const scene = async (): Promise<number> => {
    await db.exec("INSERT INTO scene (name) VALUES ('EXT. ROAD')");
    return Number((await one("SELECT last_insert_rowid() AS id"))["id"]);
  };

  test("wearing a costume in a scene twice is one link", async () => {
    const id = await createCharacter(db.exec, "Ada Cade");
    const costume = await addCostume(db.exec, id, " Blue shawl ");
    const sc = await scene();
    const a = await wearIn(db.exec, costume, sc);
    expect(await wearIn(db.exec, costume, sc)).toBe(a);
    expect((await one("SELECT COUNT(*) AS n FROM costume_scene"))["n"]).toBe(1);
    expect((await one("SELECT name FROM costume WHERE id = ?", [costume]))
      ["name"]).toBe("Blue shawl");
  });

  test("a progression is made once, on first need", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const p = await ensureProgression(db.exec, id);
    expect(await ensureProgression(db.exec, id)).toBe(p);
  });

  test("one makeup design per scene, one place row per location",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const sc = await scene();
    const m = await addMakeupFor(db.exec, id, sc);
    expect(await addMakeupFor(db.exec, id, sc)).toBe(m);
    await db.exec("INSERT INTO location (uuid, name) VALUES (?, 'Kitchen')",
                  ["00000000-0000-4000-8000-0000000000aa"]);
    const loc = Number((await one("SELECT last_insert_rowid() AS id"))["id"]);
    const e = await addPlaceFor(db.exec, id, loc);
    expect(await addPlaceFor(db.exec, id, loc)).toBe(e);
  });

  test("a habit needs a name", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await expect(addHabit(db.exec, id, "  ")).rejects.toThrow(/Name the habit/);
    expect(await addHabit(db.exec, id, "Wipes dry hands")).toBeGreaterThan(0);
  });
});
