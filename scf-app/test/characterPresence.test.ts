// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import {
  presenceByScene, QUIET_ROLES, readScriptPresence,
} from "../src/editor/characterPresence.ts";
import { scanIntegrity } from "../src/editor/integrity.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));
let db: ReturnType<typeof openNodeDatabase>;
beforeAll(() => { db = openNodeDatabase(FIXTURE, { readOnly: true }); });
afterAll(() => db.close());

const id = async (sql: string): Promise<number> =>
  Number((await db.exec(sql))[0]?.["id"]);

describe("speech, read from the script", () => {
  test("a cue and the dialogue under it, in the scene of the heading above",
       async () => {
    const eleanor = await id("SELECT id FROM character WHERE name LIKE 'Eleanor%'");
    const kitchen = await id("SELECT id FROM scene WHERE scene_number = '3'");
    const p = await readScriptPresence(db.exec, eleanor);
    const first = p.speeches[0];
    expect(first?.sceneId).toBe(kitchen);
    expect(first?.parts).toEqual([{ kind: "dialogue",
                                    text: "Shut it behind you." }]);
    // Never the line's own scene_id, which the fixture leaves null on
    // every cue: if this were read, no speech would have a scene.
    expect(p.speeches.every((s) => s.sceneId !== null)).toBe(true);
  });

  test("a parenthetical belongs to the speech it sits in", async () => {
    const eleanor = await id("SELECT id FROM character WHERE name LIKE 'Eleanor%'");
    const p = await readScriptPresence(db.exec, eleanor);
    const withParen = p.speeches.find((s) =>
      s.parts.some((x) => x.kind === "parenthetical"));
    expect(withParen?.parts.map((x) => x.kind))
      .toEqual(["parenthetical", "dialogue"]);
  });
});

describe("links against the script", () => {
  test("“silent” agrees with the integrity check, scene for scene",
       async () => {
    // Two descriptions of one rule drift; this pins them together.
    const order = (await db.exec("SELECT id FROM scene ORDER BY id"))
      .map((r) => Number(r["id"]));
    const lines = new Set((await db.exec("SELECT uuid FROM screenplay_lines"))
      .map((r) => String(r["uuid"])));
    const report = await scanIntegrity(db.exec, lines);
    const expected = report.unjustifiedLinks
      .map((u) => `${String(u.characterId)}:${String(u.sceneId)}`).sort();
    const found: string[] = [];
    for (const c of await db.exec("SELECT id FROM character")) {
      const cid = Number(c["id"]);
      const links = await db.exec(
        "SELECT * FROM scene_character WHERE character_id = ?", [cid]);
      const script = await readScriptPresence(db.exec, cid);
      for (const s of presenceByScene(order, links, script)) {
        if (s.mismatch === "silent") found.push(`${String(cid)}:${String(s.sceneId)}`);
      }
    }
    const quiet = new Set((await db.exec(
      "SELECT character_id, scene_id, role_in_scene FROM scene_character"))
      .filter((r) => QUIET_ROLES.has(String(r["role_in_scene"] ?? "")))
      .map((r) => `${String(r["character_id"])}:${String(r["scene_id"])}`));
    expect(found.sort()).toEqual(expected.filter((k) => !quiet.has(k)));
    expect(found.length).toBeGreaterThan(0);
  });

  test("speaking where not linked is reported", () => {
    const script = { speeches: [{ cueOrder: 1, cueUuid: "u", sceneId: 7,
                                  cue: "ADA", parts: [] }],
                     writtenScenes: new Set([7]), headingLine: new Map() };
    expect(presenceByScene([7], [], script))
      .toEqual([{ sceneId: 7, link: null, speeches: 1, mismatch: "unlinked" }]);
  });
});
