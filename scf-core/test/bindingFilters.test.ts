// SPDX-License-Identifier: Apache-2.0
/**
 * bindingFilters.test.ts — every filter a binding declares is read (§12.8).
 *
 * A filter column nothing reads makes its binding apply everywhere, and
 * a position where the filter PASSES cannot tell that apart from one
 * that is evaluated. The published Q13 sits at 12-04, a night-storm,
 * post-injury position where every filtered binding legitimately applies,
 * so it cannot see a filter that is never evaluated. Only a position
 * where the filter must FAIL can.
 *
 * Two halves, the shape cutChangesTheAnswer uses:
 *
 * 1. Two-sided. Each filtered binding in the fixture is EXCLUDED, with its
 *    reason, at a position where the filter fails, and APPLIES at one
 *    where it passes. The second half is what stops a "fix" that simply
 *    drops every filtered binding.
 *
 * 2. The guard. The filter columns are read from the registry, not listed
 *    here. For every `<subject>_asset_binding` entity (`bindingSubjects`),
 *    every column that is not the binding's own structure is probed on a
 *    COPY of the fixture: some value, at some position, must make the
 *    binding EXCLUDED. A column nothing reads never excludes anything, so
 *    the next filter added to the schema fails here until it is wired.
 *
 * The fixture is a checksummed artifact: read-only in half 1, copied to a
 * temp file wherever half 2 or the vocal case needs to insert a row.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bindingSubjects } from "../src/bundling.ts";
import { openNodeDatabase } from "../src/node.ts";
import {
  resolveMedia, type ResolvedMedia, type ScfContext,
} from "../src/resolution.ts";
import { FIXTURE_PATH, openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
let sandbox: string;

beforeAll(() => {
  fx = openFixture();
  sandbox = mkdtempSync(join(tmpdir(), "scf-binding-filters-"));
});
afterAll(() => {
  fx.close();
  rmSync(sandbox, { recursive: true, force: true });
});

/** A writable copy of the fixture, handed to `fn` and closed after. */
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

/** The trail line for one binding; every binding of the intent has one. */
function trailLine(media: ResolvedMedia, binding: string): string {
  const line = media.trail.find((l) => l.startsWith(`binding ${binding} -> `));
  expect(line, `no trail line for binding "${binding}":\n` +
                 media.trail.join("\n")).toBeDefined();
  return line ?? "";
}

const isExcluded = (line: string): boolean => line.includes(": EXCLUDED, ");

/**
 * Asset ids only the named binding's bundle contributes for this subject,
 * so their presence in `base_assets` is attributable to that binding.
 */
async function assetsOnlyFrom(
    ctx: ScfContext, subject: string, subjectId: number,
    binding: string): Promise<Set<number>> {
  const bindings = await ctx.exec(
    `SELECT name, bundle_id FROM "${subject}_asset_binding" ` +
    `WHERE "${subject}_id" = ?`, [subjectId]);
  const assetsOf = async (bundleId: unknown) => new Set(
    (await ctx.exec("SELECT asset_id FROM bundle_asset WHERE bundle_id = ?",
                    [Number(bundleId)]))
      .map((r) => Number(r["asset_id"])));
  const mine = bindings.find((b) => b["name"] === binding);
  expect(mine, `binding "${binding}" is missing from the fixture`)
    .toBeDefined();
  const out = await assetsOf(mine?.["bundle_id"]);
  for (const b of bindings) {
    if (b["name"] === binding) continue;
    for (const id of await assetsOf(b["bundle_id"])) out.delete(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Two-sided: excluded where the filter fails, applied where it passes
// ---------------------------------------------------------------------------

interface Case {
  filter: string;
  subject: "character" | "location";
  subjectName: string;
  binding: string;
  excludedAt: string[];
  reason: RegExp;
  appliesAt: string[];
}

const CASES: Case[] = [
  {
    filter: "time_of_day_filter",
    subject: "location", subjectName: "Farmhouse Kitchen",
    binding: "Kitchen at night",
    excludedAt: ["3"],
    reason: /time_of_day_filter "night" vs scene "morning"/,
    appliesAt: ["12"],
  },
  {
    filter: "variant_id",
    subject: "location", subjectName: "Farmhouse Kitchen",
    binding: "Kitchen storm-night build",
    excludedAt: ["3"],
    reason: /variant filter vs "Kitchen .* day baseline" in force/,
    appliesAt: ["12"],
  },
  {
    // 12A and 17 as well as 12: "wounded" starts at 9 and nothing
    // resolves it, so it is in force at every later position — including
    // 17, which §4.1 orders after every scripted scene.
    filter: "physical_state_filter",
    subject: "character", subjectName: "Eleanor",
    binding: "Eleanor while wounded",
    excludedAt: ["3"],
    reason: /physical_state_filter "wounded", no such physical state in force/,
    appliesAt: ["12", "12A", "17"],
  },
  {
    // The control: the one filter that was always read.
    filter: "scene_range_start_id / scene_range_end_id",
    subject: "location", subjectName: "Farmhouse Kitchen",
    binding: "Scene 03 - Kitchen - Day",
    excludedAt: ["12"],
    reason: /after its scene range/,
    appliesAt: ["3"],
  },
];

describe("a binding filter excludes where it fails and applies where it passes",
         () => {
  for (const c of CASES) {
    test(`${c.filter}: "${c.binding}"`, async () => {
      const subjectId = await fx.oneId(c.subject, c.subjectName);
      const own = await assetsOnlyFrom(fx.ctx, c.subject, subjectId,
                                       c.binding);
      expect(own.size,
             `"${c.binding}" contributes no asset of its own, so the ` +
             `asset half of this test would prove nothing`)
        .toBeGreaterThan(0);

      for (const label of c.excludedAt) {
        const media = await resolveMedia(
          fx.ctx, c.subject, subjectId, "visual_identity",
          await fx.sceneByNumber(label));
        const line = trailLine(media, c.binding);
        expect(isExcluded(line), `sc ${label}: ${line}`).toBe(true);
        expect(line, `sc ${label}`).toMatch(c.reason);
        const leaked = media.base_assets
          .filter((a) => own.has(Number(a["id"])))
          .map((a) => a["name"]);
        expect(leaked, `sc ${label}: excluded binding's assets leaked`)
          .toEqual([]);
      }

      for (const label of c.appliesAt) {
        const media = await resolveMedia(
          fx.ctx, c.subject, subjectId, "visual_identity",
          await fx.sceneByNumber(label));
        const line = trailLine(media, c.binding);
        expect(isExcluded(line), `sc ${label}: ${line}`).toBe(false);
        const got = new Set(media.base_assets.map((a) => Number(a["id"])));
        for (const id of own) {
          expect(got.has(id), `sc ${label}: asset ${id} missing`).toBe(true);
        }
      }
    });
  }

  test("vocal_state_filter: a binding on 'hoarse' (no fixture row; " +
       "inserted into a copy)", async () => {
    await withCopy("vocal", async (ctx) => {
      const eleanor = await fx.oneId("character", "Eleanor");
      const voice = await fx.oneId("bundle", "Eleanor Voice Core");
      const name = "probe: Eleanor while hoarse";
      await ctx.exec(
        `INSERT INTO character_asset_binding
           (uuid, name, character_id, bundle_id, is_baseline, precedence,
            vocal_state_filter, lifecycle_status)
         VALUES (?, ?, ?, ?, 0, 1, 'hoarse', 'active')`,
        [randomUUID(), name, eleanor, voice]);

      // "hoarse" is scene_only at 9: in force there, nowhere else.
      for (const [label, excluded] of
           [["3", true], ["9", false], ["10", true]] as const) {
        const media = await resolveMedia(
          ctx, "character", eleanor, "voice_identity",
          await fx.sceneByNumber(label));
        const line = trailLine(media, name);
        expect(isExcluded(line), `sc ${label}: ${line}`).toBe(excluded);
        if (excluded) {
          expect(line).toMatch(
            /vocal_state_filter "hoarse", no such vocal state in force/);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The guard: every declared filter column is read by something
// ---------------------------------------------------------------------------

/**
 * A binding's own structure: what it binds, to what, how strongly, and
 * how it combines with the others in force (§12.8.2's `combine`, which
 * decides what a binding does to OTHER bindings, never whether it applies
 * itself). Everything else on a binding entity is a condition and gets
 * probed. This fails closed: a new column is treated as a filter until it
 * is listed here, so the list can only ever be too short, never hide one.
 */
function structural(subject: string): Set<string> {
  return new Set(["name", `${subject}_id`, "bundle_id", "is_baseline",
                  "precedence", "combine", "notes"]);
}

const NEVER = "__scf_guard_never_matches__";

describe("guard: every filter column the registry declares is evaluated", () => {
  const subjects = bindingSubjects(registry);

  test("the registry declares binding entities to guard", () => {
    // Would pass vacuously if bindingSubjects ever came back empty.
    expect(subjects).toEqual(
      expect.arrayContaining(["character", "location", "prop", "costume"]));
  });

  for (const subject of subjects) {
    const entity = `${subject}_asset_binding`;
    const def = registry.entities.get(entity);
    const conditions = (def?.fields ?? []).filter(
      (f) => !f.autoInjected && !structural(subject).has(f.name));

    test(`${entity}: ${conditions.map((f) => f.name).join(", ")}`,
         async () => {
      expect(conditions.length,
             `${entity} declares no conditions; is structural() stale?`)
        .toBeGreaterThan(0);

      await withCopy(`guard-${subject}`, async (ctx) => {
        const subjectRow = (await ctx.exec(
          `SELECT id FROM "${subject}" ORDER BY id LIMIT 1`))[0];
        expect(subjectRow, `no ${subject} row to bind`).toBeDefined();
        const subjectId = Number(subjectRow?.["id"]);
        const bundle = (await ctx.exec(
          "SELECT id, intent FROM bundle ORDER BY id LIMIT 1"))[0];
        const intent = String(bundle?.["intent"]);

        // Ranked above every binding in the file, so that no `replace`
        // binding (§12.8.2) can exclude it: the only thing that may
        // exclude the probe is the filter being probed.
        const probe = "__guard_probe__";
        await ctx.exec(
          `INSERT INTO "${entity}"
             (uuid, name, "${subject}_id", bundle_id, is_baseline,
              precedence, lifecycle_status)
           VALUES (?, ?, ?, ?, 1, 1000000, 'active')`,
          [randomUUID(), probe, subjectId, Number(bundle?.["id"])]);

        const positions = (await ctx.exec(
          "SELECT id FROM scene WHERE lifecycle_status IS NULL " +
          "OR lifecycle_status != 'cut' ORDER BY id"))
          .map((r) => Number(r["id"]));

        const excludedSomewhere = async (): Promise<boolean> => {
          for (const sceneId of positions) {
            const media = await resolveMedia(ctx, subject, subjectId,
                                             intent, sceneId);
            if (isExcluded(trailLine(media, probe))) return true;
          }
          return false;
        };

        // Baseline sanity: with no condition set the probe applies
        // everywhere, so any exclusion below is the probed column's doing.
        expect(await excludedSomewhere(),
               `${entity}: an unconditioned probe was excluded`).toBe(false);

        for (const f of conditions) {
          let candidates: unknown[];
          if (f.fieldType === "reference" && f.referenceEntity) {
            candidates = (await ctx.exec(
              `SELECT id FROM "${f.referenceEntity}" ORDER BY id`))
              .map((r) => Number(r["id"]));
            // A table the fixture leaves empty (prop_variant, until a
            // prop variant is authored) still has a column to probe: a
            // filter naming a row that is not there can never be
            // satisfied, so it must exclude. A column nothing reads
            // would let the binding through even then.
            if (candidates.length === 0) candidates = [2_147_483_647];
          } else if (["text", "select", "textarea"].includes(f.fieldType)) {
            candidates = [NEVER];
          } else {
            throw new Error(
              `${entity}.${f.name}: the guard cannot probe a ` +
              `${f.fieldType} condition yet; teach it one`);
          }

          let read = false;
          for (const value of candidates) {
            await ctx.exec(
              `UPDATE "${entity}" SET ` +
              conditions.map((c) => `"${c.name}" = NULL`).join(", ") +
              ` WHERE name = ?`, [probe]);
            await ctx.exec(
              `UPDATE "${entity}" SET "${f.name}" = ? WHERE name = ?`,
              [value as string | number, probe]);
            if (await excludedSomewhere()) { read = true; break; }
          }
          expect(read,
                 `${entity}.${f.name} is declared by the registry but ` +
                 `bindingApplies never excludes on it: a binding scoped ` +
                 `by it would apply everywhere`).toBe(true);
        }
      });
    }, 60_000);
  }
});
