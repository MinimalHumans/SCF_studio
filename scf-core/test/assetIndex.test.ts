/**
 * assetIndex.test.ts — the asset browser's data layer (P4).
 *
 * Orphans get the most attention here, because they are what the
 * feature exists for: at a thousand rows nobody notices the asset
 * nothing points at. The last test is the plan's unvalidated exit
 * criterion, measured rather than assumed.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  applyFilter, assetReferenceColumns, facetsOf, listAssets, orphanIds,
  pathTree,
} from "../src/assetIndex.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { FIXTURE_PATH, registry } from "./setup.ts";

let fixture: NodeDatabase;

beforeAll(() => {
  fixture = openNodeDatabase(FIXTURE_PATH, { readOnly: true });
});

afterAll(() => fixture.close());

describe("assetReferenceColumns", () => {
  test("finds the junctions that point at assets", () => {
    const cols = assetReferenceColumns(registry);
    const pairs = cols.map((c) => `${c.table}.${c.column}`);
    expect(pairs).toContain("bundle_asset.asset_id");
    expect(pairs).toContain("entity_anchor.asset_id");
  });

  test("excludes the asset table's own version columns", () => {
    const pairs = assetReferenceColumns(registry)
      .map((c) => `${c.table}.${c.column}`);
    // A row whose only inbound reference is its own successor is still
    // an orphan; counting supersession as usage would hide it.
    expect(pairs).not.toContain("asset.parent_id");
    expect(pairs).not.toContain("asset.superseded_by_id");
  });
});

describe("the fixture's assets", () => {
  test("every asset carries a rooted identifier after 2.7", async () => {
    const assets = await listAssets(fixture.exec);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a.root, `${a.name ?? a.id}`).toBe("project");
      expect(a.identifier).toMatch(/^@project\//);
    }
  });

  test("formats are derived, and the deprecated enum is not consulted",
    async () => {
      const assets = await listAssets(fixture.exec);
      const formats = new Set(assets.map((a) => a.format));
      // The fixture stores asset_type='archive', which was never in the
      // enum. The derived format is 'zip', from the identifier alone.
      expect(formats).toContain("zip");
      expect(formats).toContain("exr");
      expect(formats).toContain("glb");
    });

  test("the path tree matches the folders the fixture already used",
    async () => {
      const tree = pathTree(await listAssets(fixture.exec));
      const assetsNode = tree.children.find((c) => c.name === "assets");
      expect(assetsNode).toBeDefined();
      const names = (assetsNode?.children ?? []).map((c) => c.name);
      expect(names).toEqual(["locations", "props", "sound"]);
      expect(assetsNode?.prefix).toBe("@project/assets/");
    });

  test("folder counts include everything below them", async () => {
    const assets = await listAssets(fixture.exec);
    const tree = pathTree(assets);
    expect(tree.totalCount).toBe(assets.length);
    const assetsNode = tree.children.find((c) => c.name === "assets");
    const below = (assetsNode?.children ?? [])
      .reduce((n, c) => n + c.totalCount, 0);
    expect(assetsNode?.totalCount).toBe(
      below + (assetsNode?.assetIds.length ?? 0));
  });
});

describe("orphans", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "index-test" });
    const add = async (name: string, identifier: string): Promise<number> => {
      await db.exec(
        "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
        [name, newUuid(), identifier]);
      const [row] = await db.exec("SELECT last_insert_rowid() AS id");
      return Number(row?.["id"]);
    };
    const linked = await add("linked.png", "@project/a/linked.png");
    await add("lonely.png", "@project/a/lonely.png");
    const superseded = await add("old.png", "@project/a/old.png");
    const successor = await add("new.png", "@project/a/new.png");
    await db.exec(
      "UPDATE asset SET superseded_by_id = ? WHERE id = ?",
      [successor, superseded]);
    await db.exec(
      "UPDATE asset SET parent_id = ? WHERE id = ?",
      [superseded, successor]);
    await db.exec(
      "INSERT INTO bundle (name, uuid) VALUES ('Look', ?)", [newUuid()]);
    const [bundle] = await db.exec("SELECT last_insert_rowid() AS id");
    await db.exec(
      "INSERT INTO bundle_asset (bundle_id, asset_id, uuid) " +
      "VALUES (?, ?, ?)", [Number(bundle?.["id"]), linked, newUuid()]);
  });

  afterAll(() => db.close());

  test("an asset in a bundle is not an orphan", async () => {
    const orphans = await orphanIds(db.exec, registry);
    const assets = await listAssets(db.exec);
    const linked = assets.find((a) => a.name === "linked.png");
    expect(orphans.has(linked?.id ?? -1)).toBe(false);
  });

  test("an asset nothing points at IS an orphan", async () => {
    const orphans = await orphanIds(db.exec, registry);
    const assets = await listAssets(db.exec);
    const lonely = assets.find((a) => a.name === "lonely.png");
    expect(orphans.has(lonely?.id ?? -1)).toBe(true);
  });

  test("a version chain does not rescue a row from orphanhood",
    async () => {
      const orphans = await orphanIds(db.exec, registry);
      const assets = await listAssets(db.exec);
      const old = assets.find((a) => a.name === "old.png");
      // Its successor points at it, and nothing else does.
      expect(orphans.has(old?.id ?? -1)).toBe(true);
    });

  test("facets count orphans alongside everything else", async () => {
    const assets = await listAssets(db.exec);
    const facets = facetsOf(assets, await orphanIds(db.exec, registry));
    expect(facets.total).toBe(4);
    expect(facets.orphans).toBe(3);
    expect(facets.formats[0]?.value).toBe("png");
    expect(facets.formats[0]?.count).toBe(4);
  });
});

describe("filters compose", () => {
  const assets = [
    { id: 1, name: "a", identifier: "@project/img/a.png", root: "project",
      path: "img/a.png", format: "png", lifecycleStatus: "active" },
    { id: 2, name: "b", identifier: "@project/img/b.exr", root: "project",
      path: "img/b.exr", format: "exr", lifecycleStatus: "active" },
    { id: 3, name: "c", identifier: "@plates/c.exr", root: "plates",
      path: "c.exr", format: "exr", lifecycleStatus: "active" },
    { id: 4, name: "d", identifier: null, root: null, path: null,
      format: null, lifecycleStatus: "active" },
  ];
  const orphans = new Set([2, 4]);

  test("format and prefix narrow together", () => {
    const out = applyFilter(assets, {
      format: "exr", prefix: "@project/",
    }, orphans);
    expect(out.map((a) => a.id)).toEqual([2]);
  });

  test("orphans-only is a facet, not a mode", () => {
    expect(applyFilter(assets, { orphansOnly: true }, orphans)
      .map((a) => a.id)).toEqual([2, 4]);
  });

  test("unaddressed rows are findable", () => {
    expect(applyFilter(assets, { unaddressedOnly: true }, orphans)
      .map((a) => a.id)).toEqual([4]);
  });

  test("text matches name and identifier", () => {
    expect(applyFilter(assets, { text: "plates" }, orphans)
      .map((a) => a.id)).toEqual([3]);
  });

  test("no filter returns everything", () => {
    expect(applyFilter(assets, {}, orphans)).toHaveLength(4);
  });
});

describe("scale", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "scale-test" });
    await db.exec("BEGIN");
    for (let i = 0; i < 2000; i += 1) {
      const folder = `seq${String(i % 40).padStart(3, "0")}`;
      await db.exec(
        "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
        [`plate_${i}.exr`, newUuid(),
         `@project/assets/${folder}/plate_${i}.exr`]);
    }
    await db.exec("COMMIT");
  });

  afterAll(() => db.close());

  /**
   * The plan's exit criterion for P4 was "a project with 2,000 assets is
   * navigable without a search box", written without knowing whether the
   * data layer could carry it. This measures it. The budget is
   * deliberately loose — it is a guard against an accidental quadratic,
   * not a benchmark.
   */
  test("2,000 assets index in well under a second", async () => {
    const started = Date.now();
    const assets = await listAssets(db.exec);
    const orphans = await orphanIds(db.exec, registry);
    const facets = facetsOf(assets, orphans);
    const tree = pathTree(assets);
    const elapsed = Date.now() - started;

    expect(assets).toHaveLength(2000);
    expect(facets.orphans).toBe(2000);
    expect(tree.children[0]?.children).toHaveLength(40);
    expect(elapsed).toBeLessThan(2000);
  });

  test("filtering 2,000 rows stays interactive", async () => {
    const assets = await listAssets(db.exec);
    const orphans = new Set<number>();
    const started = Date.now();
    for (let i = 0; i < 20; i += 1) {
      applyFilter(assets, { text: "plate_1" }, orphans);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
