// SPDX-License-Identifier: Apache-2.0
/**
 * runners.test.ts — every query page exercised headlessly against the
 * Hollow Creek fixture (Node driver). Human views aren't covered here;
 * run() and toMarkdown() — the JSON and context consumer modes — are.
 *
 * run() returns scf-core's normative result, so these assert that the
 * page wires its parameters through and renders what comes back; the
 * result structure itself is pinned by scf-core/test/canonicalQueries.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import type { ScfContext } from "@scf-core/resolution.ts";
import type {
  Q00Result, Q01Result, Q02Result, Q04Result, Q09Result, Q10Result,
  Q11Result, Q12Result,
} from "@scf-core/canonicalQueries.ts";
import { QUERIES, uuidKey, type ParamValues } from "./runners.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../../fixtures/hollow_creek.scf");
const REGISTRY = join(HERE, "../../../../scf-core/registry/registry.json");

let db: NodeDatabase;
let registry: Registry;
let ctx: ScfContext;
let params: Record<string, ParamValues>;

/** A row parameter as the picker sets it: row id and uuid together. */
async function row(key: string, sql: string): Promise<ParamValues> {
  const r = (await db.exec(sql))[0];
  if (r === undefined) throw new Error(`no row for ${sql}`);
  return { [key]: Number(r["id"]), [uuidKey(key)]: String(r["uuid"]) };
}

const spec = (id: string) => {
  const s = QUERIES.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no spec ${id}`);
  return s;
};

const run = async <T>(id: string, values = params[id]!): Promise<T> =>
  (await spec(id).run(ctx, values)).result as T;

beforeAll(async () => {
  registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(FIXTURE, { readOnly: true });
  ctx = { exec: db.exec, registry };
  const eleanor = (key: string) => row(key,
    "SELECT id, uuid FROM character WHERE name LIKE '%Eleanor%'");
  const sc = (key: string, n: number) => row(key,
    `SELECT id, uuid FROM scene WHERE scene_number = ${n}`);
  const shot = await row("shot_id",
    "SELECT id, uuid FROM shot WHERE name LIKE '%12-04%'");
  const sc12 = await sc("scene_id", 12);
  params = {
    Q00: {},
    Q01: { subject: "character", ...await eleanor("subject_id") },
    Q02: { subject: "character", ...await eleanor("subject_id"), ...sc12 },
    Q03: sc12,
    Q04: sc12,
    Q05: { ...await eleanor("character_id"), ...sc12 },
    Q06: { ...await eleanor("character_id"), ...sc12 },
    Q07: { ...sc12, ...shot },
    Q08: sc12,
    Q09: sc12,
    Q10: await row("theme_id", "SELECT id, uuid FROM theme ORDER BY id"),
    Q11: sc12,
    Q12: { ...await sc("scene_a", 9), ...await sc("scene_b", 12) },
    Q13: { subject: "character", ...await eleanor("subject_id"),
           intent: "visual_identity", ...sc12, ...shot },
    Q14: { target: "Q05", ...await eleanor("character_id"), ...sc12 },
    Q15: { entity_type: "character", ...await eleanor("row_id") },
  };
});

afterAll(() => db.close());

describe("query pages against the fixture", () => {
  test("there is a page for each of the sixteen canonical queries", () => {
    expect(QUERIES.map((s) => s.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `Q${String(i).padStart(2, "0")}`));
  });

  test.each(QUERIES.map((s) => s.id))(
    "%s returns its normative envelope and renders markdown", async (id) => {
      const payload = await spec(id).run(ctx, params[id]!);
      expect(payload.query).toBe(id);
      expect(payload.schemaVersion).toBe(registry.schemaVersion);
      const md = spec(id).toMarkdown(payload, registry);
      expect(md.length).toBeGreaterThan(40);
      expect(md.startsWith("#")).toBe(true);
    });

  test("a missing row parameter is an error, not a guess", async () => {
    // Without its uuid a pick cannot fill the envelope (§12.1.1).
    await expect(spec("Q03").run(ctx, { scene_id: 1 }))
      .rejects.toThrow(/pick/);
  });

  test("Q12 shows the known 9→12 state change", async () => {
    const p = await run<Q12Result>("Q12");
    const eleanor = p.characters.find(
      (c) => String(c.character.fields["name"]).includes("Eleanor"));
    expect(eleanor).toBeDefined();
    expect(new Set(eleanor!.statesFrom))
      .toEqual(new Set(["wounded", "hoarse"]));
    expect(eleanor!.statesTo).toEqual(["wounded"]);
    const locket = p.props.find(
      (x) => String(x.prop.fields["name"]).toLowerCase().includes("locket"));
    expect(locket?.whereFrom).toBe("saddlebag");
    expect(locket?.whereTo).toBe("coat pocket");
  });

  test("Q07 cascade markdown marks the most specific layer", async () => {
    const md = spec("Q07").toMarkdown(
      await spec("Q07").run(ctx, params["Q07"]!), registry);
    expect(md).toContain("shot_design");
    expect(md).toContain("← in force");
  });

  test("Q00 brief carries the tone root the cascades resolve against",
      async () => {
    const p = await run<Q00Result>("Q00");
    const layers = new Set(p.layers.map((l) => l.entity));
    expect(layers.has("project")).toBe(true);
    expect(layers.has("sonic_identity")).toBe(true);
    expect(layers.has("project_color_palette")).toBe(true);
    expect(p.themes.length).toBeGreaterThan(0);
  });

  test("Q01 dossier walks the subject metadata generically", async () => {
    const groups = (await run<Q01Result>("Q01")).groups.map((g) => g.entity);
    expect(groups).toContain("vocal_profile");
    expect(groups).toContain("physical_character_profile");
  });

  test("Q02 carries the scene's states and Q13's media", async () => {
    const p = await run<Q02Result>("Q02");
    expect(p.dossier.groups.length).toBeGreaterThan(0);
    expect(p.performanceStates.map((r) => r.fields["name"]))
      .toEqual(["wounded"]);
    expect(p.media.fromQuery).toBe("Q13");
    expect(p.media.references.length).toBeGreaterThan(0);
  });

  test("Q04 package: derived lineage, cast with presence, the variant",
      async () => {
    const p = await run<Q04Result>("Q04");
    // Lineage comes from span boundaries (§5.4), not `sequence.act_id`:
    // act first, then sequence.
    expect(p.lineage.map((l) => l.entity)).toEqual(["act", "sequence"]);
    expect(p.cast.length).toBe(2);
    expect(p.cast.every((c) => c.presence !== undefined)).toBe(true);
    const v = p.locationVariant;
    expect(String(v.variant?.fields["name"]).toLowerCase())
      .toContain("night");
    // The variant is the best available AND wrong about the season —
    // built for an autumn night, reused in winter (0.42).
    expect(v.mismatches).toHaveLength(1);
    expect(v.mismatches[0]).toContain("season");
  });

  test("Q09 manifest matches the conformance scene and finds no locket",
      async () => {
    const p = await run<Q09Result>("Q09");
    const names = p.manifest.map((m) => String(m.motif?.fields["name"]));
    expect(new Set(names)).toEqual(
      new Set(["Open doors", "Wind chime", "Unfinished sentences"]));
    expect(names.join()).not.toContain("locket");
  });

  test("Q10 accounting finds carriage and gaps", async () => {
    // A theme carried by both leads is lit in every scene and shows no
    // gap; a narrowly carried theme is where the accounting earns its
    // keep.
    const narrow = await row("theme_id",
      "SELECT id, uuid FROM theme WHERE name LIKE '%water%' ORDER BY id");
    const p = await run<Q10Result>("Q10", narrow);
    expect(p.carriers.length).toBeGreaterThan(0);
    expect(p.spine.some((s) => s.carriers > 0)).toBe(true);
    expect(p.spine.some((s) => s.carriers === 0)).toBe(true);
  });

  test("Q11 audience state matches the conformance answers", async () => {
    const p = await run<Q11Result>("Q11");
    expect(String(p.identification?.primary?.fields["name"]))
      .toContain("Eleanor");
    expect(String(p.information?.fields["information_withheld"]))
      .toContain("creek");
    expect(p.emotionalCascade.map((l) => l.entity))
      .toEqual(["project_tone", "scene_emotional_target"]);
  });
});

describe("query pages answer nothing themselves", () => {
  // The class fix for release-checklist §B1: a query page that runs its
  // own SQL is a second answer to a normative question, and the copies
  // drifted from scf-core twice. Pages render qNNResult(); they do not
  // query.
  test("no ctx.exec under ui/queries/", () => {
    const offenders = readdirSync(HERE)
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => /\bctx\.exec\b/.test(readFileSync(join(HERE, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
