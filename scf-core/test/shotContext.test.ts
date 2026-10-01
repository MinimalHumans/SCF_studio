// SPDX-License-Identifier: Apache-2.0
/**
 * spec/scf-mcp-design.md §3, §4 — resolveNaturalKey and the shotContext
 * composite.
 *
 * shotContext's whole safety property is that it adds nothing: every
 * member must equal what the query it wraps already returns. Where a
 * blessed `.result.json` already exists for that exact call (Q00, Q04,
 * Q07, and Eleanor/scene12's Q06 and Q13), this compares against it
 * directly rather than re-blessing — the same fixture proves both this
 * composite and canonicalQueries.test.ts correct, so they cannot drift
 * from each other silently.
 *
 * `readiness` has no existing blessed target ("Q07" is new here), so it
 * gets its own small blessed fixture, following the same
 * bless/check pattern as canonicalQueries.test.ts.
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
import { shotContext } from "../src/shotContext.ts";
import type { ScfContext } from "../src/resolution.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)),
                 "..", "..", "fixtures", "expectations");
const BLESS = (import.meta as { env?: { MODE?: string } })
  .env?.MODE === "bless";

let fx: Fixture;
let eleanor: { id: number; uuid: string; name: string };
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

describe("shotContext — composes without deriving (§4.1)", () => {
  test("brief, scene and look are byte-identical to blessed Q00/Q04/Q07",
      async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    expect(ctx.brief).toEqual(loadBlessed("Q00"));
    expect(ctx.scene).toEqual(loadBlessed("Q04"));
    expect(ctx.look).toEqual(loadBlessed("Q07"));
  });

  test("shot is the row `list` returns for it, framing included",
       async () => {
    // Every other member describes what SURROUNDS the shot. Without its
    // own row, a prompt for 3B had its lens and size from a separate
    // list call, or not at all.
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const listed = (await listEntities(fx.ctx, "shot",
      { field: "scene_id", uuid: scene12.uuid }))
      .find((s) => s.uuid === shot1204.uuid);
    expect(ctx.shot).toEqual(listed);
    expect(ctx.shot.label).toBe(shot1204.shotNumber);

    const shot3B = await shotContext(
      fx.ctx, "e9a73271-d1bd-48eb-98f1-afd3f28511e6");
    expect(shot3B.shot.fields).toMatchObject({
      shot_number: "3B", shot_size: "medium", lens_choice: "40mm",
      camera_angle: "eye level", camera_movement: "static",
    });
    expect(shot3B.shot.fields["scene_uuid"])
      .toBe(shot3B.scene.parameters["scene"]);
    // Portable like every result: uuids, never row ids.
    expect(Object.keys(shot3B.shot.fields).some((k) => k.endsWith("_id")))
      .toBe(false);
  });

  test("contextFormat is stamped (§4.4)", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    // 2.0: readiness became a list.
    expect(ctx.contextFormat).toBe("2.0");
  });

  test("physical has one entry per cast member, Eleanor's byte-identical " +
      "to blessed Q06", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    expect(ctx.physical.length).toBe(ctx.scene.result.cast.length);
    const mine = ctx.physical.find(
      (p) => p.parameters["character"] === eleanor.uuid);
    expect(mine).toEqual(loadBlessed("Q06"));
  });

  test("media includes Eleanor's visual_identity, byte-identical to " +
      "blessed Q13", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const mine = ctx.media.find((m) =>
      m.parameters["subject"] === eleanor.uuid &&
      m.result.intent === "visual_identity");
    expect(mine).toEqual(loadBlessed("Q13"));
  });

  test("media covers every intent QUERY_PATHS declares for a character",
      async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const eleanorIntents = ctx.media
      .filter((m) => m.parameters["subject"] === eleanor.uuid)
      .map((m) => m.result.intent)
      .sort();
    expect(eleanorIntents)
      .toEqual(["motion", "visual_identity", "voice_identity"].sort());
  });

  test("every subject kind is swept, not characters alone", async () => {
    // The first MCP session lost the scene's framing plate here: the
    // location and props were in the subject set and asked for
    // nothing, and no member of the result said so.
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const kinds = new Set(ctx.swept.map((s) => s.subjectType));
    expect([...kinds].sort()).toEqual(["character", "location", "prop"]);
    const location = ctx.swept.find((s) => s.subjectType === "location");
    expect(location?.intents).toContain("visual_identity");
    expect(ctx.media.some((m) => m.result.subjectKind === "location"))
      .toBe(true);
  });

  test("a subject with nothing bound is reported, not dropped", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const empty = ctx.swept.filter((s) => s.intents.length === 0);
    for (const s of empty) {
      expect(s.note, `${s.subjectType} ${s.name ?? "?"}`).toBeDefined();
    }
    // Every intent asked for is asked of Q13 exactly once.
    const asked = ctx.swept.reduce((n, s) => n + s.intents.length, 0);
    expect(ctx.media).toHaveLength(asked);
  });

  test("a plate about the SCENE reaches the shot (§8.6)", async () => {
    // It belongs to no subject, so no binding can carry it and nothing
    // in `media` can reach it. The first MCP session wrote a prompt
    // for 3B without it.
    // Shot 3B — the shot the session was writing a prompt for, and the
    // scene whose framing plate it missed.
    const ctx = await shotContext(
      fx.ctx, "e9a73271-d1bd-48eb-98f1-afd3f28511e6");
    expect(ctx.related.map((r) => r.identifier))
      .toContain("@project/shots/marcus_in_the_kitchen.png");
    expect(ctx.related.every((r) => r.about === "scene")).toBe(true);
    for (const r of ctx.related) {
      expect(r.identifier, r.name ?? "?").toBeTypeOf("string");
      expect(r.aboutUuid).toBeTypeOf("string");
    }
  });

  /** Each readiness entry as `target:character name`, in order. */
  const readinessOf = async (shotUuid: string) => {
    const ctx = await shotContext(fx.ctx, shotUuid);
    const names = new Map(ctx.scene.result.cast.map((c) =>
      [c.uuid, String(c.fields["name"])]));
    return ctx.readiness.map((r) => {
      const who = r.parameters["character"];
      return who === null || who === undefined
        ? r.result.target
        : `${r.result.target}:${names.get(String(who)) ?? String(who)}`;
    });
  };
  const SHOT = {
    "3A": "8917aaea-0ab4-4db0-9e6d-1c0fe62805d2",
    "3B": "e9a73271-d1bd-48eb-98f1-afd3f28511e6",
    "3C": "5bb6b9ea-cc07-4bb6-9500-4691ba5c35a6",
  };

  test("readiness opens with the shot's look (Q07), as 1.0's was",
       async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    const look = ctx.readiness[0];
    expect(look?.result.target).toBe("Q07");
    expect(look?.parameters["scene"]).toBe(scene12.uuid);
    expect(look?.parameters["shot"]).toBe(shot1204.uuid);
    blessOrCheck("ShotContext-readiness", ctx.readiness);
  });

  test("3B: look, sound, then each speaking character on screen",
       async () => {
    // Both are seen, and both speak in 3B's lines.
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
    // 12-04 records no presence rows and no lines, so both inherited
    // characters get every check.
    const list = await readinessOf(shot1204.uuid);
    for (const who of ["Eleanor Cade", "Marcus Cade"]) {
      for (const target of ["Q02", "Q06", "Q05"]) {
        expect(list, `${target}:${who}`).toContain(`${target}:${who}`);
      }
    }
  });

  test("only Q07 is asked at the shot; the rest record what they used",
       async () => {
    const ctx = await shotContext(fx.ctx, SHOT["3B"]);
    for (const r of ctx.readiness) {
      expect(r.parameters["shot"] ?? null, r.result.target)
        .toBe(r.result.target === "Q07" ? SHOT["3B"] : null);
    }
  });

  test("throws for an unknown shot uuid rather than answering silently",
      async () => {
    await expect(shotContext(fx.ctx,
      "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
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
