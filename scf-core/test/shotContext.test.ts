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

  test("contextFormat is stamped (§4.4)", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    expect(ctx.contextFormat).toBe("1.0");
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

  test("readiness is Q14 scoped to the shot's own look (Q07)", async () => {
    const ctx = await shotContext(fx.ctx, shot1204.uuid);
    expect(ctx.readiness.result.target).toBe("Q07");
    expect(ctx.readiness.parameters["scene"]).toBe(scene12.uuid);
    expect(ctx.readiness.parameters["shot"]).toBe(shot1204.uuid);
    blessOrCheck("ShotContext-readiness", ctx.readiness);
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
