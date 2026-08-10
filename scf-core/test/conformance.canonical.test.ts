/**
 * conformance.canonical.test.ts — the executable statement of SCF's
 * resolution semantics, run against the checked-in Hollow Creek fixture.
 *
 * Began as an assertion-for-assertion port of the v1 Python suite, which
 * was the correctness gate while two implementations existed. With v1
 * retired this suite IS the gate: every assertion here encodes a rule
 * from docs/conventions.md, and the fixture is built to exercise it.
 * Changing an assertion means changing the format — do it in the
 * conventions document first.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openFixture, str, type Fixture } from "./setup.ts";
import {
  motifStateAt, propStateAt, relationshipStateAt, resolveDescription,
  resolveDirection, resolveMedia, sceneOrder, selectLocationVariant,
  statesInForce, type SceneOrder,
} from "../src/resolution.ts";

let fx: Fixture;
let eleanor: number;
let marcus: number;
let sc: Record<number, number>;
let shot1204: number;
let order: SceneOrder;

beforeAll(async () => {
  fx = openFixture();
  eleanor = await fx.oneId("character", "Eleanor");
  marcus = await fx.oneId("character", "Marcus");
  sc = {};
  for (const n of [1, 3, 9, 10, 11, 12, 19, 21, 24]) {
    sc[n] = await fx.sceneByNumber(n);
  }
  shot1204 = await fx.oneId("shot", "12-04");
  order = await sceneOrder(fx.ctx);
});

afterAll(() => fx.close());

const pos = (sceneId: number): number => order.get(sceneId) ?? -1;

describe("scene ordering", () => {
  test("follows scene_number", () => {
    expect(pos(sc[9]!)).toBeLessThan(pos(sc[12]!));
    expect(pos(sc[12]!)).toBeLessThan(pos(sc[19]!));
  });
});

describe("persistence rule (conventions.md)", () => {
  test("injury (until_resolved) persists to sc 12", async () => {
    const phys12 = await statesInForce(fx.ctx, eleanor, sc[12]!, "physical",
                                       order);
    expect(phys12.map((s) => s["name"])).toEqual(["wounded"]);
  });
  test("hoarseness (scene_only) expired by sc 12", async () => {
    const voc12 = await statesInForce(fx.ctx, eleanor, sc[12]!, "vocal",
                                      order);
    expect(voc12).toEqual([]);
  });
  test("hoarseness in force at its own scene", async () => {
    const voc9 = await statesInForce(fx.ctx, eleanor, sc[9]!, "vocal",
                                     order);
    expect(voc9).toHaveLength(1);
  });
});

describe("Q05: voice direction for 'You came back.'", () => {
  test("baseline profile, fallback, and the line's beat", async () => {
    const q05 = await resolveDescription(fx.ctx, eleanor, sc[12]!, "vocal");
    expect(q05.profile).not.toBeNull();
    expect(q05.profile!["timbre"]).toBe("warm");
    expect(q05.states).toEqual([]);
    expect(q05.modulations).toEqual({});
    const line = q05.beats.find(
      (b) => b["line_text"] === "You came back.");
    expect(line).toBeDefined();
    expect(JSON.parse(str(line!["emphasis_words"]))).toEqual(["back"]);
    expect(line!["pace"]).toBe("slow");
    expect(line!["volume"]).toBe("soft");
  });
});

describe("Q06: physical direction", () => {
  test("injury modulation in force + kettle beat", async () => {
    const q06 = await resolveDescription(fx.ctx, eleanor, sc[12]!,
                                         "physical");
    expect(q06.modulations["tension"]).toBe("guarding left side");
    expect(q06.beats.some(
      (b) => str(b["physical_action"]).includes("kettle"))).toBe(true);
  });
  test("facial: guilt flicker, subtle", async () => {
    const q06f = await resolveDescription(fx.ctx, marcus, sc[12]!, "facial");
    expect(q06f.beats.some((b) => b["visibility"] === "subtle")).toBe(true);
  });
});

describe("Q07: look resolution, direction cascade", () => {
  test("leaf last, color chain root-first, shot lighting wins", async () => {
    const q07 = await resolveDirection(fx.ctx, "shot_design", sc[12]!,
                                       shot1204);
    const names = q07.map(([n]) => n);
    expect(names[names.length - 1]).toBe("shot_design");
    expect(names.indexOf("project_color_palette"))
      .toBeLessThan(names.indexOf("color_script"));
    expect(names.indexOf("color_script"))
      .toBeLessThan(names.indexOf("scene_color_palette"));
    const layers = new Map(q07);
    const lighting = layers.get("lighting_design");
    expect(lighting).toBeDefined();
    expect(lighting!["shot_id"]).toBe(shot1204);
    expect(layers.get("scene_color_palette")!["focal_color"])
      .toBe("hearth amber");
  });
});

describe("Q08: soundscape", () => {
  test("chain, tacet most specific, silence philosophy root", async () => {
    const q08 = await resolveDirection(fx.ctx, "scene_music_design",
                                       sc[12]!);
    expect(q08.map(([n]) => n))
      .toEqual(["sonic_identity", "scene_music_design"]);
    const layers = new Map(q08);
    expect(layers.get("scene_music_design")!["music_presence"]).toBe("none");
    expect(str(layers.get("sonic_identity")!["silence_philosophy"])
      .startsWith("Silence")).toBe(true);
  });
  test("chime cue present", async () => {
    const cues = await fx.ctx.exec(
      "SELECT * FROM sound_cue WHERE scene_id=?", [sc[12]!]);
    expect(cues).toHaveLength(1);
    expect(str(cues[0]!["description"]).toLowerCase()).toContain("chime");
  });
});

describe("Q09: motif manifest", () => {
  test("sc12 manifest; locket dormant at 12, manifests at 19", async () => {
    const m12 = await fx.ctx.exec(
      "SELECT m.name, a.domain FROM motif_appearance a " +
      "JOIN motif m ON m.id=a.motif_id WHERE a.scene_id=?", [sc[12]!]);
    expect(new Set(m12.map((r) => r["name"]))).toEqual(
      new Set(["Open doors", "Wind chime", "Unfinished sentences"]));
    expect(m12.some((r) => str(r["name"]).toLowerCase().includes("locket")))
      .toBe(false);
    const m19 = await fx.ctx.exec(
      "SELECT m.name FROM motif_appearance a " +
      "JOIN motif m ON m.id=a.motif_id WHERE a.scene_id=?", [sc[19]!]);
    expect(m19.some((r) => str(r["name"]).toLowerCase().includes("locket")))
      .toBe(true);
  });
  test("chime -> doors cross-modality link", async () => {
    const related = await fx.ctx.exec(
      "SELECT related_motif_id FROM motif WHERE name='Wind chime'");
    expect(related[0]!["related_motif_id"])
      .toBe(await fx.oneId("motif", "Open doors"));
  });
});

describe("Q11: audience state", () => {
  test("identification primary, withheld info, emotional cascade",
      async () => {
    const ident = await fx.ctx.exec(
      "SELECT * FROM identification_strategy WHERE scene_id=?", [sc[12]!]);
    expect(ident[0]?.["primary_character_id"]).toBe(eleanor);
    const info = await fx.ctx.exec(
      "SELECT * FROM information_strategy WHERE scene_id=?", [sc[12]!]);
    expect(str(info[0]?.["information_withheld"])).toContain("creek");
    const q11 = await resolveDirection(fx.ctx, "scene_emotional_target",
                                       sc[12]!);
    expect(q11.map(([n]) => n))
      .toEqual(["project_tone", "scene_emotional_target"]);
  });
});

describe("Q12: continuity sc 9 -> sc 12", () => {
  test("state diff and costume in force", async () => {
    const at9 = new Set(
      (await statesInForce(fx.ctx, eleanor, sc[9]!, null, order))
        .map((s) => s["name"]));
    const at12 = new Set(
      (await statesInForce(fx.ctx, eleanor, sc[12]!, null, order))
        .map((s) => s["name"]));
    expect(at9).toEqual(new Set(["wounded", "hoarse"]));
    expect(at12).toEqual(new Set(["wounded"]));
    const shawl12 = await fx.ctx.exec(
      "SELECT c.name FROM costume_scene cs JOIN costume c " +
      "ON c.id=cs.costume_id WHERE cs.scene_id=?", [sc[12]!]);
    expect(new Set(shawl12.map((r) => r["name"])))
      .toEqual(new Set(["Work dress", "Ada's shawl"]));
  });
});

describe("Q13: media resolution", () => {
  test("override most specific first; base bundle; verified anchor",
      async () => {
    const q13 = await resolveMedia(fx.ctx, "character", eleanor,
                                   "visual_identity", sc[12]!, shot1204);
    const firsts = q13.assets_most_specific_first.map((a) => str(a["name"]));
    expect(firsts.length).toBeGreaterThan(0);
    expect(firsts[0]!.startsWith("eleanor_1204")).toBe(true);
    expect(firsts).toContain("eleanor_turnaround_v3.png");
    expect(q13.anchors).toHaveLength(1);
    expect(q13.anchors[0]!["canonical_status"]).toBe("verified");
  });
  test("Marcus voice bundle absent (the readiness blocker)", async () => {
    const q13v = await resolveMedia(fx.ctx, "character", marcus,
                                    "voice_identity", sc[12]!);
    expect(q13v.assets_most_specific_first).toEqual([]);
  });
});

describe("G4: location variant selection", () => {
  test("selects night/storm kitchen variant with no mismatches",
      async () => {
    const [variant, mismatches] = await selectLocationVariant(fx.ctx,
                                                              sc[12]!);
    expect(variant).not.toBeNull();
    expect(str(variant!["name"]).toLowerCase()).toContain("night");
    expect(mismatches).toEqual([]);
  });
});

describe("pattern 3 (latest-wins) state tables — Phase C", () => {
  test("relationship stages at sc9/sc12/sc24", async () => {
    const relRow = await fx.ctx.exec(
      "SELECT id FROM character_relationship ORDER BY id");
    const relId = relRow[0]!["id"] as number;
    const rs12 = await relationshipStateAt(fx.ctx, relId, sc[12]!, order);
    expect(rs12?.["stage_label"]).toBe("post-accident thaw");
    const rs9 = await relationshipStateAt(fx.ctx, relId, sc[9]!, order);
    expect(rs9?.["stage_label"]).toBe("arm's length");
    const rs24 = await relationshipStateAt(fx.ctx, relId, sc[24]!, order);
    expect(rs24?.["stage_label"]).toBe("reconciled");
    // Q12 revisited: machine-verifiable relationship continuity (G1 gap)
    expect(rs9!["stage_label"]).not.toBe(rs12!["stage_label"]);
  });
  test("locket whereabouts across positions", async () => {
    const locketId = await fx.oneId("prop", "locket");
    const ps12 = await propStateAt(fx.ctx, locketId, sc[12]!, order);
    expect(ps12?.["whereabouts"]).toBe("coat pocket");
    const ps19 = await propStateAt(fx.ctx, locketId, sc[19]!, order);
    expect(str(ps19?.["whereabouts"])).toContain("revealed");
    const ps1 = await propStateAt(fx.ctx, locketId, sc[1]!, order);
    expect(ps1?.["whereabouts"]).toBe("saddlebag");
  });
  test("motif state: well-defined absence at sc3, shifted by sc12",
      async () => {
    const doorsId = await fx.oneId("motif", "Open doors");
    expect(await motifStateAt(fx.ctx, doorsId, sc[3]!, order)).toBeNull();
    const ms12 = await motifStateAt(fx.ctx, doorsId, sc[12]!, order);
    expect(ms12?.["subtlety_level"]).toBe("noticeable");
  });
});

describe("Q07 revisited: color_script_entry joins the cascade", () => {
  test("position-keyed layer, latest-wins entry at sc12 and sc1",
      async () => {
    const q07b = await resolveDirection(fx.ctx, "scene_color_palette",
                                        sc[12]!);
    const namesB = q07b.map(([n]) => n);
    expect(namesB).toContain("color_script_entry");
    expect(namesB.indexOf("color_script"))
      .toBeLessThan(namesB.indexOf("color_script_entry"));
    expect(namesB.indexOf("color_script_entry"))
      .toBeLessThan(namesB.indexOf("scene_color_palette"));
    const entry = new Map(q07b).get("color_script_entry");
    expect(entry?.["name"]).toBe("First warmth");
    const q07c = await resolveDirection(fx.ctx, "scene_color_palette",
                                        sc[1]!);
    const entry1 = new Map(q07c).get("color_script_entry");
    expect(entry1?.["temperature"]).toBe("cool");
  });
});

describe("row identity (schema 2.3)", () => {
  test("uuids present, 36 chars, unique across tables", async () => {
    const uuids: string[] = [];
    for (const t of ["character", "scene", "motif", "performance_state",
                     "relationship_state", "bundle", "asset"]) {
      const rows_ = await fx.ctx.exec(`SELECT uuid FROM "${t}"`);
      for (const r of rows_) {
        const u = r["uuid"];
        expect(u, `2.3: ${t} row missing uuid`).not.toBeNull();
        expect(String(u)).toHaveLength(36);
        uuids.push(String(u));
      }
    }
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});

describe("Q03 smoke: subjects present", () => {
  test("cast present at sc 12", async () => {
    const present = await fx.ctx.exec(
      "SELECT character_id FROM scene_character WHERE scene_id=?",
      [sc[12]!]);
    expect(new Set(present.map((r) => r["character_id"])))
      .toEqual(new Set([eleanor, marcus]));
  });
});

/**
 * Fixture invariants the query suites depend on but never state.
 *
 * The canonical tests address scenes BY NUMBER — "sc 12", "sc 9 -> sc
 * 12" — so the fixture's production numbering is load-bearing test data,
 * not decoration. It is gapped (1, 3, 7, 9, 12, 16 …) exactly as a real
 * shooting script is, and renumbering it to 1..11 would silently rewrite
 * every one of those assertions' subject.
 */
describe("fixture invariants", () => {
  test("numbering is fixed, so no commit can renumber it", async () => {
    const rows = await fx.ctx.exec("SELECT scene_numbering FROM project");
    // 'derived' would let the first commit in the app renumber the
    // scenes from script order and destroy the production numbering.
    expect(String(rows[0]?.["scene_numbering"])).toBe("fixed");
  });

  test("the gaps are still there", async () => {
    const rows = await fx.ctx.exec(
      "SELECT scene_number FROM scene ORDER BY scene_number");
    const numbers = rows.map((r) => r["scene_number"]);
    expect(numbers).toEqual([1, 3, 7, 9, 10, 11, 12, 16, 19, 21, 24]);
  });

  test("every scene in the script has a number and a heading", async () => {
    const orphans = await fx.ctx.exec(
      "SELECT id FROM scene WHERE scene_number IS NULL");
    expect(orphans).toHaveLength(0);
    const headings = await fx.ctx.exec(
      "SELECT COUNT(*) AS n FROM screenplay_lines " +
      "WHERE line_type = 'heading' AND scene_id IS NOT NULL");
    const scenes = await fx.ctx.exec("SELECT COUNT(*) AS n FROM scene");
    expect(headings[0]!["n"]).toBe(scenes[0]!["n"]);
  });

  test("every row that carries identity has it", async () => {
    for (const table of ["scene", "character", "location", "prop",
                         "act", "sequence", "screenplay_lines"]) {
      const rows = await fx.ctx.exec(
        `SELECT COUNT(*) AS n FROM "${table}" WHERE uuid IS NULL`);
      expect({ table, missing: rows[0]!["n"] })
        .toEqual({ table, missing: 0 });
    }
  });

  test("stored act and sequence labels match what commit would derive",
       async () => {
    // If these disagreed, opening the fixture and committing would
    // rewrite them — a demo file that edits itself on first use.
    const acts = await fx.ctx.exec(
      "SELECT act_number FROM act ORDER BY act_number");
    expect(acts.map((r) => r["act_number"])).toEqual([1, 2, 3]);
    const seqs = await fx.ctx.exec(
      "SELECT sequence_number, act_id FROM sequence " +
      "ORDER BY sequence_number");
    expect(seqs.map((r) => r["sequence_number"])).toEqual([1, 2, 3, 4, 5]);
    // act_id is maintained at commit now; the fixture already agrees.
    expect(seqs.map((r) => r["act_id"])).toEqual([1, 2, 2, 3, 3]);
  });
});
