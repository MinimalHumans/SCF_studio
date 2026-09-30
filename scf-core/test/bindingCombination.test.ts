// SPDX-License-Identifier: Apache-2.0
/**
 * bindingCombination.test.ts — spec §12.8.2: how several bindings in force
 * for one subject and intent combine.
 *
 * The fixture carries the case that needs a rule. At scene 12, a night
 * storm, the Farmhouse Kitchen has its night reference, its storm build
 * and its day baseline all in force. "Kitchen at night" replaces, so the
 * day baseline is excluded and says why; the storm build ranks above it
 * and still adds. At scene 3 the night binding is filtered out, nothing
 * replaces, and the scene plate and the day baseline both add.
 *
 * Everything that changes a binding is done on a copy of the fixture, as
 * in bindingFilters.test.ts, and checked two-sided: the same binding with
 * and without the condition.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { collectFindings } from "../src/findings.ts";
import { openNodeDatabase } from "../src/node.ts";
import {
  resolveMedia, type ResolvedMedia, type ScfContext,
} from "../src/resolution.ts";
import { FIXTURE_PATH, openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
let sandbox: string;

beforeAll(() => {
  fx = openFixture();
  sandbox = mkdtempSync(join(tmpdir(), "scf-binding-combination-"));
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

const line = (m: ResolvedMedia, binding: string): string => {
  const l = m.trail.find((t) => t.startsWith(`binding ${binding} -> `));
  expect(l, `no trail line for "${binding}":\n${m.trail.join("\n")}`)
    .toBeDefined();
  return l ?? "";
};
const names = (m: ResolvedMedia): string[] =>
  m.base_assets.map((a) => String(a["name"]));

async function kitchenAt(ctx: ScfContext, scene: string) {
  const kitchen = await fx.oneId("location", "Farmhouse Kitchen");
  const sceneId = Number((await ctx.exec(
    "SELECT id FROM scene WHERE scene_number = ?", [scene]))[0]?.["id"]);
  return resolveMedia(ctx, "location", kitchen, "visual_identity", sceneId);
}

describe("§12.8.2 — replace excludes lower precedence, add contributes", () => {
  test("scene 12: the night binding replaces the day baseline", async () => {
    const m = await kitchenAt(fx.ctx, "12");
    expect(line(m, "Farmhouse Kitchen"))
      .toMatch(/EXCLUDED, replaced by Kitchen at night$/);
    expect(names(m)).not.toContain("kitchen_day.png");
    expect(names(m)).not.toContain("kitchen_no_table_day.png");
    expect(names(m)).toContain("kitchen_night.png");
    // Higher precedence than the replacer, so untouched by it.
    expect(line(m, "Kitchen storm-night build")).not.toMatch(/EXCLUDED/);
  });

  test("scene 3: nothing replaces, so the plate and the baseline add",
       async () => {
    const m = await kitchenAt(fx.ctx, "3");
    // Filtered out by its own filter, which is the reason it gives.
    expect(line(m, "Kitchen at night")).toMatch(/EXCLUDED, time_of_day_filter/);
    expect(line(m, "Farmhouse Kitchen")).not.toMatch(/EXCLUDED/);
    expect(line(m, "Scene 03 - Kitchen - Day")).not.toMatch(/EXCLUDED/);
    expect(names(m)).toContain("kitchen_day.png");
    expect(names(m)).toContain("demo_kitchen_day_01.png");
  });

  test("the same binding set to add no longer replaces", async () => {
    await withCopy("add", async (ctx) => {
      await ctx.exec("UPDATE location_asset_binding SET combine = 'add' " +
                     "WHERE name = 'Kitchen at night'");
      const m = await kitchenAt(ctx, "12");
      expect(line(m, "Farmhouse Kitchen")).not.toMatch(/EXCLUDED/);
      expect(names(m)).toContain("kitchen_day.png");
    });
  });

  test("an unset combine is add", async () => {
    await withCopy("unset", async (ctx) => {
      await ctx.exec("UPDATE location_asset_binding SET combine = NULL " +
                     "WHERE name = 'Kitchen at night'");
      const m = await kitchenAt(ctx, "12");
      expect(names(m)).toContain("kitchen_day.png");
    });
  });

  test("equal precedence is ordered, never replaced", async () => {
    await withCopy("tie", async (ctx) => {
      // The night binding (row 7) raised to the storm build's precedence
      // (row 8). Row id orders the tie, so the replacer is met FIRST and
      // the storm build after it: the case a `<=` would get wrong.
      await ctx.exec("UPDATE location_asset_binding SET precedence = 2 " +
                     "WHERE name = 'Kitchen at night'");
      const m = await kitchenAt(ctx, "12");
      expect(line(m, "Kitchen storm-night build")).not.toMatch(/EXCLUDED/);
      expect(names(m)).toContain("demo_kitchen_night_01.png");
      // Still replacing what is strictly below it.
      expect(line(m, "Farmhouse Kitchen"))
        .toMatch(/EXCLUDED, replaced by Kitchen at night$/);
    });
  });

  test("anchors and shot overrides are never replaced", async () => {
    await withCopy("identity", async (ctx) => {
      const eleanor = await fx.oneId("character", "Eleanor");
      await ctx.exec("UPDATE character_asset_binding SET combine = " +
                     "'replace' WHERE name = 'Eleanor while wounded'");
      const shot = (await ctx.exec(
        "SELECT id, scene_id FROM shot WHERE name LIKE '%12-04%'"))[0];
      const m = await resolveMedia(ctx, "character", eleanor,
        "visual_identity", Number(shot?.["scene_id"]), Number(shot?.["id"]));
      // Her identity bundle is replaced (the test's premise) ...
      expect(line(m, "Eleanor visual baseline"))
        .toMatch(/EXCLUDED, replaced by Eleanor while wounded$/);
      // ... and the layers above the bundles are not.
      expect(m.anchor_assets.map((a) => a?.["name"]))
        .toContain("eleanor_face_anchor.png");
      expect(m.override_assets.map((a) => a["name"]))
        .toContain("eleanor_lamplit.png");
    });
  });
});

describe("§12.8.2 — the orders", () => {
  test("references highest precedence first, trail lowest first",
       async () => {
    const m = await kitchenAt(fx.ctx, "3");
    // Scene 03 (precedence 2) before the baseline (0) in the bundle layer.
    const plate = names(m).indexOf("demo_kitchen_day_01.png");
    const baseline = names(m).indexOf("kitchen_day.png");
    expect(plate).toBeGreaterThanOrEqual(0);
    expect(plate).toBeLessThan(baseline);
    // The trail runs broadest first: the baseline opens it.
    const bindingLines = m.trail.filter((t) => t.startsWith("binding "));
    expect(bindingLines[0]).toMatch(/^binding Farmhouse Kitchen -> /);
    expect(bindingLines.at(-1)).toMatch(/^binding (Scene 03|Kitchen storm)/);
  });

  test("equal precedence is ordered by row id, lower first", async () => {
    // Scene 03 (row 1) and the storm build (row 8) share precedence 2.
    const m = await kitchenAt(fx.ctx, "3");
    const bindingLines = m.trail.filter((t) => t.startsWith("binding "));
    // Reversed in the trail, so the higher row id comes first there.
    const storm = bindingLines.findIndex((t) => t.includes("storm-night"));
    const plate = bindingLines.findIndex((t) => t.includes("Scene 03"));
    expect(storm).toBeLessThan(plate);
  });
});

describe("§12.8.2 — reported, not refused", () => {
  const codes = async (ctx: ScfContext) =>
    (await collectFindings(ctx.exec, ctx.registry)).findings
      .filter((f) => f.code.startsWith("binding."))
      .map((f) => f.code).sort();

  test("the fixture raises neither", async () => {
    expect(await codes(fx.ctx)).toEqual([]);
  });

  test("a replacing baseline, and a replacing binding in a tie",
       async () => {
    await withCopy("findings", async (ctx) => {
      await ctx.exec("UPDATE location_asset_binding SET combine = " +
                     "'replace' WHERE name = 'Farmhouse Porch'");
      // Scene 03 and the storm build share precedence 2 and an intent.
      await ctx.exec("UPDATE location_asset_binding SET combine = " +
                     "'replace' WHERE name = 'Scene 03 - Kitchen - Day'");
      // One tie: reported on the binding that replaces, not on the storm
      // build it is tied with, which only adds.
      expect(await codes(ctx)).toEqual([
        "binding.baseline_replaces",
        "binding.replace_tie",
      ]);
    });
  });
});
