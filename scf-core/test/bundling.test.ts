// SPDX-License-Identifier: Apache-2.0
/**
 * bundling.test.ts — asset into bundle, in batches.
 *
 * The property that matters for batch work is that adding a selection
 * overlapping what is already there is safe: `bundle_asset`'s natural
 * key is the pair, so a second row for it would be a duplicate rather
 * than a second fact.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  applyBundleAdd, bindBundle, bindBundleToCharacter, bundleMembers,
  bundleReach, bundleReachColumns, bundlesForAsset, createBundle,
  listBundles, planBundleAdd, removeBundleMember, setMemberRole,
  unboundBundleIds,
} from "../src/bundling.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { openFixture, registry } from "./setup.ts";

let db: NodeDatabase;
let eleanor = 0;
const assets: number[] = [];

beforeAll(async () => {
  db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry, { editorVersion: "bundle-test" });

  await db.exec("INSERT INTO character (name, uuid) VALUES ('Eleanor', ?)",
                [newUuid()]);
  eleanor = Number((await db.exec(
    "SELECT last_insert_rowid() AS id"))[0]?.["id"]);

  for (const name of ["face.png", "turn.png", "hands.png", "hair.png"]) {
    await db.exec(
      "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
      [name, newUuid(), `@project/assets/${name}`]);
    assets.push(Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]));
  }
});

afterAll(() => db.close());

describe("the three-step path, as one action each", () => {
  let bundleId = 0;

  test("a bundle is created with an intent", async () => {
    bundleId = await createBundle(db.exec, "Eleanor — look",
                                 "visual_identity");
    const bundles = await listBundles(db.exec);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.intent).toBe("visual_identity");
    expect(bundles[0]?.assetCount).toBe(0);
  });

  test("assets are added in a batch", async () => {
    const plan = await planBundleAdd(db.exec, bundleId, assets.slice(0, 2));
    expect(plan.add).toHaveLength(2);
    expect(plan.already).toHaveLength(0);

    await applyBundleAdd(db.exec, bundleId, plan.add, "reference");
    const members = await bundleMembers(db.exec, bundleId);
    expect(members).toHaveLength(2);
    expect(members[0]?.role).toBe("reference");
    expect(members[0]?.identifier).toMatch(/^@project\//);
  });

  test("binding is what makes the bundle reachable", async () => {
    const id = await bindBundleToCharacter(db.exec, eleanor, bundleId);
    expect(id).not.toBeNull();
    const [row] = await db.exec(
      "SELECT is_baseline FROM character_asset_binding WHERE id = ?", [id]);
    expect(Number(row?.["is_baseline"])).toBe(1);
  });

  test("binding twice is a no-op, not a duplicate", async () => {
    expect(await bindBundleToCharacter(db.exec, eleanor, bundleId))
      .toBeNull();
    const rows = await db.exec(
      "SELECT id FROM character_asset_binding WHERE character_id = ?",
      [eleanor]);
    expect(rows).toHaveLength(1);
  });
});

describe("batch behaviour", () => {
  let bundleId = 0;

  beforeAll(async () => {
    bundleId = await createBundle(db.exec, "Batch", "visual_identity");
    await applyBundleAdd(db.exec, bundleId, assets.slice(0, 2));
  });

  test("an overlapping selection adds only what is new", async () => {
    const plan = await planBundleAdd(db.exec, bundleId, assets);
    expect(plan.add).toHaveLength(2);
    expect(plan.already).toHaveLength(2);
  });

  test("the same asset twice in one selection is added once", async () => {
    const plan = await planBundleAdd(db.exec, bundleId,
                                     [assets[2] as number,
                                      assets[2] as number]);
    expect(plan.add).toEqual([assets[2]]);
  });

  test("order continues rather than restarting", async () => {
    const plan = await planBundleAdd(db.exec, bundleId, assets);
    await applyBundleAdd(db.exec, bundleId, plan.add);
    const members = await bundleMembers(db.exec, bundleId);
    const orders = members.map((m) => m.order);
    expect(orders).toEqual([1, 2, 3, 4]);
  });

  test("planning writes nothing", async () => {
    const before = (await bundleMembers(db.exec, bundleId)).length;
    await planBundleAdd(db.exec, bundleId, assets);
    expect((await bundleMembers(db.exec, bundleId)).length).toBe(before);
  });
});

describe("membership maintenance", () => {
  test("a role can be set after the fact", async () => {
    const [bundle] = await listBundles(db.exec);
    const members = await bundleMembers(db.exec, bundle?.id ?? 0);
    const target = members[0];
    await setMemberRole(db.exec, target?.linkId ?? 0, "hero");
    const after = await bundleMembers(db.exec, bundle?.id ?? 0);
    expect(after[0]?.role).toBe("hero");
  });

  test("an empty role clears rather than storing whitespace", async () => {
    const [bundle] = await listBundles(db.exec);
    const members = await bundleMembers(db.exec, bundle?.id ?? 0);
    await setMemberRole(db.exec, members[0]?.linkId ?? 0, "   ");
    const after = await bundleMembers(db.exec, bundle?.id ?? 0);
    expect(after[0]?.role).toBeNull();
  });

  test("removing a membership leaves the asset alone", async () => {
    const [bundle] = await listBundles(db.exec);
    const members = await bundleMembers(db.exec, bundle?.id ?? 0);
    const before = (await db.exec("SELECT id FROM asset")).length;

    await removeBundleMember(db.exec, members[0]?.linkId ?? 0);
    expect(await bundleMembers(db.exec, bundle?.id ?? 0))
      .toHaveLength(members.length - 1);
    expect((await db.exec("SELECT id FROM asset")).length).toBe(before);
  });

  test("an asset knows which bundles it is in", async () => {
    const inBundles = await bundlesForAsset(db.exec, assets[0] as number);
    expect(inBundles.length).toBeGreaterThan(0);
    expect(inBundles[0]?.intent).toBe("visual_identity");
  });

  test("an unbundled asset reports none", async () => {
    await db.exec(
      "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
      ["lonely.png", newUuid(), "@project/lonely.png"]);
    const id = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    expect(await bundlesForAsset(db.exec, id)).toEqual([]);
  });
});

describe("binding any subject, and seeing what reaches a bundle", () => {
  let prop = 0;
  let scene = 0;
  let bundleId = 0;

  beforeAll(async () => {
    await db.exec("INSERT INTO prop (name, uuid) VALUES ('Chime', ?)",
                  [newUuid()]);
    prop = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    await db.exec(
      "INSERT INTO scene (name, scene_number, uuid) VALUES ('Storm', '24', ?)",
      [newUuid()]);
    scene = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    bundleId = await createBundle(db.exec, "Chime — after", "visual_identity");
  });

  test("the reach columns come from the registry, not a list", () => {
    const found = bundleReachColumns(registry)
      .map((c) => `${c.entity}.${c.column}`).sort();
    expect(found).toEqual([
      "character_asset_binding.bundle_id",
      "character_shot_override.bundle_override_id",
      "location_asset_binding.bundle_id",
      "location_shot_override.bundle_override_id",
      "prop_asset_binding.bundle_id",
      "prop_shot_override.bundle_override_id",
    ]);
  });

  test("a new bundle is unbound until something binds it", async () => {
    expect((await unboundBundleIds(db.exec, registry)).has(bundleId))
      .toBe(true);
    expect(await bundleReach(db.exec, registry, bundleId)).toEqual([]);
  });

  test("a prop binding carries its scene range", async () => {
    const id = await bindBundle(db.exec, "prop", prop, bundleId, {
      isBaseline: false, sceneRangeStartId: scene, precedence: 2,
      name: "after the storm",
    });
    expect(id).not.toBeNull();
    const reach = await bundleReach(db.exec, registry, bundleId);
    expect(reach).toHaveLength(1);
    expect(reach[0]).toMatchObject({
      entity: "prop_asset_binding", subjectType: "prop", subjectId: prop,
      subjectName: "Chime", isBaseline: false, precedence: 2,
      sceneRangeStartId: scene, sceneRangeEndId: null, shotId: null,
      rowName: "after the storm",
    });
    expect((await unboundBundleIds(db.exec, registry)).has(bundleId))
      .toBe(false);
  });

  test("the same pair over the same range is a duplicate", async () => {
    expect(await bindBundle(db.exec, "prop", prop, bundleId,
                            { sceneRangeStartId: scene })).toBeNull();
  });

  test("the same pair over a different range is a second fact", async () => {
    expect(await bindBundle(db.exec, "prop", prop, bundleId))
      .not.toBeNull();
    expect(await bundleReach(db.exec, registry, bundleId)).toHaveLength(2);
  });

  test("a cut binding reaches nothing (§6.6.1)", async () => {
    await db.exec(
      "UPDATE prop_asset_binding SET lifecycle_status = 'cut' " +
      "WHERE bundle_id = ?", [bundleId]);
    expect(await bundleReach(db.exec, registry, bundleId)).toEqual([]);
    expect((await unboundBundleIds(db.exec, registry)).has(bundleId))
      .toBe(true);
  });

  test("a subject kind without a binding table is refused", async () => {
    await expect(bindBundle(db.exec, "costume" as "prop", 1, bundleId))
      .rejects.toThrow(/no binding table/);
  });
});

describe("the fixture's media is reachable", () => {
  test("the only bundle nothing binds is the costume's", async () => {
    // costume has no asset binding entity, so a bundle of costume
    // references has nowhere to be bound. Every other bundle reaches a
    // subject — the check the editor now shows on every bundle.
    const fx = openFixture();
    try {
      const unbound = await unboundBundleIds(fx.ctx.exec, registry);
      const names = (await fx.ctx.exec("SELECT id, name FROM bundle"))
        .filter((r) => unbound.has(Number(r["id"])))
        .map((r) => r["name"]);
      expect(names).toEqual(["Ada's Shawl"]);
    } finally {
      fx.close();
    }
  });
});
