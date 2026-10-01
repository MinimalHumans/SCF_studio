// SPDX-License-Identifier: Apache-2.0
/**
 * presence.test.ts — spec §2.4.1 (presence of a vocabulary value) and
 * §4.6 (presence at a shot).
 *
 * The fixture's scene 3 carries each case §4.6 distinguishes:
 *
 *   3A  recorded AND inherited: Eleanor on screen, Marcus off screen and
 *       heard, everyone else from the scene
 *   3B  complete: Marcus, Eleanor (back to camera, soft), three props
 *   3C  complete: Eleanor's hands and the kettle
 *   3D  unrecorded: answers exactly as the scene does
 *
 * and Ada, whose scene link is `mentioned`, is named: at the position,
 * never on screen. Scene 12 has no shot rows at all, so every published
 * result keyed on it exercises the inherited path.
 *
 * Findings are checked two-sided on a copy of the fixture, as in
 * bindingFilters.test.ts: absent from the fixture, raised once the
 * condition is written into the copy.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { collectFindings } from "../src/findings.ts";
import { openNodeDatabase } from "../src/node.ts";
import {
  presenceAtScene, presenceAtShot, valuePresence, type ShotSubject,
} from "../src/presence.ts";
import { q14Result } from "../src/canonicalQueries.ts";
import type { ScfContext } from "../src/resolution.ts";
import { shotContext, shotMedia } from "../src/shotContext.ts";
import { FIXTURE_PATH, openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
let sandbox: string;
const id: Record<string, number> = {};

beforeAll(async () => {
  fx = openFixture();
  sandbox = mkdtempSync(join(tmpdir(), "scf-presence-"));
  for (const [key, sql] of Object.entries({
    eleanor: "SELECT id FROM character WHERE name LIKE '%Eleanor%'",
    marcus: "SELECT id FROM character WHERE name LIKE '%Marcus%'",
    ada: "SELECT id FROM character WHERE name LIKE '%Ada%'",
    shaw: "SELECT id FROM character WHERE name LIKE '%Shaw%'",
    kettle: "SELECT id FROM prop WHERE name LIKE '%Kettle%'",
    chime: "SELECT id FROM prop WHERE name LIKE '%chime%'",
    chair: "SELECT id FROM prop WHERE name LIKE '%chair%'",
    scene3: "SELECT id FROM scene WHERE scene_number = '3'",
    s3A: "SELECT id FROM shot WHERE shot_number = '3A'",
    s3B: "SELECT id FROM shot WHERE shot_number = '3B'",
    s3C: "SELECT id FROM shot WHERE shot_number = '3C'",
    s3D: "SELECT id FROM shot WHERE shot_number = '3D'",
    s1204: "SELECT id FROM shot WHERE name LIKE '%12-04%'",
  })) {
    const r = (await fx.ctx.exec(sql))[0];
    if (r === undefined) throw new Error(`fixture selector failed: ${sql}`);
    id[key] = Number(r["id"]);
  }
});
afterAll(() => {
  fx.close();
  rmSync(sandbox, { recursive: true, force: true });
});

/** A writable copy of the fixture, handed to `fn` and closed after. */
async function withCopy<T>(
    label: string, fn: (ctx: ScfContext) => Promise<T>): Promise<T> {
  const path = join(sandbox, `${label}.scf`);
  copyFileSync(FIXTURE_PATH, path);
  const db = openNodeDatabase(path, { readOnly: false });
  try {
    return await fn({ exec: db.exec, registry });
  } finally {
    db.close();
  }
}

const find = (subjects: ShotSubject[], type: string, sid: number) =>
  subjects.find((s) => s.subjectType === type && s.id === sid);

describe("§2.4.1 — a value's presence comes from the registry", () => {
  test("the scene vocabularies and framing", () => {
    const p = (e: string, f: string, v: unknown) =>
      valuePresence(registry, e, f, v);
    expect(p("scene_character", "role_in_scene", "featured")).toBe("seen");
    expect(p("scene_character", "role_in_scene", "background")).toBe("seen");
    expect(p("scene_character", "role_in_scene", "mentioned")).toBe("named");
    expect(p("scene_character", "role_in_scene", "voiceover")).toBe("heard");
    expect(p("scene_prop", "significance", "mentioned")).toBe("named");
    expect(p("shot_character", "framing", "cropped")).toBe("seen");
    expect(p("shot_prop", "framing", "off_screen")).toBe("heard");
  });

  test("unset, and a value the vocabulary does not list, are seen", () => {
    expect(valuePresence(registry, "scene_character", "role_in_scene",
                         null)).toBe("seen");
    expect(valuePresence(registry, "scene_character", "role_in_scene",
                         "cameo")).toBe("seen");
  });

  test("every declared optionPresence is total over its options", () => {
    // The TypeScript twin of lint_registry.py's check, over what was
    // actually published.
    let declared = 0;
    for (const entity of registry.entities.values()) {
      for (const f of entity.fields) {
        if (f.optionPresence === undefined) continue;
        declared += 1;
        expect(Object.keys(f.optionPresence).sort(),
               `${entity.name}.${f.name}`).toEqual([...(f.options ?? [])].sort());
      }
    }
    expect(declared).toBe(4);
  });
});

describe("§2.4.1 — presence at a scene", () => {
  test("scene 3: Ada is named, everyone else seen", async () => {
    const at = await presenceAtScene(fx.ctx, id.scene3 as number);
    expect(at.character.get(id.eleanor as number)).toBe("seen");
    expect(at.character.get(id.marcus as number)).toBe("seen");
    expect(at.character.get(id.ada as number)).toBe("named");
    expect(at.prop.get(id.chair as number)).toBe("seen");
  });
});

describe("§4.6 — presence at a shot", () => {
  test("3A: recorded rows, and the rest inherited from the scene",
       async () => {
    const at = await presenceAtShot(fx.ctx, id.s3A as number);
    expect(at?.complete).toBe(false);
    const subjects = at?.subjects ?? [];
    expect(find(subjects, "character", id.eleanor as number)).toMatchObject({
      presence: "seen", framing: "full", facing: "away", focus: "sharp",
      source: "recorded" });
    expect(find(subjects, "character", id.marcus as number)).toMatchObject({
      presence: "heard", framing: "off_screen", source: "recorded" });
    // Not named by a row, so inherited with its SCENE presence.
    expect(find(subjects, "character", id.ada as number)).toMatchObject({
      presence: "named", framing: null, source: "inherited" });
    expect(find(subjects, "prop", id.kettle as number)?.source)
      .toBe("inherited");
    // Recorded before inherited.
    const firstInherited = subjects.findIndex((s) => s.source === "inherited");
    expect(subjects.slice(firstInherited).every(
      (s) => s.source === "inherited")).toBe(true);
  });

  test("3B: a complete frame is exactly its rows", async () => {
    const at = await presenceAtShot(fx.ctx, id.s3B as number);
    expect(at?.complete).toBe(true);
    const subjects = at?.subjects ?? [];
    expect(subjects.every((s) => s.source === "recorded")).toBe(true);
    expect(subjects.map((s) => `${s.subjectType}:${s.id}`).sort()).toEqual([
      `character:${id.eleanor}`, `character:${id.marcus}`,
      `prop:${id.chair}`, `prop:${id.chime}`, `prop:${id.kettle}`,
    ].sort());
    // Back to camera AND soft: the case one vocabulary could not hold.
    expect(find(subjects, "character", id.eleanor as number)).toMatchObject({
      framing: "full", facing: "away", focus: "soft" });
    expect(find(subjects, "character", id.ada as number)).toBeUndefined();
  });

  test("3C: her hands, and a prop has no facing", async () => {
    const at = await presenceAtShot(fx.ctx, id.s3C as number);
    expect(at?.complete).toBe(true);
    expect(find(at?.subjects ?? [], "character", id.eleanor as number))
      .toMatchObject({ framing: "cropped", presence: "seen" });
    expect(find(at?.subjects ?? [], "prop", id.kettle as number)?.facing)
      .toBeNull();
    expect(find(at?.subjects ?? [], "character", id.marcus as number))
      .toBeUndefined();
  });

  test("an unrecorded shot answers exactly as its scene does", async () => {
    for (const [shot, scene] of [["s3D", "scene3"]] as const) {
      const at = await presenceAtShot(fx.ctx, id[shot] as number);
      const atScene = await presenceAtScene(fx.ctx, id[scene] as number);
      expect(at?.complete).toBe(false);
      expect(at?.subjects.every((s) => s.source === "inherited")).toBe(true);
      const got = new Map((at?.subjects ?? [])
        .filter((s) => s.subjectType === "character")
        .map((s) => [s.id, s.presence]));
      expect(got).toEqual(atScene.character);
    }
    // Scene 12 records nothing, so 12-04 is the published inherited case.
    const s1204 = await presenceAtShot(fx.ctx, id.s1204 as number);
    expect(s1204?.subjects.length).toBeGreaterThan(0);
    expect(s1204?.subjects.every((s) => s.source === "inherited")).toBe(true);
  });

  test("a file with no shot presence tables reads every shot as unrecorded",
       async () => {
    await withCopy("pre-2.17", async (ctx) => {
      await ctx.exec("DROP TABLE shot_character");
      await ctx.exec("DROP TABLE shot_prop");
      const at = await presenceAtShot(ctx, id.s3B as number);
      // presence_complete is still set on 3B, but with no rows to read
      // its frame is empty: the flag is honoured, not second-guessed.
      expect(at?.complete).toBe(true);
      const d = await presenceAtShot(ctx, id.s3D as number);
      expect(d?.subjects.every((s) => s.source === "inherited")).toBe(true);
      await expect(collectFindings(ctx.exec, ctx.registry)).resolves
        .toBeDefined();
    });
  });
});

describe("§4.6 — kept and reported, not refused", () => {
  const presenceCodes = async (ctx: ScfContext) =>
    (await collectFindings(ctx.exec, ctx.registry)).findings
      .filter((f) => f.code.startsWith("presence."))
      .map((f) => f.code).sort();

  test("the fixture raises none", async () => {
    expect(await presenceCodes(fx.ctx)).toEqual([]);
  });

  test("each finding is raised by the condition it names", async () => {
    await withCopy("findings", async (ctx) => {
      const ins = (table: string, subject: string, sid: number,
                   shot: number, cols: Record<string, string>) => {
        const names = Object.keys(cols);
        return ctx.exec(
          `INSERT INTO ${table} (uuid, shot_id, ${subject}_id` +
          names.map((n) => `, ${n}`).join("") + `) VALUES (?, ?, ?` +
          names.map(() => ", ?").join("") + `)`,
          [randomUUID(), shot, sid, ...Object.values(cols)]);
      };
      // Shaw is not in scene 3.
      await ins("shot_character", "character", id.shaw as number,
                id.s3A as number, { framing: "full" });
      // Ada is only mentioned in scene 3.
      await ins("shot_character", "character", id.ada as number,
                id.s3A as number, { framing: "full" });
      // Off screen, and yet in focus.
      await ins("shot_prop", "prop", id.chime as number, id.s3A as number,
                { framing: "off_screen", focus: "sharp" });
      // A complete frame with nothing in it.
      await ctx.exec("UPDATE shot SET presence_complete = 1 WHERE id = ?",
                     [id.s3D as number]);

      expect(await presenceCodes(ctx)).toEqual([
        "presence.complete_but_empty",
        "presence.named_but_on_screen",
        "presence.off_screen_described",
        "presence.shot_subject_not_in_scene",
      ]);
    });
  });
});

describe("the consumers follow presence", () => {
  const appearanceWarnings = async (shot: number | null) => {
    const r = await q14Result(fx.ctx, "Q07", null, null, "",
                              id.scene3 as number, null, shot);
    return r.result.findings
      .filter((f) => f.entity === "character_appearance_profile")
      .map((f) => f.message);
  };

  test("Q14 asks after the look of seen characters only", async () => {
    // Scene level: Ada is named, so she is not asked about.
    const scene = await appearanceWarnings(null);
    expect(scene.some((m) => m.startsWith("Ada"))).toBe(false);
    expect(scene.some((m) => m.startsWith("Marcus"))).toBe(true);
    // 3A: Marcus is only heard. 3B: he is on screen.
    expect((await appearanceWarnings(id.s3A as number))
      .some((m) => m.startsWith("Marcus"))).toBe(false);
    expect((await appearanceWarnings(id.s3B as number)))
      .toContain("Marcus Cade is on screen in this shot with no " +
                 "appearance profile.");
  });

  test("shotContext: presence, physical direction and the sweep",
       async () => {
    const uuidOf = async (sid: number) => String((await fx.ctx.exec(
      "SELECT uuid FROM shot WHERE id = ?", [sid]))[0]?.["uuid"]);

    const b = await shotContext(fx.ctx, await uuidOf(id.s3B as number));
    expect(b.presence.complete).toBe(true);
    expect(b.presence.subjects.map((s) => s.name)).not.toContain("Ada Cade");
    expect(b.physical).toHaveLength(2);
    expect((await shotMedia(fx.ctx, await uuidOf(id.s3B as number)))
      .swept.map((s) => s.name)).not.toContain("Ada Cade");

    const a = await shotContext(fx.ctx, await uuidOf(id.s3A as number));
    const aMedia = await shotMedia(fx.ctx, await uuidOf(id.s3A as number));
    // Heard, so no physical direction: only Eleanor is a body on screen.
    expect(a.physical).toHaveLength(1);
    const ada = aMedia.swept.find((s) => s.name === "Ada Cade");
    expect(ada).toMatchObject({ intents: [] });
    expect(ada?.note).toMatch(/named only/);
    expect(aMedia.media.some((m) =>
      m.result.subjectKind === "character" &&
      a.presence.subjects.find((s) => s.name === "Ada Cade")?.uuid ===
        m.parameters["subject"])).toBe(false);
    const marcus = aMedia.swept.find((s) => s.name === "Marcus Cade");
    expect(marcus?.intents.every(
      (i) => i === "voice_identity" || i === "acoustic")).toBe(true);
  });
});
