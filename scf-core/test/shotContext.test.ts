// SPDX-License-Identifier: Apache-2.0
/**
 * docs/scf-mcp-design.md §3, §4 — resolveNaturalKey and the shot
 * composite: `shotContext` (the frame), `shotMedia` (what to attach) and
 * `shotReadiness` (what is thin).
 *
 * The composite's whole safety property is that it adds nothing: every
 * member must equal what the query it wraps already returns. Where a
 * blessed `.result.json` already exists for that exact call (Q07, and
 * Eleanor/scene12's Q06 and Q13), this compares against it directly
 * rather than re-blessing — the same fixture proves both this composite
 * and canonicalQueries.test.ts correct, so they cannot drift from each
 * other silently.
 *
 * The readiness list has no existing blessed target, so it gets its own
 * blessed fixture, following the same bless/check pattern as
 * canonicalQueries.test.ts.
 *
 * Blessing:  npm test -- --mode bless
 * Checking:  npm test
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { listEntities } from "../src/listEntities.ts";
import { resolveNaturalKey } from "../src/naturalKey.ts";
import {
  shotContext, shotMedia, shotReadiness,
} from "../src/shotContext.ts";
import type { ScfContext } from "../src/resolution.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)),
                 "..", "..", "fixtures", "expectations");
const BLESS = (import.meta as { env?: { MODE?: string } })
  .env?.MODE === "bless";

let fx: Fixture;
let eleanor: { id: number; uuid: string; name: string };
let marcus: { uuid: string };
let scene12: { id: number; uuid: string };
let shot1204: { id: number; uuid: string; shotNumber: string };

const pickRow = async (sql: string): Promise<Record<string, unknown>> => {
  const r = (await fx.ctx.exec(sql))[0];
  if (r === undefined) throw new Error(`selector matched nothing: ${sql}`);
  return r;
};

beforeAll(async () => {
  fx = openFixture();
  const eleanorRow = await pickRow(
    "SELECT id, uuid, name FROM character WHERE name LIKE '%Eleanor%'");
  eleanor = { id: Number(eleanorRow["id"]), uuid: String(eleanorRow["uuid"]),
              name: String(eleanorRow["name"]) };
  marcus = { uuid: String((await pickRow(
    "SELECT uuid FROM character WHERE name LIKE '%Marcus%'"))["uuid"]) };
  const scene12Row = await pickRow(
    "SELECT id, uuid FROM scene WHERE scene_number = '12'");
  scene12 = { id: Number(scene12Row["id"]), uuid: String(scene12Row["uuid"]) };
  const shotRow = await pickRow(
    "SELECT id, uuid, shot_number FROM shot WHERE name LIKE '%12-04%'");
  shot1204 = { id: Number(shotRow["id"]), uuid: String(shotRow["uuid"]),
               shotNumber: String(shotRow["shot_number"]) };
  if (BLESS) mkdirSync(OUT, { recursive: true });
});

afterAll(() => { fx.close(); });

const blessOrCheck = (name: string, value: unknown): void => {
  const path = join(OUT, `${name}.result.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (BLESS) { writeFileSync(path, text, "utf8"); return; }
  expect(existsSync(path), `${name}.result.json missing — bless first`)
    .toBe(true);
  expect(text).toBe(readFileSync(path, "utf8"));
};

const loadBlessed = (name: string): unknown =>
  JSON.parse(readFileSync(join(OUT, `${name}.result.json`), "utf8"));

const SHOT = {
  "3A": "8917aaea-0ab4-4db0-9e6d-1c0fe62805d2",
  "3B": "e9a73271-d1bd-48eb-98f1-afd3f28511e6",
  "3C": "5bb6b9ea-cc07-4bb6-9500-4691ba5c35a6",
};

describe("shotContext — the frame, composed without deriving (§4.1)",
         () => {
  test("look is byte-identical to blessed Q07; the scene and the brief " +
       "are their own queries (§4.7)", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    expect(ctx.look).toEqual(loadBlessed("Q07"));
    expect(Object.keys(ctx).sort()).toEqual(
      ["contextFormat", "lines", "look", "physical", "presence", "shot"]);
  });

  test("shot is the row `list` returns for it, framing included",
       async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const listed = (await listEntities(fx.ctx, "shot",
      { field: "scene_id", uuid: scene12.uuid }))
      .find((s) => s.uuid === shot1204.uuid);
    expect(ctx.shot).toEqual(listed);
    expect(ctx.shot.label).toBe(shot1204.shotNumber);
    // What to ask Q04 with, now that the scene is not a member.
    expect(ctx.shot.fields["scene_uuid"]).toBe(scene12.uuid);

    const shot3B = await shotContext(fx.ctx, SHOT["3B"]);
    expect(shot3B.shot.fields).toMatchObject({
      shot_number: "3B", shot_size: "medium", lens_choice: "40mm",
      camera_angle: "eye level", camera_movement: "static",
    });
    // Portable like every result: uuids, never row ids.
    expect(Object.keys(shot3B.shot.fields).some((k) => k.endsWith("_id")))
      .toBe(false);
  });

  test("all three calls share contextFormat 3.0 and name the same shot",
       async () => {
    const [frame, media, ready] = await Promise.all([
      shotContext(fx.ctx, SHOT["3B"]),
      shotMedia(fx.ctx, SHOT["3B"]),
      shotReadiness(fx.ctx, SHOT["3B"]),
    ]);
    expect([frame.contextFormat, media.contextFormat, ready.contextFormat])
      .toEqual(["3.0", "3.0", "3.0"]);
    expect(frame.shot.uuid).toBe(SHOT["3B"]);
    expect(media.shotUuid).toBe(SHOT["3B"]);
    expect(ready.shotUuid).toBe(SHOT["3B"]);
  });

  test("physical: one per character seen, Eleanor's byte-identical to " +
       "blessed Q06", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const seen = ctx.presence.subjects.filter((s) =>
      s.subjectType === "character" && s.presence === "seen");
    expect(ctx.physical).toHaveLength(seen.length);
    const mine = ctx.physical.find(
      (p) => p.parameters["character"] === eleanor.uuid);
    expect(mine).toEqual(loadBlessed("Q06"));
  });

  test("throws for an unknown shot uuid rather than answering silently",
       async () => {
    for (const call of [shotContext, shotReadiness,
                        (c: ScfContext, u: string) => shotMedia(c, u)]) {
      await expect(call(fx.ctx, "00000000-0000-0000-0000-000000000000"))
        .rejects.toThrow();
    }
  });
});

describe("shotMedia — what to attach", () => {
  test("Eleanor's visual_identity is byte-identical to blessed Q13",
       async () => {
    const m = await shotMedia(fx.ctx, shot1204.uuid);
    const mine = m.media.find((r) =>
      r.parameters["subject"] === eleanor.uuid &&
      r.result.intent === "visual_identity");
    expect(mine).toEqual(loadBlessed("Q13"));
  });

  test("every intent asked is either in media or named in empty",
       async () => {
    const m = await shotMedia(fx.ctx, shot1204.uuid);
    for (const s of m.swept) {
      const returned = m.media
        .filter((r) => r.parameters["subject"] === s.uuid)
        .map((r) => String(r.result.intent));
      expect([...returned, ...s.empty].sort(), s.name ?? s.uuid)
        .toEqual([...s.intents].sort());
    }
    // A character is asked every intent its query paths declare.
    const her = m.swept.find((s) => s.uuid === eleanor.uuid);
    expect([...(her?.intents ?? [])].sort())
      .toEqual(["motion", "visual_identity", "voice_identity"]);
  });

  test("an empty result is left out; one whose trail explains an absence " +
       "is kept", async () => {
    const m = await shotMedia(fx.ctx, SHOT["3B"]);
    // Marcus has nothing bound for motion: no references, no trail.
    const him = m.swept.find((s) => s.uuid === marcus.uuid);
    expect(him?.empty).toContain("motion");
    expect(m.media.some((r) => r.parameters["subject"] === marcus.uuid &&
                               r.result.intent === "motion")).toBe(false);
    // The chime's only image is excluded before the storm: no references,
    // and a trail saying why. That is an answer, and it stays.
    const chime = m.swept.find((s) => s.name === "Brass wind chime");
    const visual = m.media.find((r) =>
      r.parameters["subject"] === chime?.uuid &&
      r.result.intent === "visual_identity");
    expect(visual?.result.references).toEqual([]);
    expect(visual?.result.trail.join(" ")).toMatch(/EXCLUDED/);
    expect(chime?.empty).not.toContain("visual_identity");
  });

  test("every subject kind is swept, not characters alone", async () => {
    const m = await shotMedia(fx.ctx, shot1204.uuid);
    const kinds = new Set(m.swept.map((s) => s.subjectType));
    expect([...kinds].sort()).toEqual(["character", "location", "prop"]);
    expect(m.swept.find((s) => s.subjectType === "location")?.intents)
      .toContain("visual_identity");
    for (const s of m.swept.filter((x) => x.intents.length === 0)) {
      expect(s.note, `${s.subjectType} ${s.name ?? "?"}`).toBeDefined();
    }
  });

  test("one subject at a time, for a shot with many", async () => {
    const all = await shotMedia(fx.ctx, SHOT["3B"]);
    const one = await shotMedia(fx.ctx, SHOT["3B"], undefined, false,
                                eleanor.uuid);
    expect(one.subject).toBe(eleanor.uuid);
    expect(one.swept.map((s) => s.uuid)).toEqual([eleanor.uuid]);
    expect(one.media.every((r) => r.parameters["subject"] === eleanor.uuid))
      .toBe(true);
    // The same answers the full call gives for her, and nothing else.
    expect(one.media).toEqual(all.media.filter((r) =>
      r.parameters["subject"] === eleanor.uuid));
    expect(one.related).toEqual(all.related);
  });

  test("a subject not at the shot is refused, not answered", async () => {
    // 3B's frame is complete and holds no Ada.
    const ada = String((await pickRow(
      "SELECT uuid FROM character WHERE name LIKE '%Ada%'"))["uuid"]);
    await expect(shotMedia(fx.ctx, SHOT["3B"], undefined, false, ada))
      .rejects.toThrow(/not at shot/);
  });

  test("a plate about the SCENE reaches the shot (§8.6)", async () => {
    const m = await shotMedia(fx.ctx, SHOT["3B"]);
    expect(m.related.map((r) => r.identifier))
      .toContain("@project/shots/marcus_in_the_kitchen.png");
    expect(m.related.every((r) => r.about === "scene")).toBe(true);
  });

  test("a shot's storyboard comes back in its order, not row order (§8.6)",
       async () => {
    // 12-04's panels are stored against their row ids on purpose.
    const m = await shotMedia(fx.ctx, shot1204.uuid);
    const own = m.related.filter((r) => r.about === "shot");
    expect(own.map((r) => [r.relationship, r.order])).toEqual([
      ["storyboard", 1], ["storyboard", 2], ["start_frame", 3]]);
    expect(own.map((r) => r.identifier)).toEqual([
      "@project/assets/locations/kitchen/kitchen_no_table_night.png",
      "@project/assets/locations/kitchen/kitchen_night.png",
      "@project/shots/demo_kitchen_night_01.png"]);
  });

  test("a related asset carries its resolution state, as a Q13 reference does",
       async () => {
    // No root: every one is unaddressed, never missing (§8.3).
    const bare = await shotMedia(fx.ctx, shot1204.uuid);
    expect(bare.related.every((r) => r.state === "unaddressed")).toBe(true);
    expect(bare.related.every((r) => r.sizeBytes === null)).toBe(true);

    // A project root holding one panel and not the other: the absent
    // storyboard is reported, not handed on as if it were there.
    const locate = async (root: string | null, path: string) =>
      root !== "project" ? undefined
        : path === "assets/locations/kitchen/kitchen_no_table_night.png"
          ? { materialised: true, sizeBytes: 2048, mtime: null } : null;
    const m = await shotMedia(fx.ctx, shot1204.uuid, locate, true);
    const own = m.related.filter((r) => r.about === "shot");
    expect(own.map((r) => [r.state, r.sizeBytes, r.format])).toEqual([
      ["resolved", 2048, "png"], ["missing", null, "png"],
      ["missing", null, "png"]]);
    expect(own[0]!.detail).toBeNull();
    expect(own[1]!.detail).toMatch(/kitchen_night\.png/);
  });
});

describe("shotReadiness — what is thin", () => {
  /** Each readiness entry as `target:character name`, in order. */
  const readinessOf = async (shotUuid: string) => {
    const names = new Map((await fx.ctx.exec(
      "SELECT uuid, name FROM character")).map((c) =>
      [String(c["uuid"]), String(c["name"])]));
    return (await shotReadiness(fx.ctx, shotUuid)).readiness.map((r) => {
      const who = r.parameters["character"];
      return who === null || who === undefined
        ? r.result.target
        : `${r.result.target}:${names.get(String(who)) ?? String(who)}`;
    });
  };

  test("opens with the shot's look (Q07)", async () => {
    const r = await shotReadiness(fx.ctx, shot1204.uuid);
    const look = r.readiness[0];
    expect(look?.result.target).toBe("Q07");
    expect(look?.parameters["scene"]).toBe(scene12.uuid);
    expect(look?.parameters["shot"]).toBe(shot1204.uuid);
    blessOrCheck("ShotContext-readiness", r.readiness);
  });

  test("3B: look, sound, then each speaking character on screen",
       async () => {
    expect(await readinessOf(SHOT["3B"])).toEqual([
      "Q07", "Q08",
      "Q02:Marcus Cade", "Q06:Marcus Cade", "Q05:Marcus Cade",
      "Q02:Eleanor Cade", "Q06:Eleanor Cade", "Q05:Eleanor Cade",
    ]);
  });

  test("3A: a heard character gets a voice check and no body checks",
       async () => {
    // Marcus is off screen in 3A, and speaks in its lines (the master
    // covers the whole scene). Ada is named, and gets nothing.
    expect(await readinessOf(SHOT["3A"])).toEqual([
      "Q07", "Q08",
      "Q02:Eleanor Cade", "Q06:Eleanor Cade", "Q05:Eleanor Cade",
      "Q05:Marcus Cade",
    ]);
  });

  test("3C: a speaker the frame does not hold still gets a voice check",
       async () => {
    // 3C is Eleanor's hands. Its lines open on "Is Ada's room still—",
    // whose MARCUS cue is the line before the range: the speaker is the
    // nearest cue above, so Marcus speaks here, from outside the frame.
    expect(await readinessOf(SHOT["3C"])).toEqual([
      "Q07", "Q08",
      "Q02:Eleanor Cade", "Q06:Eleanor Cade",
      "Q05:Marcus Cade",
    ]);
  });

  test("an unrecorded shot: anyone seen or heard may speak", async () => {
    const list = await readinessOf(shot1204.uuid);
    for (const who of ["Eleanor Cade", "Marcus Cade"]) {
      for (const target of ["Q02", "Q06", "Q05"]) {
        expect(list, `${target}:${who}`).toContain(`${target}:${who}`);
      }
    }
  });

  test("only Q07 is asked at the shot; the rest record what they used",
       async () => {
    for (const r of (await shotReadiness(fx.ctx, SHOT["3B"])).readiness) {
      expect(r.parameters["shot"] ?? null, r.result.target)
        .toBe(r.result.target === "Q07" ? SHOT["3B"] : null);
    }
  });
});

describe("resolveNaturalKey — always an array (§3, §6.4)", () => {
  test("resolves a scene by its number label", async () => {
    const hits = await resolveNaturalKey(fx.ctx, "scene", "12");
    expect(hits).toEqual([
      { uuid: scene12.uuid, entity: "scene", label: "12" },
    ]);
  });

  test("resolves a shot by its shot number, not its free-text name",
      async () => {
    const hits = await resolveNaturalKey(fx.ctx, "shot", shot1204.shotNumber);
    expect(hits).toEqual([
      { uuid: shot1204.uuid, entity: "shot", label: shot1204.shotNumber },
    ]);
  });

  test("resolves a character by exact name, case-insensitively",
      async () => {
    const hits = await resolveNaturalKey(fx.ctx, "character",
      eleanor.name.toUpperCase());
    expect(hits).toEqual([
      { uuid: eleanor.uuid, entity: "character", label: eleanor.name },
    ]);
  });

  test("scene 12A exists and is distinct from scene 12 (§4.2.1's grammar " +
      "is not \"an integer\")", async () => {
    const hits = await resolveNaturalKey(fx.ctx, "scene", "12A");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.uuid).not.toBe(scene12.uuid);
  });

  test("no match returns an empty array, not an error", async () => {
    const hits = await resolveNaturalKey(fx.ctx, "scene", "does-not-exist");
    expect(hits).toEqual([]);
  });

  test("a blank label returns an empty array without querying", async () => {
    const hits = await resolveNaturalKey(fx.ctx, "scene", "   ");
    expect(hits).toEqual([]);
  });

  test("an unknown entity type throws rather than answering wrong",
      async () => {
    await expect(resolveNaturalKey(fx.ctx, "spaceship", "Enterprise"))
      .rejects.toThrow(/unknown entity type/);
  });

  test("a junction entity throws — no typed label exists for one (§6.3)",
      async () => {
    expect(registry.entities.get("scene_character")?.subject).toBe("link");
    await expect(resolveNaturalKey(fx.ctx, "scene_character", "x"))
      .rejects.toThrow(/junction entity/);
  });

  test("a duplicate natural key comes back as two hits, not one (§6.4)",
      async () => {
    const dupCtx: ScfContext = {
      registry,
      exec: async () => ([
        { id: 1, uuid: "11111111-0000-0000-0000-000000000000",
          name: "Twin", lifecycle_status: "active" },
        { id: 2, uuid: "22222222-0000-0000-0000-000000000000",
          name: "Twin", lifecycle_status: "active" },
      ]),
    };
    const hits = await resolveNaturalKey(dupCtx, "character", "Twin");
    expect(hits).toEqual([
      { uuid: "11111111-0000-0000-0000-000000000000",
        entity: "character", label: "Twin" },
      { uuid: "22222222-0000-0000-0000-000000000000",
        entity: "character", label: "Twin" },
    ]);
  });
});
