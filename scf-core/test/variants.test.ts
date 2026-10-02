// SPDX-License-Identifier: Apache-2.0
/**
 * variants.test.ts — the variant in force (spec §4.8, proposal 0033).
 *
 * The fixture's scene 25 is the one flashback: Marcus at the creek as the
 * variant "Marcus, age nine", named by his scene_character link there. It
 * carries a variant-filtered binding that `replace`s his baseline and a
 * verified anchor for the variant's face. Every normative result sits
 * where no variant is in force, so none of the sixteen can tell an
 * implementation that honours §4.8 from one that ignores it; these tests
 * and the non-normative Q13-scene25 are what can.
 *
 * Two-sided throughout, the shape cutChangesTheAnswer uses: each rule
 * holds where it should AND fails to hold where it should not. A copy of
 * the fixture is mutated wherever a case needs a row it does not carry.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { q02Result } from "../src/canonicalQueries.ts";
import { collectFindings } from "../src/findings.ts";
import { openNodeDatabase } from "../src/node.ts";
import {
  resolveMedia, variantInForce, type ScfContext,
} from "../src/resolution.ts";
import { FIXTURE_PATH, openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
let sandbox: string;
const id: Record<string, number> = {};
const uuid: Record<string, string> = {};

beforeAll(async () => {
  fx = openFixture();
  sandbox = mkdtempSync(join(tmpdir(), "scf-variants-"));
  for (const [key, sql] of Object.entries({
    eleanor: "SELECT id, uuid FROM character WHERE name LIKE '%Eleanor%'",
    marcus: "SELECT id, uuid FROM character WHERE name LIKE '%Marcus%'",
    boy: "SELECT id, uuid FROM character_variant WHERE name = 'Marcus, age nine'",
    chime: "SELECT id, uuid FROM prop WHERE name LIKE '%chime%'",
    scene25: "SELECT id, uuid FROM scene WHERE scene_number = '25'",
    scene9: "SELECT id, uuid FROM scene WHERE scene_number = '9'",
    scene24: "SELECT id, uuid FROM scene WHERE scene_number = '24'",
  })) {
    const r = (await fx.ctx.exec(sql))[0];
    if (r === undefined) throw new Error(`fixture selector failed: ${sql}`);
    id[key] = Number(r["id"]);
    uuid[key] = String(r["uuid"]);
  }
});
afterAll(() => {
  fx.close();
  rmSync(sandbox, { recursive: true, force: true });
});

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

const n = (k: string): number => id[k] as number;
const names = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r["name"]));

describe("§4.8 — the variant in force", () => {
  test("a character's is the one its scene link names", async () => {
    const v = await variantInForce(fx.ctx, "character", n("marcus"),
                                   n("scene25"));
    expect(v?.["name"]).toBe("Marcus, age nine");
  });

  test("…and nowhere else, nor with no position", async () => {
    // Scene 9 links Marcus with no variant; scene 25 does not link
    // Eleanor at all; no position puts no variant in force for anyone.
    expect(await variantInForce(fx.ctx, "character", n("marcus"),
                                n("scene9"))).toBeNull();
    expect(await variantInForce(fx.ctx, "character", n("eleanor"),
                                n("scene25"))).toBeNull();
    expect(await variantInForce(fx.ctx, "character", n("marcus"),
                                null)).toBeNull();
  });

  test("a location's is §12.17's, and only for that location", async () => {
    const creek = (await fx.ctx.exec(
      "SELECT location_id FROM scene WHERE id = ?", [n("scene25")]))[0];
    const creekId = Number(creek?.["location_id"]);
    const v = await variantInForce(fx.ctx, "location", creekId,
                                   n("scene25"));
    expect(v?.["name"]).toBe("Creek — summer, low water");
    // Scene 24 is on the porch: no variant of the creek is in force.
    expect(await variantInForce(fx.ctx, "location", creekId,
                                n("scene24"))).toBeNull();
  });

  test("a variant of another subject puts none in force, and is reported",
       async () => {
    await withCopy("foreign", async (ctx) => {
      const before = (await collectFindings(ctx.exec, ctx.registry))
        .findings.filter((f) => f.code === "presence.variant_foreign");
      expect(before).toEqual([]);
      // Eleanor's link at scene 9 names Marcus's variant.
      await ctx.exec(
        "UPDATE scene_character SET variant_id = ? " +
        "WHERE scene_id = ? AND character_id = ?",
        [n("boy"), n("scene9"), n("eleanor")]);
      expect(await variantInForce(ctx, "character", n("eleanor"),
                                  n("scene9"))).toBeNull();
      const after = (await collectFindings(ctx.exec, ctx.registry))
        .findings.filter((f) => f.code === "presence.variant_foreign");
      expect(after).toHaveLength(1);
    });
  });

  test("the variant qualifies the link and is not part of its key (§6.3)",
       async () => {
    // Marcus-in-scene-25 is one link whichever variant it names. A second
    // row for the same pair that differs only in variant is therefore a
    // duplicate that disagrees — not a second, legitimate link.
    await withCopy("qualifier", async (ctx) => {
      await ctx.exec(
        "INSERT INTO scene_character (uuid, scene_id, character_id, " +
        "role_in_scene) VALUES (?, ?, ?, 'featured')",
        [randomUUID(), n("scene25"), n("marcus")]);
      const codes = (await collectFindings(ctx.exec, ctx.registry))
        .findings.map((f) => f.code);
      expect(codes).toContain("junction.duplicate_key_conflicting");
    });
  });

  test("a cut variant is in force nowhere", async () => {
    await withCopy("cut", async (ctx) => {
      await ctx.exec(
        "UPDATE character_variant SET lifecycle_status = 'cut' WHERE id = ?",
        [n("boy")]);
      expect(await variantInForce(ctx, "character", n("marcus"),
                                  n("scene25"))).toBeNull();
      // Cut is not foreign: §6.6 says what a cut row means already.
      const foreign = (await collectFindings(ctx.exec, ctx.registry))
        .findings.filter((f) => f.code === "presence.variant_foreign");
      expect(foreign).toEqual([]);
    });
  });
});

describe("§12.8.1 — the variant filter on a binding", () => {
  test("applies where the variant is in force, excluded with its reason " +
       "elsewhere", async () => {
    const at25 = await resolveMedia(fx.ctx, "character", n("marcus"),
                                    "visual_identity", n("scene25"));
    expect(at25.trail).toContain(
      "binding Marcus as a boy -> bundle Marcus Age Nine Visual");
    const at9 = await resolveMedia(fx.ctx, "character", n("marcus"),
                                   "visual_identity", n("scene9"));
    expect(at9.trail).toContain(
      "binding Marcus as a boy -> bundle Marcus Age Nine Visual: " +
      "EXCLUDED, variant filter, no variant in force here");
    expect(names(at9.assets_most_specific_first))
      .not.toContain("marcus_age9_ref.png");
  });

  test("a prop's works the same way", async () => {
    await withCopy("prop", async (ctx) => {
      const variant = await ctx.exec(
        "INSERT INTO prop_variant (uuid, name, prop_id) VALUES (?, ?, ?) " +
        "RETURNING id", [randomUUID(), "Chime, bent", n("chime")]);
      const variantId = Number(variant[0]?.["id"]);
      const bundle = await ctx.exec(
        "INSERT INTO bundle (uuid, name, intent) VALUES (?, ?, ?) " +
        "RETURNING id", [randomUUID(), "Bent chime", "visual_identity"]);
      await ctx.exec(
        "INSERT INTO prop_asset_binding (uuid, name, prop_id, bundle_id, " +
        "is_baseline, precedence, variant_id) VALUES (?, ?, ?, ?, 0, 5, ?)",
        [randomUUID(), "Bent", n("chime"), Number(bundle[0]?.["id"]),
         variantId]);
      const line = async (): Promise<string | undefined> =>
        (await resolveMedia(ctx, "prop", n("chime"), "visual_identity",
                            n("scene24")))
          .trail.find((l) => l.startsWith("binding Bent -> "));
      expect(await line()).toMatch(/EXCLUDED, variant filter/);
      // Name the variant at scene 24 — linking the chime there if the
      // fixture does not — and the binding applies.
      await ctx.exec(
        "INSERT INTO scene_prop (uuid, scene_id, prop_id) " +
        "SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM scene_prop " +
        "WHERE scene_id = ? AND prop_id = ?)",
        [randomUUID(), n("scene24"), n("chime"), n("scene24"), n("chime")]);
      await ctx.exec(
        "UPDATE scene_prop SET variant_id = ? WHERE scene_id = ? " +
        "AND prop_id = ?", [variantId, n("scene24"), n("chime")]);
      expect(await line()).toBe("binding Bent -> bundle Bent chime");
    });
  });
});

describe("§12.8 — anchors honour subject_variant_id", () => {
  test("a variant's anchor contributes only where it is in force",
       async () => {
    const at25 = await resolveMedia(fx.ctx, "character", n("marcus"),
                                    "visual_identity", n("scene25"));
    expect(names(at25.anchors)).toEqual(["Young Marcus Face"]);
    for (const scene of [n("scene9"), null]) {
      const m = await resolveMedia(fx.ctx, "character", n("marcus"),
                                   "visual_identity", scene);
      expect(names(m.anchors)).not.toContain("Young Marcus Face");
      expect(m.trail).toContain(
        "anchor Young Marcus Face: EXCLUDED, its variant is not in force " +
        "here");
    }
  });

  test("…and there it displaces the subject's own anchor of that type",
       async () => {
    // Marcus's own face anchor is a candidate in the fixture, so it never
    // reaches the cascade at all. Verify it on a copy: then it is his
    // face everywhere EXCEPT where the variant's face takes over.
    await withCopy("displace", async (ctx) => {
      await ctx.exec(
        "UPDATE entity_anchor SET canonical_status = 'verified' " +
        "WHERE name = 'Marcus Face Anchor'");
      const at9 = await resolveMedia(ctx, "character", n("marcus"),
                                     "visual_identity", n("scene9"));
      expect(names(at9.anchors)).toEqual(["Marcus Face Anchor"]);
      const at25 = await resolveMedia(ctx, "character", n("marcus"),
                                      "visual_identity", n("scene25"));
      expect(names(at25.anchors)).toEqual(["Young Marcus Face"]);
      expect(at25.trail).toContain(
        "anchor Marcus Face Anchor: EXCLUDED, displaced by variant " +
        "\"Marcus, age nine\"");
    });
  });

  test("a variant with no anchor of the type leaves the subject's own",
       async () => {
    await withCopy("no-displace", async (ctx) => {
      await ctx.exec(
        "UPDATE entity_anchor SET canonical_status = 'verified' " +
        "WHERE name = 'Marcus Face Anchor'");
      await ctx.exec(
        "UPDATE entity_anchor SET anchor_type = 'motion' " +
        "WHERE name = 'Young Marcus Face'");
      const at25 = await resolveMedia(ctx, "character", n("marcus"),
                                      "visual_identity", n("scene25"));
      expect(names(at25.anchors)).toEqual(["Marcus Face Anchor"]);
    });
  });
});

describe("§12.16 — Q02 reports the variant", () => {
  test("characterVariant at scene 25, null for the other kinds' members",
       async () => {
    const r = await q02Result(fx.ctx, "character", uuid["marcus"] as string,
                              n("marcus"), uuid["scene25"] as string,
                              n("scene25"), null, null);
    expect(r.result.characterVariant?.["uuid"]).toBe(uuid["boy"]);
    expect(r.result.propVariant).toBeNull();
    const away = await q02Result(fx.ctx, "character",
                                 uuid["marcus"] as string, n("marcus"),
                                 uuid["scene9"] as string, n("scene9"),
                                 null, null);
    expect(away.result.characterVariant).toBeNull();
  });
});
