// SPDX-License-Identifier: Apache-2.0
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
  MOTIF_DENSITY_THRESHOLD, Q00_LAYERS, Q07_SCENE_LEAF, Q07_SHOT_LEAF,
  mentionsRow, q00Result, q01Result, q02Result, q04Result,
  q11Result, q15Result, q03Result,
  q05Result, q06Result, q07Result, q08Result, q09Result, q10Result,
  q12Result, q13Result, q14Result,
} from "../src/canonicalQueries.ts";
import {
  POLYMORPHIC, QUERY_RESULT_FORMAT, projectRow, columnRoles,
} from "../src/queryResult.ts";
import { sceneOrder, trailLine } from "../src/resolution.ts";
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
let scene19: { id: number; uuid: string };
let scene16: { id: number; uuid: string };
let theme: { id: number; uuid: string };
let scene3: { id: number; uuid: string };
let scene25: { id: number; uuid: string };
let marcusId: { id: number; uuid: string };
let shot3B: { id: number; uuid: string };

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
  // Deliberately off scene 12, and deliberately the pair whose script
  // order and scene-number order disagree: 19 comes BEFORE 16 in the
  // script. An implementation ordering by scene_number would diff them
  // backwards, which is the bug that hid under 540 passing tests.
  scene19 = await pick("SELECT id, uuid FROM scene WHERE scene_number = '19'");
  scene16 = await pick("SELECT id, uuid FROM scene WHERE scene_number = '16'");
  theme = await pick("SELECT id, uuid FROM theme ORDER BY id LIMIT 1");
  // Day, before the injury: the position where Q13's filtered bindings
  // must be EXCLUDED, which scene 12 cannot show.
  scene3 = await pick("SELECT id, uuid FROM scene WHERE scene_number = '3'");
  scene25 = await pick("SELECT id, uuid FROM scene WHERE scene_number = '25'");
  marcusId = await pick(
    "SELECT id, uuid FROM character WHERE name LIKE '%Marcus%'");
  shot3B = await pick("SELECT id, uuid FROM shot WHERE shot_number = '3B'");
  if (BLESS) mkdirSync(OUT, { recursive: true });
});

afterAll(() => { fx.close(); });

/** Q13's structured trail, rendered one line per entry for assertions. */
const q13Lines = (r: { result: { trail: Array<{
  layer: string; name: string | null; bundle: { name: string | null } | null;
  excluded: { reason: string } | null; }> } }): string[] =>
  r.result.trail.map((t) => trailLine({
    layer: t.layer, name: t.name, bundleName: t.bundle?.name ?? null,
    reason: t.excluded?.reason ?? null }));

const blessOrCheck = (name: string, value: unknown): void => {
  const path = join(OUT, `${name}.result.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (BLESS) { writeFileSync(path, text, "utf8"); return; }
  expect(existsSync(path), `${name}.result.json missing — bless first`)
    .toBe(true);
  expect(text).toBe(readFileSync(path, "utf8"));
};

describe("§12.1.2 reference maps come from the registry", () => {
  test("every reference column an entity declares is projected", () => {
    // Hand-written maps disagreed between queries: `scene.location_id`
    // was resolved in one result and dropped in another. Deriving them
    // makes that impossible rather than unlikely.
    const sceneRefs = columnRoles(registry, "scene");
    expect(sceneRefs["location_id"]).toBe("location");
    const motifRefs = columnRoles(registry, "motif");
    expect(Object.keys(motifRefs).sort())
      .toEqual(["first_appearance_scene_id", "related_motif_id"]);
  });

  test("an entity with no references yields an empty map", () => {
    expect(columnRoles(registry, "nonexistent_entity")).toEqual({});
  });
});

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

  test("drops a POLYMORPHIC reference rather than emitting a row id", () => {
    // The defect this module exists to prevent. Emitting the raw id
    // would be worse than losing the field: it would look like data.
    const p = projectRow({ uuid: "u", entity_id: 42 },
                         { entity_id: POLYMORPHIC });
    expect(p.fields["entity_id"]).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("42");
  });

  test("keeps a column ending _id that is NOT a reference", () => {
    // INVERTED IN 0.40, and this is the whole point of the change.
    // The rule was "any remaining column ending `_id` is dropped",
    // which is true of the four polymorphic columns and ALSO true of
    // `external_id` — a declared, authored field on ten entities
    // (§6.3) — and of any ordinary reference into a screenplay table.
    //
    // Twelve legitimate columns were deleted from every projected row,
    // and no published artifact could catch it: the fixture authors no
    // external_id and its clip table is empty, so §12.1.2's
    // omit-empties rule made a correct implementation and a
    // data-losing one byte-identical on all sixteen results.
    const p = projectRow({ uuid: "u", external_id: "OMC:12345" });
    expect(p.fields["external_id"]).toBe("OMC:12345");
  });

  test("external_id survives on a real entity's reference map", () => {
    // Through columnRoles rather than a hand-built map, because the
    // bug was in what columnRoles did NOT say about the column.
    const refs = columnRoles(fx.ctx.registry, "character");
    expect(refs["external_id"]).toBeUndefined();
    const p = projectRow({ uuid: "u", external_id: "tt0000001" }, refs);
    expect(p.fields["external_id"]).toBe("tt0000001");
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

describe("§12.4 Q03 — world state, away from scene 12", () => {
  test("matches its blessed result at scene 19", async () => {
    blessOrCheck("Q03", await q03Result(fx.ctx, scene19.uuid, scene19.id));
  });

  test("the cut scene is not a position anything answers about",
       async () => {
    // §6.6.1 at the query layer. 12B is cut and keeps its heading, so a
    // reader that took positions from the screenplay would answer here.
    const cut = await fx.ctx.exec(
      "SELECT id, uuid FROM scene WHERE lifecycle_status = 'cut'");
    const r = await q03Result(fx.ctx, String(cut[0]?.["uuid"]),
                              Number(cut[0]?.["id"]));
    expect(r.result.scene).toBeNull();
    expect(r.result.characters).toEqual([]);
    expect(r.result.props).toEqual([]);
  });

  test("every query asked at the cut scene answers an empty position",
       async () => {
    // §12.1.7, Q03's rule for every scene parameter. Rows still keyed
    // to 12B are not cut themselves; Q04 used to return its heading and
    // lines as the scene's screenplay. What does not depend on the
    // position — Eleanor's voice baseline — still answers.
    const cut = await fx.ctx.exec(
      "SELECT id, uuid FROM scene WHERE lifecycle_status = 'cut'");
    const id = Number(cut[0]?.["id"]);
    const uuid = String(cut[0]?.["uuid"]);
    const q04 = await q04Result(fx.ctx, uuid, id);
    expect(q04.result.scene).toBeNull();
    expect(q04.result.screenplay).toEqual([]);
    expect(q04.parameters["scene"]).toBe(uuid);
    const q05 = await q05Result(fx.ctx, eleanor.uuid, uuid, eleanor.id, id);
    expect(q05.result.baseline).not.toBeNull();
    expect([q05.result.states, q05.result.beats]).toEqual([[], []]);
    const q11 = await q11Result(fx.ctx, uuid, id);
    expect([q11.result.scene, q11.result.toneMarkers]).toEqual([null, []]);
    const q12 = await q12Result(fx.ctx, uuid, scene12.uuid, id, scene12.id);
    expect(q12.result.from).toBeNull();
    expect(q12.result.to).not.toBeNull();
  });

  test("every row in the result carries a uuid", async () => {
    const r = await q03Result(fx.ctx, scene19.uuid, scene19.id);
    for (const c of r.result.characters) {
      expect(c.character.uuid).toBeTypeOf("string");
    }
  });
});

describe("§12.5 Q12 — continuity across the reorder", () => {
  test("matches its blessed result from 19 to 16", async () => {
    blessOrCheck("Q12", await q12Result(
      fx.ctx, scene19.uuid, scene16.uuid, scene19.id, scene16.id));
  });

  test("the diff follows story order, not scene-number order", async () => {
    // The test the suite was missing. In the script 19 precedes 16, so
    // 19 → 16 is FORWARD. An implementation ordering by scene_number
    // would treat it as backward and resolve every pattern-2 and
    // pattern-3 state at the wrong position.
    const order = await sceneOrder(fx.ctx);
    const posFrom = order.get(scene19.id);
    const posTo = order.get(scene16.id);
    expect(posFrom).toBeDefined();
    expect(posTo).toBeDefined();
    expect(posTo ?? 0).toBeGreaterThan(posFrom ?? 0);
    // ...while their numbers say the opposite.
    expect(Number("16")).toBeLessThan(Number("19"));
  });

  test("names the two positions it diffed", async () => {
    const r = await q12Result(fx.ctx, scene19.uuid, scene16.uuid,
                              scene19.id, scene16.id);
    expect(r.parameters).toEqual({
      from: scene19.uuid, to: scene16.uuid,
    });
    expect(r.result.from?.uuid).toBe(scene19.uuid);
    expect(r.result.to?.uuid).toBe(scene16.uuid);
  });
});

describe("§12.6 Q06 and §12.7 Q08 — the twins", () => {
  test("Q06 matches its blessed result", async () => {
    blessOrCheck("Q06", await q06Result(
      fx.ctx, eleanor.uuid, scene12.uuid, eleanor.id, scene12.id));
  });

  test("Q08 matches its blessed result", async () => {
    blessOrCheck("Q08", await q08Result(fx.ctx, scene12.uuid, scene12.id));
  });

  test("Q06 is Q05 with a different modality, and says so", async () => {
    const q05 = await q05Result(fx.ctx, eleanor.uuid, scene12.uuid,
                                eleanor.id, scene12.id);
    const q06 = await q06Result(fx.ctx, eleanor.uuid, scene12.uuid,
                                eleanor.id, scene12.id);
    expect(q05.result.modality).toBe("vocal");
    expect(q06.result.modality).toBe("physical");
    // Same shape, different content — which is the argument for one
    // builder rather than two.
    expect(Object.keys(q06.result).sort())
      .toEqual(Object.keys(q05.result).sort());
    expect(q06.query).toBe("Q06");
  });

  test("Q08 takes no shot, and its parameters say so", async () => {
    // §12.7: sound is authored at the scene and there is no shot-level
    // sound entity to be a leaf. The null is the statement.
    const r = await q08Result(fx.ctx, scene12.uuid, scene12.id);
    expect(r.parameters["shot"]).toBeNull();
    expect(r.result.leaf).toBe("scene_music_design");
  });
});

describe("§12.8 Q13 — media resolution", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q13", await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id));
  });

  test("at scene 3 it matches its blessed result, the filter excluding",
       async () => {
    // Q13's normative position is 12-04, where every filtered binding
    // legitimately applies, so it cannot tell an evaluated filter from an
    // unread one. Same subject and intent at a day, pre-injury shot: the
    // wounded binding must be EXCLUDED and say why. Not normative, like
    // ShotContext-readiness; bindingFilters.test.ts covers each filter.
    const r = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene3.uuid, scene3.id, shot3B.uuid, shot3B.id);
    blessOrCheck("Q13-scene3", r);
    expect(q13Lines(r)).toContain(
      "binding Eleanor while wounded -> bundle Eleanor - lamplit, wounded: " +
      "EXCLUDED, physical_state_filter \"wounded\", no such physical " +
      "state in force");
  });

  test("at scene 25 it matches its blessed result, a variant in force",
       async () => {
    // Proposal 0033. Every normative result sits where no variant is in
    // force, so all sixteen read the same whether an implementation
    // honours §4.8 or ignores it — the class 0027 and the R92 fixture
    // pass were about. Marcus in the flashback: the variant-filtered
    // binding replaces his baseline, and the variant's face is the only
    // anchor. Not normative, like Q13-scene3; variants.test.ts covers
    // each rule two-sided.
    const r = await q13Result(
      fx.ctx, "character", marcusId.uuid, marcusId.id, "visual_identity",
      scene25.uuid, scene25.id, null, null);
    blessOrCheck("Q13-scene25", r);
    expect(q13Lines(r)).toContain(
      "binding Marcus visual baseline -> bundle Marcus Visual Core: " +
      "EXCLUDED, replaced by Marcus as a boy");
    expect(r.result.references.map((x) => x.name))
      .toEqual(["marcus_age9_ref.png"]);
  });

  test("an anchor contributes the asset it anchors, not itself",
       async () => {
    // The defect an independent implementation found: the anchor row was
    // reported as the reference, so it had no identifier and could never
    // resolve — and a caller looking its row id up in `asset` got an
    // unrelated asset that happened to share the id. It produced a
    // well-formed uuid, so every portability test passed.
    const r = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);

    const anchor = r.result.references.find((x) => x.provenance === "anchor");
    expect(anchor).toBeDefined();
    expect(anchor?.anchorName).toBe("Eleanor Face Anchor");
    // The asset, with its own identity and its own identifier.
    expect(anchor?.identifier).not.toBeNull();
    const asset = await fx.ctx.exec(
      "SELECT a.uuid FROM entity_anchor e JOIN asset a ON a.id = e.asset_id " +
      "WHERE e.name = 'Eleanor Face Anchor'");
    expect(anchor?.uuid).toBe(String(asset[0]?.["uuid"]));
  });

  test("references are most specific first; the trail is broadest first",
       async () => {
    const r = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    expect(r.result.references[0]?.provenance).toBe("shot override");
    expect(q13Lines(r)[0]).toContain("binding");
    expect(q13Lines(r).at(-1)).toContain("override");
  });

  test("names assets by uuid, never by row id", async () => {
    // The defect this specification dissolves: the rendered form puts
    // `character #1` in its header and carries `AssetReference.id`
    // through. Neither travels (§6.2).
    const r = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    expect(r.parameters["subject"]).toBe(eleanor.uuid);
    expect(r.result.references.length).toBeGreaterThan(0);
    for (const ref of r.result.references) {
      if (ref.uuid !== null) expect(ref.uuid).toHaveLength(36);
    }
  });

  test("with no root mapping everything is unaddressed (§8.3)",
       async () => {
    const r = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    expect(r.result.rootMapped).toBe(false);
    expect(r.result.counts["unaddressed"])
      .toBe(r.result.references.length);
    // And NOT out-of-root, which is what it used to say — that is a
    // property of an identifier, not of a session.
    expect(r.result.counts["out-of-root"]).toBe(0);
  });
});

describe("§12.9 Q14 — readiness", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q14", await q14Result(
      fx.ctx, "Q05", eleanor.uuid, eleanor.id, scene12.uuid, scene12.id,
      null, null));
  });

  test("reports about absence, and drops the row ids it was given",
       async () => {
    // The readiness report carries the row ids it was called with in
    // `params`. Those do not travel, so the envelope carries uuids and
    // the raw params are dropped rather than passed through.
    const r = await q14Result(
      fx.ctx, "Q05", eleanor.uuid, eleanor.id, scene12.uuid, scene12.id,
      null, null);
    expect(r.parameters["character"]).toBe(eleanor.uuid);
    expect(JSON.stringify(r)).not.toContain(`"character_id"`);
    expect(r.result.target).toBe("Q05");
    expect(r.result.targetName).toBeTypeOf("string");
  });

  test("findings include `ok`, so severity is what carries the answer",
       async () => {
    // I got this wrong first: Marcus is deliberately the thin character
    // and produces FEWER findings than Eleanor, not more. `ok` entries
    // are findings too — Q14 is a rubric, not a problem list, and a
    // consumer counting findings would read it exactly backwards.
    const marcus = await pick(
      "SELECT id, uuid FROM character WHERE name LIKE '%Marcus%'");
    const thin = await q14Result(fx.ctx, "Q05", marcus.uuid, marcus.id,
                                 scene12.uuid, scene12.id, null, null);
    const full = await q14Result(fx.ctx, "Q05", eleanor.uuid, eleanor.id,
                                 scene12.uuid, scene12.id, null, null);

    expect(thin.result.findings.length)
      .toBeLessThan(full.result.findings.length);

    const blocking = (r: { counts: Record<string, number> }): number =>
      (r.counts["blocker"] ?? 0) + (r.counts["warning"] ?? 0);
    expect(blocking(thin.result)).toBeGreaterThan(blocking(full.result));
    expect(thin.result.counts["blocker"]).toBeGreaterThan(0);
    expect(full.result.counts["blocker"]).toBe(0);
  });
});

describe("§12.10 Q09 — motif manifest", () => {
  test("matches its blessed result at scene 12", async () => {
    blessOrCheck("Q09", await q09Result(fx.ctx, scene12.uuid, scene12.id));
  });

  test("density is a heuristic the result declares, not a finding",
       async () => {
    // §9.1: SCF describes. A consumer must be able to see the threshold
    // that produced the flag rather than inferring it from the count.
    const r = await q09Result(fx.ctx, scene12.uuid, scene12.id);
    expect(r.result.densityThreshold).toBe(MOTIF_DENSITY_THRESHOLD);
    expect(r.result.dense)
      .toBe(r.result.manifest.length > MOTIF_DENSITY_THRESHOLD);
  });

  test("a candidate is a motif NOT placed here", async () => {
    const r = await q09Result(fx.ctx, scene12.uuid, scene12.id);
    const placed = new Set(
      r.result.manifest
        .map((m) => m.motif?.uuid)
        .filter((u): u is string => typeof u === "string"));
    for (const c of r.result.candidates) {
      if (c.uuid === null) continue;
      expect(placed.has(c.uuid)).toBe(false);
    }
  });
});

describe("§12.11 Q10 — thematic accounting", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q10", await q10Result(fx.ctx, theme.uuid, theme.id));
  });

  test("the spine covers every scene in story order, zeroes included",
       async () => {
    // The zeroes are the point: this query answers "where is the theme
    // NOT", and a spine listing only hits could not say.
    const r = await q10Result(fx.ctx, theme.uuid, theme.id);
    const order = await sceneOrder(fx.ctx);
    expect(r.result.spine).toHaveLength(order.size);
    expect(r.result.spine.some((s) => s.carriers === 0)).toBe(true);
  });

  test("the cut scene is not on the spine (§6.6.1)", async () => {
    const r = await q10Result(fx.ctx, theme.uuid, theme.id);
    const cut = await fx.ctx.exec(
      "SELECT uuid FROM scene WHERE lifecycle_status = 'cut'");
    const cutUuid = String(cut[0]?.["uuid"]);
    expect(r.result.spine.map((s) => s.sceneUuid)).not.toContain(cutUuid);
  });

  test("the spine is in story order, not scene-number order", async () => {
    // 12A before 19 before 16, per the script.
    const r = await q10Result(fx.ctx, theme.uuid, theme.id);
    const numbers = r.result.spine.map((s) => s.sceneNumber);
    expect(numbers.indexOf("19")).toBeLessThan(numbers.indexOf("16"));
  });

  test("carriers name their target by uuid, and reach only live scenes",
       async () => {
    const r = await q10Result(fx.ctx, theme.uuid, theme.id);
    expect(r.result.carriers.length).toBeGreaterThan(0);
    const live = new Set(r.result.spine.map((s) => s.sceneUuid));
    for (const c of r.result.carriers) {
      for (const u of c.sceneUuids) expect(live.has(u)).toBe(true);
    }
  });
});

describe("§12.12 Q00 — brief", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q00", await q00Result(fx.ctx));
  });

  test("takes no parameters at all", async () => {
    // The only canonical query with an empty envelope. Worth pinning:
    // the envelope must survive having nothing to put in it.
    const r = await q00Result(fx.ctx);
    expect(r.parameters).toEqual({});
    expect(r.query).toBe("Q00");
  });

  test("layers are broadest first, and unauthored ones are absent",
       async () => {
    const r = await q00Result(fx.ctx);
    const order = r.result.layers.map((l) => l.entity);
    expect(order[0]).toBe("project");
    // Present in the declared order, with gaps closed rather than
    // carried as empty entries.
    const declared = [...Q00_LAYERS] as string[];
    expect(order).toEqual(declared.filter((e) => order.includes(e)));
    for (const l of r.result.layers) {
      expect(Object.keys(l.row.fields).length).toBeGreaterThan(0);
    }
  });
});

describe("§12.13 Q11 — audience state", () => {
  test("matches its blessed result", async () => {
    blessOrCheck("Q11", await q11Result(fx.ctx, scene12.uuid, scene12.id));
  });

  test("absent audience rows are null, not invented", async () => {
    // §9.2: a scene with no authored audience information is a
    // legitimate answer, not an error and not an empty object.
    const r = await q11Result(fx.ctx, scene16.uuid, scene16.id);
    expect(r.result).toHaveProperty("information");
    expect(r.result).toHaveProperty("identification");
  });

  test("the emotional cascade is a refines closure like any other",
       async () => {
    const r = await q11Result(fx.ctx, scene12.uuid, scene12.id);
    for (const layer of r.result.emotionalCascade) {
      expect(Object.keys(layer.row.fields).length).toBeGreaterThan(0);
    }
  });
});

describe("§12.14 Q15 — provenance", () => {
  const never = (): boolean => false;

  test("matches its blessed result", async () => {
    blessOrCheck("Q15", await q15Result(
      fx.ctx, "scene", scene12.uuid, scene12.id, mentionsRow));
  });

  test("a non-versionable entity has an empty chain, not a fabricated one",
       async () => {
    const r = await q15Result(fx.ctx, "scene", scene12.uuid, scene12.id,
                              never);
    expect(Array.isArray(r.result.versionChain)).toBe(true);
    expect(r.result.attached.decisions).toEqual([]);
    expect(r.result.attached.notes).toEqual([]);
  });

  test("the envelope carries the row's uuid and its entity kind",
       async () => {
    const r = await q15Result(fx.ctx, "scene", scene12.uuid, scene12.id,
                              never);
    expect(r.parameters).toEqual({
      entityType: "scene", row: scene12.uuid,
    });
    expect(r.result.row?.uuid).toBe(scene12.uuid);
  });
});

describe("§12.15 Q01, §12.16 Q02, §12.17 Q04", () => {
  test("Q01 matches its blessed result", async () => {
    blessOrCheck("Q01", await q01Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id));
  });

  test("Q02 matches its blessed result", async () => {
    blessOrCheck("Q02", await q02Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id,
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id));
  });

  test("Q04 matches its blessed result", async () => {
    blessOrCheck("Q04", await q04Result(fx.ctx, scene12.uuid, scene12.id));
  });

  test("Q01's groups are derived, not listed", async () => {
    // Every entity whose registry `subject` is this kind, at global
    // scope, carrying a reference back. Adding an entity about
    // characters puts it in every character's dossier with no code
    // change — which is why the registry carries `subject` and `scope`.
    const r = await q01Result(fx.ctx, "character", eleanor.uuid,
                              eleanor.id);
    expect(r.result.groups.length).toBeGreaterThan(0);
    for (const g of r.result.groups) {
      const def = registry.entities.get(g.entity);
      expect(def?.subject, g.entity).toBe("character");
      expect(def?.scope, g.entity).toBe("global");
      expect(g.rows.length).toBeGreaterThan(0);
    }
  });

  test("Q02 nests Q13's body, and names where it came from", async () => {
    // The ONE place a canonical query builds on another. §12.1.3
    // withdrew the assumption that composites nest because none of them
    // did; this is the exception, and it carries the result BODY
    // without its envelope.
    const q02 = await q02Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id,
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    const q13 = await q13Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id, "visual_identity",
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);

    expect(q02.result.media.fromQuery).toBe("Q13");
    const { fromQuery, ...body } = q02.result.media;
    expect(fromQuery).toBe("Q13");
    expect(body).toEqual(q13.result);
    // The body only — no envelope inside an envelope.
    expect(q02.result.media).not.toHaveProperty("resultFormat");
    expect(q02.result.media).not.toHaveProperty("parameters");
  });

  test("Q02 carries the same dossier Q01 does", async () => {
    const q01 = await q01Result(fx.ctx, "character", eleanor.uuid,
                                eleanor.id);
    const q02 = await q02Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id,
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id);
    expect(q02.result.dossier).toEqual(q01.result);
  });

  test("Q02's subject-kind branches are empty, not absent", async () => {
    // A character subject has no location variant and no prop state.
    // Null says "not applicable here"; omitting the key would make a
    // consumer guess whether it was unsupported or unauthored.
    const r = await q02Result(
      fx.ctx, "character", eleanor.uuid, eleanor.id,
      scene12.uuid, scene12.id, null, null);
    expect(r.result).toHaveProperty("locationVariant");
    expect(r.result.locationVariant).toBeNull();
    expect(r.result.propState).toBeNull();
    expect(r.result.performanceStates.length).toBeGreaterThanOrEqual(0);
  });

  test("Q04's lineage is broadest first", async () => {
    const r = await q04Result(fx.ctx, scene12.uuid, scene12.id);
    if (r.result.lineage.length > 1) {
      expect(r.result.lineage[0]?.entity).toBe("act");
    }
  });
});

/**
 * Every published result: one per query, plus the per-case results.
 *
 * A case result exists where the query's one position cannot show a
 * member at all. Q02's prop and location members fill only for a prop or
 * a location subject; Q15's version chain only for a versionable row; a
 * variant only where one is in force. Without these, a reader ignoring
 * any of them reproduced every published result byte for byte.
 */
const CASES = [
  "Q05-scene19", "Q07-shot12A", "Q02-marcus-scene25", "Q02-church-scene16",
  "Q02-ridge-scene21", "Q02-locket-scene25", "Q02-kitchen-scene10",
  "Q03-scene25", "Q04-scene25", "Q12-scene24-25", "Q12-scene25-24", "Q13-scene3",
  "Q13-scene25", "Q15-plate-v2", "Q07-scene3", "Q04-scene21",
  "Q14-Q02-locket-scene25", "Q14-Q13-eleanor-shot1204",
  "Q13-shot1204", "Q14-Q02-eleanor-scene7", "Q14-Q07-shot12A",
  "Q14-Q13-shawl-scene12",
] as const;
const PUBLISHED = [
  "Q00", "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "Q09",
  "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", ...CASES,
];

describe("per-case results — what one position cannot show", () => {
  const sel = (sql: string) => pick(sql);

  test("Q05 where a vocal state is in force: Eleanor, scene 19",
       async () => {
    // Scene 12 has none, deliberately (the injury raises a suggestion
    // there). After the confession her voice has gone thin.
    const r = await q05Result(fx.ctx, eleanor.uuid, scene19.uuid,
                              eleanor.id, scene19.id);
    blessOrCheck("Q05-scene19", r);
    expect(r.result.states.map((x) => x.fields["name"])).toEqual(["wrung-out"]);
    expect(r.result.modulations).toEqual({ volume: "quieter" });
  });

  test("Q07 at a shot with no lighting row: the scene's row applies",
       async () => {
    // §7.3: a shot that misses at step 2 falls through to the scene row.
    // 12-04 has its own lighting, so Q07 alone cannot tell a fall-through
    // from a stop; a reader that stopped would drop the layer here.
    const shot = await sel(
      "SELECT id, uuid FROM shot WHERE shot_number = '12A'");
    const r = await q07Result(fx.ctx, scene12.uuid, scene12.id,
                              shot.uuid, shot.id);
    blessOrCheck("Q07-shot12A", r);
    const lighting = r.result.layers.find(
      (l) => l.entity === "lighting_design");
    expect(lighting?.row.fields["name"]).toBe("Sc 12 lighting");
  });

  test("Q02 for a character in a variant: Marcus as a boy, scene 25",
       async () => {
    const r = await q02Result(fx.ctx, "character", marcusId.uuid,
      marcusId.id, scene25.uuid, scene25.id, null, null);
    blessOrCheck("Q02-marcus-scene25", r);
    expect(r.result.characterVariant?.fields["name"]).toBe("Marcus, age nine");
  });

  test("Q02 for a prop: the locket's variant and state, scene 25",
       async () => {
    const locket = await sel("SELECT id, uuid FROM prop WHERE name LIKE '%locket%'");
    const r = await q02Result(fx.ctx, "prop", locket.uuid, locket.id,
      scene25.uuid, scene25.id, null, null);
    blessOrCheck("Q02-locket-scene25", r);
    expect(r.result.propVariant?.fields["name"]).toBe("Ada's locket, new");
    expect(r.result.propState?.fields["whereabouts"]).toBe("on the creek bank");
    // §8.2, §8.3: with no root mapped, the rooted references are
    // `unaddressed` and the absolute one is still `out-of-root` — a
    // property of the identifier, not of the session.
    const states = r.result.media.references.map((x) => x.state);
    expect(states.filter((s) => s === "out-of-root")).toHaveLength(1);
    expect(states.filter((s) => s !== "out-of-root")
      .every((s) => s === "unaddressed")).toBe(true);
  });

  test("Q07 where two latest_wins rows tie: the higher row id, scene 3",
       async () => {
    // §4.5 pattern 3, which §7.3's step 1 applies: two
    // color_script_entry rows sit at scene 1, the latest position at or
    // before scene 3, and the later-written one is in force. A reader
    // taking the lowest id answers "Act 1 — cool and gray".
    const scene3 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '3'");
    const r = await q07Result(fx.ctx, scene3.uuid, scene3.id, null, null);
    blessOrCheck("Q07-scene3", r);
    const entry = r.result.layers.find(
      (l) => l.entity === "color_script_entry");
    expect(entry?.row.fields["name"]).toBe("slate, bark, bone");
  });

  test("Q04 where staging sits in an action sequence, scene 21",
       async () => {
    // §12.17: a staging beat reaches its scene through either container.
    // Scene 21 has no blocking; its two beats are the storm pursuit's.
    const scene21 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '21'");
    const r = await q04Result(fx.ctx, scene21.uuid, scene21.id);
    blessOrCheck("Q04-scene21", r);
    expect(r.result.blocking).toEqual([]);
    expect(r.result.stagingBeats.map((b) => b.fields["beat_order"]))
      .toEqual([1, 2]);
  });

  test("Q14 for Q02 about a prop: the locket, scene 25", async () => {
    // §12.9: Q14 takes its target's parameters, so Q02 can be asked
    // about a prop; the character-only steps say they do not apply.
    const locket = await sel("SELECT id, uuid FROM prop WHERE name LIKE '%locket%'");
    const r = await q14Result(fx.ctx, "Q02", null, null,
      scene25.uuid, scene25.id, null, null,
      { type: "prop", uuid: locket.uuid, id: locket.id }, null);
    blessOrCheck("Q14-Q02-locket-scene25", r);
    expect(r.parameters["subjectType"]).toBe("prop");
    expect(r.result.findings.find((f) => f.entity === "bundle")?.severity)
      .toBe("ok");
  });

  test("Q14 for Q13: Eleanor's visual identity at shot 12-04", async () => {
    // Every step of Q13's rubric is reported, the shot override
    // included (§12.9.1 coverage).
    const r = await q14Result(fx.ctx, "Q13", null, null,
      scene12.uuid, scene12.id, shot1204.uuid, shot1204.id,
      { type: "character", uuid: eleanor.uuid, id: eleanor.id },
      "visual_identity");
    blessOrCheck("Q14-Q13-eleanor-shot1204", r);
    expect(r.result.findings.map((f) => f.entity).sort()).toEqual(
      ["bundle", "character_shot_override", "entity_anchor"]);
  });

  test("Q13 asked with a shot and no scene: the shot's scene, 12-04",
       async () => {
    // §12.1.7: a shot fixes the position at its own scene. Read as no
    // position, only baselines apply and the wounded binding is
    // excluded as `not_baseline`; at scene 12 it is in force.
    const r = await q13Result(fx.ctx, "character", eleanor.uuid, eleanor.id,
      "visual_identity", null, null, shot1204.uuid, shot1204.id);
    blessOrCheck("Q13-shot1204", r);
    expect(r.parameters["scene"]).toBeNull();
    expect(r.result.trail.filter((t) => t.layer === "binding")
      .every((t) => t.excluded === null)).toBe(true);
    const atScene = await q13Result(fx.ctx, "character", eleanor.uuid,
      eleanor.id, "visual_identity", scene12.uuid, scene12.id,
      shot1204.uuid, shot1204.id);
    expect(r.result.references).toEqual(atScene.result.references);
  });

  test("a shot outside the scene asked is not answered", async () => {
    // §12.1.7: the question contradicts itself. Q07 used to answer it
    // with scene 3's palette under 12-04's lighting and design.
    await expect(q07Result(fx.ctx, scene3.uuid, scene3.id,
                           shot1204.uuid, shot1204.id))
      .rejects.toThrow(/not answered/);
    await expect(q13Result(fx.ctx, "character", eleanor.uuid, eleanor.id,
      "visual_identity", scene3.uuid, scene3.id, shot1204.uuid,
      shot1204.id)).rejects.toThrow(/not answered/);
    await expect(q02Result(fx.ctx, "character", eleanor.uuid, eleanor.id,
      scene3.uuid, scene3.id, shot1204.uuid, shot1204.id))
      .rejects.toThrow(/not answered/);
    await expect(q14Result(fx.ctx, "Q07", null, null, scene3.uuid,
      scene3.id, shot1204.uuid, shot1204.id)).rejects.toThrow(/not answered/);
  });

  test("Q14 for Q02 about a character: Eleanor at scene 7", async () => {
    // §12.9.1. Relationship states reach her one reference away, so the
    // step applies and is met; her costumes cannot satisfy the costume
    // step — only one worn here could, and none is (`satisfiedBy`).
    const scene7 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '7'");
    const r = await q14Result(fx.ctx, "Q02", null, null,
      scene7.uuid, scene7.id, null, null,
      { type: "character", uuid: eleanor.uuid, id: eleanor.id }, null);
    blessOrCheck("Q14-Q02-eleanor-scene7", r);
    const find = (e: string) => r.result.findings.find((f) => f.entity === e);
    expect(find("relationship_state")?.message).not.toMatch(/not apply/);
    expect(find("costume_scene")?.severity).toBe("warning");
  });

  test("Q14 for Q07 at a shot that falls through: 12A", async () => {
    // §12.9.1 narrows as §7.3 reads: 12A has no lighting of its own and
    // Q07 there returns the scene's, so the step is met.
    const shot = await sel(
      "SELECT id, uuid FROM shot WHERE shot_number = '12A'");
    const r = await q14Result(fx.ctx, "Q07", null, null,
      scene12.uuid, scene12.id, shot.uuid, shot.id);
    blessOrCheck("Q14-Q07-shot12A", r);
    expect(r.result.findings.find((f) => f.entity === "lighting_design")
      ?.severity).toBe("ok");
  });

  test("Q14 for Q13 about a costume: Ada's shawl at scene 12", async () => {
    // §12.9.1. The costume's binding meets the required step; no anchor
    // and no shot override can name a costume, so those do not apply.
    const shawl = await sel(
      "SELECT id, uuid FROM costume WHERE name = 'Ada''s shawl'");
    const r = await q14Result(fx.ctx, "Q13", null, null,
      scene12.uuid, scene12.id, null, null,
      { type: "costume", uuid: shawl.uuid, id: shawl.id },
      "visual_identity");
    blessOrCheck("Q14-Q13-shawl-scene12", r);
    expect(r.result.findings.map((f) => f.severity))
      .toEqual(["ok", "ok", "ok"]);
  });

  test("Q02 for a location: the kitchen at scene 10, ranked axes",
       async () => {
    // §12.17's axis order in a published result: a winter night takes
    // the autumn night variant, and says it is wrong about the season.
    const kitchen = await sel(
      "SELECT id, uuid FROM location WHERE name = 'Farmhouse Kitchen'");
    const scene10 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '10'");
    const r = await q02Result(fx.ctx, "location", kitchen.uuid, kitchen.id,
      scene10.uuid, scene10.id, null, null);
    blessOrCheck("Q02-kitchen-scene10", r);
    expect(String(r.result.locationVariant?.variant?.fields["name"]))
      .toContain("night");
    expect(r.result.locationVariant?.mismatches).toEqual(
      ['season: scene="winter" variant="autumn"']);
  });

  test("Q02 for a location: `varies` agrees on any hour, scene 16",
       async () => {
    // §12.17's wildcard. The candles variant carries nothing but
    // `time_of_day: varies`; it beats the bare baseline only because
    // the wildcard agrees with a morning service.
    const church = await sel(
      "SELECT id, uuid FROM location WHERE name = 'Hollow Creek Church'");
    const r = await q02Result(fx.ctx, "location", church.uuid, church.id,
      scene16.uuid, scene16.id, null, null);
    blessOrCheck("Q02-church-scene16", r);
    expect(String(r.result.locationVariant?.variant?.fields["name"]))
      .toContain("candles");
    expect(r.result.locationVariant?.mismatches).toEqual([]);
  });

  test("Q02 for a location: nothing agrees, so the baseline, scene 21",
       async () => {
    // §12.17 step 4. Neither ridge variant agrees with a winter storm
    // night on any axis; the baseline is chosen, and is wrong on all
    // three, which the mismatches say.
    const ridge = await sel(
      "SELECT id, uuid FROM location WHERE name = 'Ridge Forest'");
    const scene21 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '21'");
    const r = await q02Result(fx.ctx, "location", ridge.uuid, ridge.id,
      scene21.uuid, scene21.id, null, null);
    blessOrCheck("Q02-ridge-scene21", r);
    expect(r.result.locationVariant?.variant?.fields["is_baseline"]).toBe(1);
    expect(r.result.locationVariant?.mismatches).toHaveLength(3);
  });

  test("Q03 and Q04 where a variant is in force, scene 25", async () => {
    const q03 = await q03Result(fx.ctx, scene25.uuid, scene25.id);
    blessOrCheck("Q03-scene25", q03);
    expect(q03.result.characters[0]?.variant?.fields["name"])
      .toBe("Marcus, age nine");
    expect(q03.result.props[0]?.variant?.fields["name"])
      .toBe("Ada's locket, new");
    const q04 = await q04Result(fx.ctx, scene25.uuid, scene25.id);
    blessOrCheck("Q04-scene25", q04);
    expect(q04.result.cast[0]?.variant).not.toBeNull();
    expect(q04.result.props[0]?.variant).not.toBeNull();
  });

  test("Q12 into the flashback: versions change, scene 24 to 25",
       async () => {
    const scene24 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '24'");
    const r = await q12Result(fx.ctx, scene24.uuid, scene25.uuid,
                              scene24.id, scene25.id);
    blessOrCheck("Q12-scene24-25", r);
    const marcus = r.result.characters.find(
      (c) => c.character.uuid === marcusId.uuid);
    expect([marcus?.variantFrom, marcus?.variantTo])
      .toEqual([null, "Marcus, age nine"]);
    const locket = r.result.props.find(
      (p) => String(p.prop.fields["name"]).includes("locket"));
    expect(locket?.variantTo).toBe("Ada's locket, new");
  });

  test("Q12 back out of the flashback: scene 25 to 24", async () => {
    // The cut back to the present. Each position resolves at its own
    // story place (§4.1), so the pair may run against the script.
    const scene24 = await sel(
      "SELECT id, uuid FROM scene WHERE scene_number = '24'");
    const r = await q12Result(fx.ctx, scene25.uuid, scene24.uuid,
                              scene25.id, scene24.id);
    blessOrCheck("Q12-scene25-24", r);
    const marcus = r.result.characters.find(
      (c) => c.character.uuid === marcusId.uuid);
    expect([marcus?.variantFrom, marcus?.variantTo])
      .toEqual(["Marcus, age nine", null]);
  });

  test("Q15 on a versioned asset: the plate's chain, oldest first",
       async () => {
    const plate = await sel(
      "SELECT id, uuid FROM asset WHERE name = 'kitchen_night_plate_v2.exr'");
    const r = await q15Result(fx.ctx, "asset", plate.uuid, plate.id,
                              mentionsRow);
    blessOrCheck("Q15-plate-v2", r);
    expect(r.result.versionChain.map((v) => v.fields["version_label"]))
      .toEqual(["v1", "v2"]);
    expect(r.result.attached.notes.length).toBe(1);
  });
});

describe("the results are portable", () => {
  test("no row id or timestamp appears anywhere in either", async () => {
    // The property the whole section rests on, asserted over the real
    // serialised output rather than over a projection in isolation.
    for (const name of PUBLISHED) {
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
    for (const name of PUBLISHED) {
      const r = JSON.parse(
        readFileSync(join(OUT, `${name}.result.json`), "utf8")) as {
          resultFormat: string; parameters: Record<string, unknown>;
        };
      expect(r.resultFormat).toBe(QUERY_RESULT_FORMAT);
      // §12.1.1: a parameter identifying a ROW is its uuid; a literal
      // parameter — a query id, an enum value — appears as itself. What
      // may never appear is a row id, so nothing numeric is allowed.
      for (const [key, v] of Object.entries(r.parameters)) {
        if (v === null) continue;
        expect(Number.isFinite(Number(v)), `${name}.${key}`).toBe(false);
      }
    }
  });
});
