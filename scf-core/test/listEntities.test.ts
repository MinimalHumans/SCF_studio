// SPDX-License-Identifier: Apache-2.0
/**
 * listEntities.ts — enumeration, for callers that start with nothing.
 *
 * Motivated by a real session: asked "how many shots are in this
 * film?" over the four original scf-mcp tools, an agent took 127 tool
 * calls to answer — brute-forcing scene/shot labels through `find`,
 * because nothing in the surface could enumerate rows. These tests
 * check counts against the same fixture that produced that number,
 * cross-checked against raw SQL rather than hard-coded, so they can't
 * quietly agree with a wrong answer the way a copied constant could.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { listEntities } from "../src/listEntities.ts";
import type { ScfContext } from "../src/resolution.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
beforeAll(() => { fx = openFixture(); });
afterAll(() => { fx.close(); });

const countOf = async (table: string, where = ""): Promise<number> => {
  const sql = `SELECT COUNT(*) as n FROM "${table}"` +
    (where ? ` WHERE ${where} AND lifecycle_status != 'cut'`
           : " WHERE lifecycle_status != 'cut'");
  const r = (await fx.ctx.exec(sql))[0];
  return Number(r?.["n"] ?? 0);
};

describe("listEntities — enumeration with nothing in hand (§ new)", () => {
  test("lists every scene, matching a raw count", async () => {
    const listed = await listEntities(fx.ctx, "scene");
    expect(listed.length).toBe(await countOf("scene"));
    expect(listed.length).toBeGreaterThan(0);
  });

  test("every listed scene carries its number as the label", async () => {
    const listed = await listEntities(fx.ctx, "scene");
    const scene12 = listed.find((s) => s.label === "12");
    expect(scene12).toBeDefined();
    expect(scene12?.fields["name"]).toBe("INT. FARMHOUSE KITCHEN - NIGHT");
  });

  test("lists every shot across the whole film, matching a raw count",
      async () => {
    const listed = await listEntities(fx.ctx, "shot");
    expect(listed.length).toBe(await countOf("shot"));
    expect(listed.length).toBeGreaterThan(0);
  });

  test("filters shots to one scene by its uuid", async () => {
    const scenes = await listEntities(fx.ctx, "scene");
    const scene12 = scenes.find((s) => s.label === "12");
    if (scene12 === undefined) throw new Error("fixture has no scene 12");

    const scene12Id = (await fx.ctx.exec(
      "SELECT id FROM scene WHERE uuid = ?", [scene12.uuid]))[0]?.["id"];

    const shots = await listEntities(fx.ctx, "shot",
      { field: "scene_id", uuid: scene12.uuid });
    expect(shots.length).toBe(
      await countOf("shot", `scene_id = ${String(scene12Id)}`));
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(typeof shot.label).toBe("string");
    }
  });

  test("cut rows are excluded, same as every other query (§6.6)",
      async () => {
    const dupCtx: ScfContext = {
      registry,
      exec: async (sql) => {
        if (/FROM "scene"/.test(sql) || sql.includes("FROM scene")) {
          return [
            { id: 1, uuid: "11111111-0000-0000-0000-000000000000",
              name: "kept", scene_number: "1", lifecycle_status: "active" },
            { id: 2, uuid: "22222222-0000-0000-0000-000000000000",
              name: "removed", scene_number: "2", lifecycle_status: "cut" },
          ];
        }
        return [];
      },
    };
    const listed = await listEntities(dupCtx, "scene");
    expect(listed.map((r) => r.label)).toEqual(["1"]);
  });

  test("an unknown entity type throws", async () => {
    await expect(listEntities(fx.ctx, "spaceship"))
      .rejects.toThrow(/unknown entity type/);
  });

  test("a junction entity throws — no typed label to list by (§6.3)",
      async () => {
    await expect(listEntities(fx.ctx, "scene_character"))
      .rejects.toThrow(/junction entity/);
  });

  test("an unrecognised filter field throws", async () => {
    const scenes = await listEntities(fx.ctx, "scene");
    const anyScene = scenes[0];
    if (anyScene === undefined) throw new Error("fixture has no scenes");
    await expect(listEntities(fx.ctx, "shot",
      { field: "nonsense_id", uuid: anyScene.uuid }))
      .rejects.toThrow(/no reference field/);
  });

  test("a filter uuid that resolves nothing throws", async () => {
    await expect(listEntities(fx.ctx, "shot",
      { field: "scene_id", uuid: "00000000-0000-0000-0000-000000000000" }))
      .rejects.toThrow(/no scene with uuid/);
  });
});
