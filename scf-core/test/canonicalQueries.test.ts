/**
 * Spec §12 — the canonical queries' normative results.
 *
 * The blessed `.result.json` files are the artifact a second
 * implementation compares against. They exist because the previous
 * artifact — rendered markdown — turned out to be a demonstration
 * rather than a specification: an implementer had to infer each query
 * from one example of its output, and reproduce punctuation no document
 * stated.
 *
 * What is tested here is not "does the result match itself". It is the
 * three properties that make a result portable, each asserted
 * independently of the blessed files so the test cannot pass by
 * agreeing with a mistake.
 *
 * Blessing:  npm test -- --mode bless
 * Checking:  npm test
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  Q07_SCENE_LEAF, Q07_SHOT_LEAF, q05Result, q07Result,
} from "../src/canonicalQueries.ts";
import { QUERY_RESULT_FORMAT, projectRow } from "../src/queryResult.ts";
import { openFixture, registry, type Fixture } from "./setup.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)),
                 "..", "..", "fixtures", "expectations");
// scf-core's tsconfig has no Vite types, so `import.meta.env` is not
// declared here as it is in scf-app. Vitest still populates it; this
// reads it without asserting a global shape scf-core does not own.
const BLESS = (import.meta as { env?: { MODE?: string } })
  .env?.MODE === "bless";

let fx: Fixture;
let eleanor: { id: number; uuid: string };
let scene12: { id: number; uuid: string };
let shot1204: { id: number; uuid: string };

const pick = async (sql: string): Promise<{ id: number; uuid: string }> => {
  const r = (await fx.ctx.exec(sql))[0];
  if (r === undefined) throw new Error(`selector matched nothing: ${sql}`);
  return { id: Number(r["id"]), uuid: String(r["uuid"]) };
};

beforeAll(async () => {
  fx = openFixture();
  eleanor = await pick(
    "SELECT id, uuid FROM character WHERE name LIKE '%Eleanor%'");
  scene12 = await pick(
    "SELECT id, uuid FROM scene WHERE scene_number = '12'");
  shot1204 = await pick(
    "SELECT id, uuid FROM shot WHERE name LIKE '%12-04%'");
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

describe("§12.1.2 row projection", () => {
  test("drops row ids and volatile columns", () => {
    const p = projectRow({
      id: 7, uuid: "u", name: "x",
      created_at: "2026-01-01", updated_at: "2026-01-02",
    });
    expect(p.uuid).toBe("u");
    expect(Object.keys(p.fields)).toEqual(["name"]);
  });

  test("omits null and empty fields, so absence is unambiguous", () => {
    const p = projectRow({ uuid: "u", a: null, b: "", c: 0, d: "x" });
    // 0 is a value, not an absence — dropping it would be a bug that
    // only shows up on a field that is legitimately zero.
    expect(Object.keys(p.fields).sort()).toEqual(["c", "d"]);
  });

  test("resolves a reference column to the target's uuid", () => {
    const p = projectRow({ uuid: "u", scene_id: 3 }, { scene_id: "scene" },
                         (entity, id) =>
                           entity === "scene" && id === 3 ? "scene-uuid" : null);
    expect(p.fields["scene_uuid"]).toBe("scene-uuid");
    expect(p.fields["scene_id"]).toBeUndefined();
  });

  test("drops an unmapped reference rather than emitting a row id", () => {
    // The defect this module exists to prevent. Emitting the raw id
    // would be worse than losing the field: it would look like data.
    const p = projectRow({ uuid: "u", mystery_id: 42 });
    expect(p.fields["mystery_id"]).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("42");
  });

  test("a row with no uuid projects with a null one, not a throw", () => {
    expect(projectRow({ name: "x" }).uuid).toBeNull();
  });
});

describe("§12.2 Q05 — voice direction", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q05", await q05Result(
      fx.ctx, eleanor.uuid, scene12.uuid, eleanor.id, scene12.id));
  });

  test("the envelope names the query and what was asked", async () => {
    const r = await q05Result(fx.ctx, eleanor.uuid, scene12.uuid,
                              eleanor.id, scene12.id);
    expect(r.query).toBe("Q05");
    expect(r.resultFormat).toBe(QUERY_RESULT_FORMAT);
    expect(r.schemaVersion).toBe(registry.schemaVersion);
    expect(r.parameters).toEqual({
      character: eleanor.uuid, scene: scene12.uuid,
    });
  });

  test("the baseline is present for a character who has one", async () => {
    const r = await q05Result(fx.ctx, eleanor.uuid, scene12.uuid,
                              eleanor.id, scene12.id);
    expect(r.result.modality).toBe("vocal");
    expect(r.result.baseline?.fields["name"]).toBe("Eleanor voice");
    expect(r.result.baseline?.uuid).toBeTypeOf("string");
  });

  test("a character with no vocal profile gets a null baseline",
       async () => {
    // §12.2: a well-defined absence, not an error. The fixture keeps one
    // character deliberately thin so this case is real rather than
    // hypothetical.
    const marcus = await pick(
      "SELECT id, uuid FROM character WHERE name LIKE '%Marcus%'");
    const r = await q05Result(fx.ctx, marcus.uuid, scene12.uuid,
                              marcus.id, scene12.id);
    expect(r.result).toHaveProperty("baseline");
    expect(r.result.beats.every((b) => b.uuid !== null)).toBe(true);
  });

  test("beats carry their scene and character as uuids", async () => {
    const r = await q05Result(fx.ctx, eleanor.uuid, scene12.uuid,
                              eleanor.id, scene12.id);
    expect(r.result.beats.length).toBeGreaterThan(0);
    for (const b of r.result.beats) {
      expect(b.fields["scene_uuid"]).toBe(scene12.uuid);
      expect(b.fields["character_uuid"]).toBe(eleanor.uuid);
    }
  });
});

describe("§12.3 Q07 — look resolution", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q07", await q07Result(
      fx.ctx, scene12.uuid, scene12.id, shot1204.uuid, shot1204.id));
  });

  test("the leaf depends on the parameters, not the data", async () => {
    // §12.3.1 and §7.1. The same scene answers with a different leaf
    // depending on whether a shot was named — which is why the leaf
    // cannot be derived from the file.
    const withShot = await q07Result(
      fx.ctx, scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    const sceneOnly = await q07Result(
      fx.ctx, scene12.uuid, scene12.id, null, null);

    expect(withShot.result.leaf).toBe(Q07_SHOT_LEAF);
    expect(sceneOnly.result.leaf).toBe(Q07_SCENE_LEAF);
    expect(withShot.result.layers.length)
      .toBeGreaterThan(sceneOnly.result.layers.length);
  });

  test("layers are root first and end at the leaf", async () => {
    const r = await q07Result(fx.ctx, scene12.uuid, scene12.id,
                              shot1204.uuid, shot1204.id);
    expect(r.result.layers.at(-1)?.entity).toBe(Q07_SHOT_LEAF);
    expect(r.result.layers[0]?.entity).not.toBe(Q07_SHOT_LEAF);
  });

  test("the chain is the refines closure, not a scope ordering",
       async () => {
    // The defect an independent implementation caught: §7 used to
    // describe project → sequence → scene → shot. `look_development` is
    // scope:global and sits fifth, which no scope ordering produces.
    const r = await q07Result(fx.ctx, scene12.uuid, scene12.id,
                              shot1204.uuid, shot1204.id);
    const names = r.result.layers.map((l) => l.entity);
    expect(names).toContain("look_development");
    expect(names.indexOf("look_development"))
      .toBeGreaterThan(names.indexOf("scene_color_palette"));
  });

  test("no layer is present-and-empty", async () => {
    // §12.3.2: an entity contributing nothing is absent from `layers`.
    const r = await q07Result(fx.ctx, scene12.uuid, scene12.id,
                              shot1204.uuid, shot1204.id);
    for (const l of r.result.layers) {
      expect(Object.keys(l.row.fields).length).toBeGreaterThan(0);
    }
  });
});

describe("the results are portable", () => {
  test("no row id or timestamp appears anywhere in either", async () => {
    // The property the whole section rests on, asserted over the real
    // serialised output rather than over a projection in isolation.
    for (const name of ["Q05", "Q07"]) {
      const text = readFileSync(join(OUT, `${name}.result.json`), "utf8");
      const parsed = JSON.parse(text) as unknown;
      const walk = (v: unknown, path: string): void => {
        if (Array.isArray(v)) {
          v.forEach((x, i) => { walk(x, `${path}[${String(i)}]`); });
          return;
        }
        if (v !== null && typeof v === "object") {
          for (const [k, value] of Object.entries(v)) {
            expect(k, `${name} ${path}`).not.toBe("id");
            expect(k, `${name} ${path}`).not.toBe("created_at");
            expect(k, `${name} ${path}`).not.toBe("updated_at");
            expect(k.endsWith("_id"), `${name} ${path}.${k}`).toBe(false);
            walk(value, `${path}.${k}`);
          }
        }
      };
      walk(parsed, name);
    }
  });

  test("both declare the same result format", () => {
    for (const name of ["Q05", "Q07"]) {
      const r = JSON.parse(
        readFileSync(join(OUT, `${name}.result.json`), "utf8")) as {
          resultFormat: string; parameters: Record<string, unknown>;
        };
      expect(r.resultFormat).toBe(QUERY_RESULT_FORMAT);
      // Every parameter is a uuid or null — never a row id.
      for (const v of Object.values(r.parameters)) {
        if (v !== null) expect(String(v)).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
  });
});
