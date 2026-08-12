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
  applyBundleAdd, bindBundleToCharacter, bundleMembers, bundlesForAsset,
  createBundle, listBundles, planBundleAdd, removeBundleMember,
  setMemberRole,
} from "../src/bundling.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { registry } from "./setup.ts";

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
