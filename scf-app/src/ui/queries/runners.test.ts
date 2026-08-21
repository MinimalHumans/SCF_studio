// SPDX-License-Identifier: Apache-2.0
/**
 * runners.test.ts — every query runner exercised headlessly against the
 * Hollow Creek fixture (Node driver). Human views aren't covered here;
 * run() and toMarkdown() — the JSON and context consumer modes — are.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";
import type { ScfContext } from "@scf-core/resolution.ts";
import { QUERIES, type ParamValues, type Q12Payload } from "./runners.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../../fixtures/hollow_creek.scf");
const REGISTRY = join(HERE, "../../../../scf-core/registry/registry.json");

let db: NodeDatabase;
let ctx: ScfContext;
let params: Record<string, ParamValues>;

beforeAll(async () => {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(FIXTURE, { readOnly: true });
  ctx = { exec: db.exec, registry };
  const one = async (sql: string): Promise<number> =>
    (await db.exec(sql))[0]!["id"] as number;
  const eleanor = await one(
    "SELECT id FROM character WHERE name LIKE '%Eleanor%'");
  const sc9 = await one("SELECT id FROM scene WHERE scene_number=9");
  const sc12 = await one("SELECT id FROM scene WHERE scene_number=12");
  const shot = await one("SELECT id FROM shot WHERE name LIKE '%12-04%'");
  params = {
    Q03: { scene_id: sc12 },
    Q05: { character_id: eleanor, scene_id: sc12 },
    Q06: { character_id: eleanor, scene_id: sc12 },
    Q07: { scene_id: sc12, shot_id: shot },
    Q08: { scene_id: sc12 },
    Q12: { scene_a: sc9, scene_b: sc12 },
    Q13: { subject: "character", subject_id: eleanor,
           intent: "visual_identity", scene_id: sc12, shot_id: shot },
    Q14: { target: "Q05", character_id: eleanor, scene_id: sc12 },
  };
});

afterAll(() => db.close());

describe("query runners against the fixture", () => {
  test.each(["Q03", "Q05", "Q06", "Q07", "Q08", "Q12", "Q13", "Q14"])(
    "%s runs and renders context markdown", async (id) => {
      const spec = QUERIES.find((s) => s.id === id);
      expect(spec).toBeDefined();
      const payload = await spec!.run(ctx, params[id]!);
      expect(payload).not.toBeNull();
      const md = spec!.toMarkdown(payload, params[id]!);
      expect(md.length).toBeGreaterThan(40);
      expect(md.startsWith("#")).toBe(true);
    });

  test("Q12 shows the known 9→12 state change", async () => {
    const spec = QUERIES.find((s) => s.id === "Q12")!;
    const p = await spec.run(ctx, params["Q12"]!) as Q12Payload;
    const eleanor = p.characters.find(
      (c) => String(c.character["name"]).includes("Eleanor"));
    expect(eleanor).toBeDefined();
    expect(new Set(eleanor!.statesA)).toEqual(new Set(["wounded", "hoarse"]));
    expect(eleanor!.statesB).toEqual(["wounded"]);
    const locket = p.props.find(
      (x) => String(x.prop["name"]).toLowerCase().includes("locket"));
    expect(locket?.whereA).toBe("saddlebag");
    expect(locket?.whereB).toBe("coat pocket");
  });

  test("Q07 cascade markdown marks the most specific layer", async () => {
    const spec = QUERIES.find((s) => s.id === "Q07")!;
    const md = spec.toMarkdown(
      await spec.run(ctx, params["Q07"]!), params["Q07"]!);
    expect(md).toContain("shot_design");
    expect(md).toContain("← in force");
  });
});

// ---------------------------------------------------------------------------
// Composed queries (Q00, Q01, Q02, Q04, Q09, Q10, Q11, Q15)
// ---------------------------------------------------------------------------
import type {
  Q00Payload, Q01Payload, Q02Payload, Q04Payload, Q09Payload,
  Q10Payload, Q11Payload,
} from "./runnersComposed.ts";

describe("composed query runners against the fixture", () => {
  let extra: Record<string, ParamValues>;

  beforeAll(async () => {
    const one = async (sql: string): Promise<number> =>
      (await db.exec(sql))[0]!["id"] as number;
    const eleanor = await one(
      "SELECT id FROM character WHERE name LIKE '%Eleanor%'");
    const sc12 = await one("SELECT id FROM scene WHERE scene_number=12");
    const theme = await one("SELECT id FROM theme");
    extra = {
      Q00: {},
      Q01: { subject: "character", subject_id: eleanor },
      Q02: { subject: "character", subject_id: eleanor, scene_id: sc12 },
      Q04: { scene_id: sc12 },
      Q09: { scene_id: sc12 },
      Q10: { theme_id: theme },
      Q11: { scene_id: sc12 },
      Q15: { entity_type: "character", row_id: eleanor },
    };
  });

  test.each(["Q00", "Q01", "Q02", "Q04", "Q09", "Q10", "Q11", "Q15"])(
    "%s runs and renders context markdown", async (id) => {
      const spec = QUERIES.find((s) => s.id === id);
      expect(spec).toBeDefined();
      const payload = await spec!.run(ctx, extra[id]!);
      const md = spec!.toMarkdown(payload, extra[id]!);
      expect(md.length).toBeGreaterThan(60);
      expect(md.startsWith("#")).toBe(true);
    });

  test("Q00 brief carries the tone root the cascades resolve against",
      async () => {
    const spec = QUERIES.find((s) => s.id === "Q00")!;
    const p = await spec.run(ctx, {}) as Q00Payload;
    const layers = new Map(p.layers.map((l) => [l.entity, l.row]));
    expect(layers.get("project")).not.toBeNull();
    expect(layers.get("sonic_identity")).not.toBeNull();
    expect(layers.get("project_color_palette")).not.toBeNull();
    expect(p.themes.length).toBeGreaterThan(0);
  });

  test("Q01 dossier walks the G2 metadata generically", async () => {
    const spec = QUERIES.find((s) => s.id === "Q01")!;
    const p = await spec.run(ctx, extra["Q01"]!) as Q01Payload;
    const groupNames = p.groups.map((g) => g.entity);
    expect(groupNames).toContain("vocal_profile");
    expect(groupNames).toContain("physical_character_profile");
  });

  test("Q02 stack is ordered global -> most specific with media last",
      async () => {
    const spec = QUERIES.find((s) => s.id === "Q02")!;
    const p = await spec.run(ctx, extra["Q02"]!) as Q02Payload;
    expect(p.stack[0]!.kind).toBe("dossier");
    expect(p.stack[p.stack.length - 1]!.kind).toBe("media");
    const states = p.stack.find((l) =>
      l.label.includes("Performance states"));
    expect(states?.rows?.map((r) => r["name"])).toEqual(["wounded"]);
    const media = p.stack[p.stack.length - 1]!.media!;
    expect(media.assets_most_specific_first.length).toBeGreaterThan(0);
  });

  test("Q04 package: lineage, cast, and the G4 variant", async () => {
    const spec = QUERIES.find((s) => s.id === "Q04")!;
    const p = await spec.run(ctx, extra["Q04"]!) as Q04Payload;
    expect(p.cast.length).toBe(2);
    expect(p.variant).not.toBeNull();
    expect(String(p.variant!["name"]).toLowerCase()).toContain("night");
    expect(p.variantMismatches).toEqual([]);
  });

  test("Q09 manifest matches the conformance scene and finds no locket",
      async () => {
    const spec = QUERIES.find((s) => s.id === "Q09")!;
    const p = await spec.run(ctx, extra["Q09"]!) as Q09Payload;
    const names = p.manifest.map((m) => String(m.motif?.["name"]));
    expect(new Set(names)).toEqual(
      new Set(["Open doors", "Wind chime", "Unfinished sentences"]));
    expect(names.join()).not.toContain("locket");
  });

  test("Q10 accounting finds carriage and gaps", async () => {
    const spec = QUERIES.find((s) => s.id === "Q10")!;
    const p = await spec.run(ctx, extra["Q10"]!) as Q10Payload;
    expect(p.connections.length).toBeGreaterThan(0);
    expect(p.spine.some((s) => s.count > 0)).toBe(true);

    // The gap is the point of Q10, but a theme carried by both leads is
    // lit in every scene — true of the demo's spine theme, and it
    // demonstrates nothing. A narrowly carried theme is where the
    // accounting earns its keep.
    const narrow = (await ctx.exec(
      "SELECT id FROM theme WHERE name LIKE '%water%' ORDER BY id"
    ))[0]!["id"] as number;
    const q = await spec.run(ctx, { theme_id: narrow }) as Q10Payload;
    expect(q.spine.some((s) => s.count > 0)).toBe(true);
    expect(q.spine.some((s) => s.count === 0)).toBe(true);
  });

  test("Q11 audience state matches the conformance answers", async () => {
    const spec = QUERIES.find((s) => s.id === "Q11")!;
    const p = await spec.run(ctx, extra["Q11"]!) as Q11Payload;
    expect(String(p.identification?.primary?.["name"]))
      .toContain("Eleanor");
    expect(String(p.information?.["information_withheld"]))
      .toContain("creek");
    expect(p.emotionalCascade.map(([n]) => n))
      .toEqual(["project_tone", "scene_emotional_target"]);
  });
});
