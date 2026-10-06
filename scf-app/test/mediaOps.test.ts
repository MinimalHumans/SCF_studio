// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase, newUuid, type SqlExec } from "@scf-core/db.ts";
import {
  loadRegistry, type Registry, type RegistryJson,
} from "@scf-core/registry.ts";
import {
  applyBundleAdd, bindBundle, createBundle,
} from "@scf-core/bundling.ts";
import { resolveMedia } from "@scf-core/resolution.ts";
import {
  attach, boardForIdentifier, confirmIdentity, detach, loadBoard,
  registerFiles, repurpose, SharedSetError, withCreatedAssets,
  addException, moveException, purposesFor, removeException, updateException,
} from "../src/editor/mediaOps.ts";
import { applyUndoChange } from "../src/state/undoChange.ts";
import { createCharacter } from "../src/editor/elementOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));
const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

let registry: Registry;
let db: ReturnType<typeof openNodeDatabase>;
const sandbox = mkdtempSync(join(tmpdir(), "scf-media-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

beforeEach(async () => {
  registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry);
});

const asset = async (exec: SqlExec, path: string): Promise<number> => {
  await exec("INSERT INTO asset (uuid, name, identifier) VALUES (?, ?, ?)",
             [newUuid(), path.split("/").pop() ?? path, `@project/${path}`]);
  return Number((await exec("SELECT last_insert_rowid() AS id"))[0]?.["id"]);
};
const count = async (exec: SqlExec, table: string): Promise<number> =>
  Number((await exec(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.["n"]);
const TABLES = ["asset", "bundle", "bundle_asset", "character_asset_binding",
                "entity_anchor", "asset_relationship"];
const counts = async (exec: SqlExec): Promise<number[]> =>
  Promise.all(TABLES.map((t) => count(exec, t)));

function fixtureCopy(label: string): ReturnType<typeof openNodeDatabase> {
  const path = join(sandbox, `${label}.scf`);
  copyFileSync(FIXTURE, path);
  return openNodeDatabase(path, { readOnly: false });
}

describe("a board-built look is a real look", () => {
  test("Q13 gives the same answer as the hand-built rows", async () => {
    // The phase's own definition of done: the workspace's wiring and a
    // careful hand-author's wiring are indistinguishable to a reader.
    const byBoard = await createCharacter(db.exec, "Eleanor Cade");
    const byHand = await createCharacter(db.exec, "Ada Cade");
    const front = await asset(db.exec, "refs/front.png");
    const side = await asset(db.exec, "refs/side.png");

    await attach(db.exec, registry, byBoard, "look", [front, side], "set");

    const bundle = await createBundle(db.exec, "Ada — look", "visual_identity");
    await bindBundle(db.exec, registry, "character", byHand, bundle,
                     { isBaseline: true, precedence: 0 });
    await applyBundleAdd(db.exec, bundle, [front, side]);

    const ctx = { exec: db.exec, registry };
    const a = await resolveMedia(ctx, "character", byBoard, "visual_identity");
    const b = await resolveMedia(ctx, "character", byHand, "visual_identity");
    const names = (r: typeof a): string[] =>
      r.assets_most_specific_first.map((x) => String(x["name"]));
    expect(names(a)).toEqual(["front.png", "side.png"]);
    expect(names(a)).toEqual(names(b));
    expect(a.trail.length).toBe(b.trail.length);
  });

  test("“this is them” is a verified anchor Q13 uses", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const face = await asset(db.exec, "refs/face.png");
    await attach(db.exec, registry, id, "look", [face], "identity");
    const m = await resolveMedia({ exec: db.exec, registry }, "character", id,
                                 "visual_identity");
    expect(m.anchors.map((x) => Number(x["asset_id"]))).toEqual([face]);
    expect(m.anchors[0]?.["canonical_status"]).toBe("verified");
  });

  test("the first Look file makes one bundle and one baseline binding",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const one = await asset(db.exec, "a.png");
    const two = await asset(db.exec, "b.png");
    await attach(db.exec, registry, id, "look", [one], "set");
    await attach(db.exec, registry, id, "look", [two], "set");
    expect(await count(db.exec, "bundle")).toBe(1);
    expect(await count(db.exec, "character_asset_binding")).toBe(1);
    const bundle = (await db.exec("SELECT name, intent FROM bundle"))[0];
    expect(bundle).toEqual({ name: "Eleanor Cade — look",
                             intent: "visual_identity" });
  });

  test("dropping the same files again changes nothing", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const f = await asset(db.exec, "a.png");
    for (const p of ["set", "identity", "concept"] as const) {
      await attach(db.exec, registry, id, "look", [f], p);
    }
    const before = await counts(db.exec);
    for (const p of ["set", "identity", "concept"] as const) {
      const change = await attach(db.exec, registry, id, "look", [f], p);
      expect(change.created).toEqual([]);
    }
    expect(await counts(db.exec)).toEqual(before);
  });
});

describe("the board reads what is already there", () => {
  test("a drop on Eleanor's look joins her existing baseline set", async () => {
    const fx = fixtureCopy("join");
    try {
      const f = await asset(fx.exec, "refs/new.png");
      const bundlesBefore = await count(fx.exec, "bundle");
      await attach(fx.exec, registry, 1, "look", [f], "set");
      expect(await count(fx.exec, "bundle")).toBe(bundlesBefore);
      const board = await loadBoard(fx.exec, registry, 1, "look");
      expect(board.sets.map((s) => s.name)).toEqual(["Eleanor Visual Core"]);
      expect(board.tiles.some((t) => t.purpose === "set" &&
                              Number(t.asset["id"]) === f)).toBe(true);
    } finally { fx.close(); }
  });

  test("filtered bindings are exceptions, described in words", async () => {
    const fx = fixtureCopy("exceptions");
    try {
      const eleanor = await loadBoard(fx.exec, registry, 1, "look");
      expect(eleanor.exceptions.map((e) => e.when)).toEqual(["while wounded"]);
      const marcus = await loadBoard(fx.exec, registry, 2, "look");
      expect(marcus.exceptions).toEqual([expect.objectContaining({
        when: "as Marcus, age nine", replaces: true })]);
      // The variant's face is on the board, labelled as the variant's.
      const young = marcus.tiles.find((t) => t.variant !== null);
      expect(young?.variant).toBe("Marcus, age nine");
      expect(young?.purpose).toBe("identity");
    } finally { fx.close(); }
  });

  test("audio goes to the Voice board, everything else to Look", () => {
    expect(boardForIdentifier("@project/v/line.wav")).toBe("voice");
    expect(boardForIdentifier("@project/v/sheet.png")).toBe("look");
    expect(boardForIdentifier("@project/v/turn.mp4")).toBe("look");
  });
});

describe("a set shared with someone else", () => {
  test("is not changed for both without asking; split gives a copy",
       async () => {
    const eleanor = await createCharacter(db.exec, "Eleanor Cade");
    const ada = await createCharacter(db.exec, "Ada Cade");
    const f1 = await asset(db.exec, "a.png");
    await attach(db.exec, registry, eleanor, "look", [f1], "set");
    const shared = Number((await db.exec("SELECT id FROM bundle"))[0]?.["id"]);
    await bindBundle(db.exec, registry, "character", ada, shared,
                     { isBaseline: true, precedence: 0 });

    const f2 = await asset(db.exec, "b.png");
    await expect(attach(db.exec, registry, ada, "look", [f2], "set"))
      .rejects.toBeInstanceOf(SharedSetError);

    await attach(db.exec, registry, ada, "look", [f2], "set",
                 { shared: "split" });
    const members = async (c: number): Promise<number[]> =>
      (await loadBoard(db.exec, registry, c, "look")).tiles
        .map((t) => Number(t.asset["id"])).sort();
    expect(await members(eleanor)).toEqual([f1]);
    expect(await members(ada)).toEqual([f1, f2].sort());
  });
});

describe("undo", () => {
  test("a drop of new files undoes the asset rows too", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const known = await asset(db.exec, "refs/known.png");
    const before = await counts(db.exec);
    const { assetIds, created } = await registerFiles(db.exec, [
      { identifier: "@project/refs/known.png" },
      { identifier: "@project/refs/new.png" },
      { identifier: "@project/refs/new.png" },
    ]);
    expect(assetIds[0]).toBe(known);
    expect(assetIds).toHaveLength(2);
    expect(created).toHaveLength(1);
    const change = withCreatedAssets(
      await attach(db.exec, registry, id, "look", assetIds, "set"), created);
    await applyUndoChange(db.exec, change);
    expect(await counts(db.exec)).toEqual(before);
  });

  test("a first drop — bundle, binding, members — undoes to nothing",
       async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const files = [await asset(db.exec, "a.png"), await asset(db.exec, "b.png")];
    const before = await counts(db.exec);
    const change = await attach(db.exec, registry, id, "look", files, "set");
    expect(change.label).toBe("Added 2 files to Eleanor Cade's look");
    await applyUndoChange(db.exec, change);
    expect(await counts(db.exec)).toEqual(before);
  });

  test("a split puts the binding back on the shared set", async () => {
    const eleanor = await createCharacter(db.exec, "Eleanor Cade");
    const ada = await createCharacter(db.exec, "Ada Cade");
    await attach(db.exec, registry, eleanor, "look",
                 [await asset(db.exec, "a.png")], "set");
    const shared = Number((await db.exec("SELECT id FROM bundle"))[0]?.["id"]);
    await bindBundle(db.exec, registry, "character", ada, shared,
                     { isBaseline: true, precedence: 0 });
    const before = await counts(db.exec);
    const change = await attach(db.exec, registry, ada, "look",
                                [await asset(db.exec, "b.png")], "set",
                                { shared: "split" });
    await applyUndoChange(db.exec, change);
    // The asset row made for the test is the one extra, not undone here.
    const after = await counts(db.exec);
    expect(after.slice(1)).toEqual(before.slice(1));
    const adaBinding = (await db.exec(
      "SELECT bundle_id FROM character_asset_binding WHERE character_id = ?",
      [ada]))[0];
    expect(Number(adaBinding?.["bundle_id"])).toBe(shared);
  });

  test("remove and re-purpose each undo in one step", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const f = await asset(db.exec, "a.png");
    await attach(db.exec, registry, id, "look", [f], "identity");
    const tile = (await loadBoard(db.exec, registry, id, "look")).tiles[0];
    if (tile === undefined) throw new Error("no tile");

    const removed = await detach(db.exec, tile);
    expect(await count(db.exec, "entity_anchor")).toBe(0);
    expect(await count(db.exec, "asset")).toBe(1);   // the file stays
    await applyUndoChange(db.exec, removed);
    expect(await count(db.exec, "entity_anchor")).toBe(1);

    const moved = await repurpose(db.exec, registry, id, "look", tile, "set");
    const now = await loadBoard(db.exec, registry, id, "look");
    expect(now.tiles.map((t) => t.purpose)).toEqual(["set"]);
    await applyUndoChange(db.exec, moved);
    const back = await loadBoard(db.exec, registry, id, "look");
    expect(back.tiles.map((t) => t.purpose)).toEqual(["identity"]);
    expect(await count(db.exec, "bundle")).toBe(0);
  });

  test("confirming a proposed reference undoes to the proposal", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const f = await asset(db.exec, "a.png");
    await db.exec(
      "INSERT INTO entity_anchor (uuid, subject_type, subject_id, " +
      "anchor_type, asset_id, canonical_status) VALUES " +
      "(?, 'character', ?, 'visual', ?, 'candidate')", [newUuid(), id, f]);
    const anchor = Number((await db.exec(
      "SELECT id FROM entity_anchor"))[0]?.["id"]);
    const change = await confirmIdentity(db.exec, anchor);
    await applyUndoChange(db.exec, change);
    expect((await db.exec("SELECT canonical_status FROM entity_anchor"))[0])
      .toEqual({ canonical_status: "candidate" });
  });
});

describe("exceptions", () => {
  // A character, a baseline look, a "wounded" physical state at scene B.
  async function setup(): Promise<{ id: number; a: number; b: number;
                                    base: number; hurt: number }> {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    const scenes: number[] = [];
    for (const n of ["1", "2"]) {
      await db.exec("INSERT INTO scene (uuid, name, scene_number) " +
                    "VALUES (?, ?, ?)", [newUuid(), `SC ${n}`, n]);
      scenes.push(Number((await db.exec(
        "SELECT last_insert_rowid() AS id"))[0]?.["id"]));
    }
    await db.exec(
      "INSERT INTO performance_state (uuid, name, character_id, scene_id, " +
      "modality, persistence) VALUES (?, 'wounded', ?, ?, 'physical', " +
      "'scene_only')", [newUuid(), id, scenes[1]]);
    const base = await asset(db.exec, "base.png");
    const hurt = await asset(db.exec, "hurt.png");
    await attach(db.exec, registry, id, "look", [base], "set");
    return { id, a: scenes[0] as number, b: scenes[1] as number, base, hurt };
  }
  const inForce = async (id: number, scene: number): Promise<string[]> =>
    (await resolveMedia({ exec: db.exec, registry }, "character", id,
                        "visual_identity", scene))
      .assets_most_specific_first.map((x) => String(x["name"]));

  test("applies where Q13 says the state is in force, and only there",
       async () => {
    const { id, a, b, hurt } = await setup();
    const { bindingId } = await addException(
      db.exec, registry, id, "look", { kind: "physical", state: "wounded" },
      true);
    const board = await loadBoard(db.exec, registry, id, "look");
    const x = board.exceptions[0];
    expect(x?.when).toBe("while wounded");
    await attach(db.exec, registry, id, "look", [hurt], "set",
                 { bundleId: x?.bundleId });
    expect(await inForce(id, a)).toEqual(["base.png"]);
    // Replaces: at the wounded scene the baseline steps aside.
    expect(await inForce(id, b)).toEqual(["hurt.png"]);
    const verdicts = (await resolveMedia({ exec: db.exec, registry },
      "character", id, "visual_identity", b)).binding_verdicts;
    expect(verdicts.find((v) => v.id === bindingId)?.applies).toBe(true);
  });

  test("adding instead of replacing keeps the baseline beside it",
       async () => {
    const { id, b, hurt } = await setup();
    const { bindingId } = await addException(
      db.exec, registry, id, "look", { kind: "physical", state: "wounded" },
      false);
    const x = (await loadBoard(db.exec, registry, id, "look")).exceptions[0];
    await attach(db.exec, registry, id, "look", [hurt], "set",
                 { bundleId: x?.bundleId });
    expect((await inForce(id, b)).sort()).toEqual(["base.png", "hurt.png"]);
    await updateException(db.exec, registry, id, bindingId,
                          { replaces: true });
    expect(await inForce(id, b)).toEqual(["hurt.png"]);
  });

  test("a filter naming no state is flagged, not silently dead", async () => {
    const { id } = await setup();
    await addException(db.exec, registry, id, "look",
                       { kind: "physical", state: "drowned" }, false);
    const x = (await loadBoard(db.exec, registry, id, "look")).exceptions[0];
    expect(x?.stale).toEqual(["drowned"]);
  });

  test("the order shown is the precedence; moving undoes", async () => {
    const { id, a } = await setup();
    const first = await addException(db.exec, registry, id, "look",
      { kind: "physical", state: "wounded" }, false);
    const second = await addException(db.exec, registry, id, "look",
      { kind: "scenes", startId: a, endId: a }, false);
    const order = async (): Promise<number[]> =>
      (await loadBoard(db.exec, registry, id, "look")).exceptions
        .map((x) => x.bindingId);
    expect(await order()).toEqual([second.bindingId, first.bindingId]);
    const moved = await moveException(db.exec, registry, id, "look",
                                      first.bindingId, "up");
    expect(await order()).toEqual([first.bindingId, second.bindingId]);
    await applyUndoChange(db.exec, moved);
    expect(await order()).toEqual([second.bindingId, first.bindingId]);
  });

  test("removing takes its set with it, and undo brings all of it back",
       async () => {
    const { id, hurt } = await setup();
    const before = await counts(db.exec);
    const { change: added, bindingId } = await addException(
      db.exec, registry, id, "look", { kind: "physical", state: "wounded" },
      true);
    const x = (await loadBoard(db.exec, registry, id, "look")).exceptions[0];
    await attach(db.exec, registry, id, "look", [hurt], "set",
                 { bundleId: x?.bundleId });
    const withIt = await counts(db.exec);
    const removed = await removeException(db.exec, registry, id, bindingId);
    expect(await counts(db.exec)).toEqual(before);   // files stay: asset rows unchanged
    await applyUndoChange(db.exec, removed);
    expect(await counts(db.exec)).toEqual(withIt);
    void added;
  });

  test("a condition the owner's table cannot hold is refused", async () => {
    const id = await createCharacter(db.exec, "Eleanor Cade");
    await db.exec("INSERT INTO costume (uuid, name, character_id) " +
                  "VALUES (?, 'Mourning dress', ?)", [newUuid(), id]);
    const costume = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    await expect(addException(db.exec, registry,
      { kind: "costume", id: costume }, "look",
      { kind: "physical", state: "wounded" }, false))
      .rejects.toThrow(/cannot be scoped/);
  });
});

describe("a costume's board", () => {
  test("binds through costume_asset_binding and resolves for the costume",
       async () => {
    const id = await createCharacter(db.exec, "Ada Cade");
    await db.exec("INSERT INTO costume (uuid, name, character_id) " +
                  "VALUES (?, 'Shawl', ?)", [newUuid(), id]);
    const costume = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
    const f = await asset(db.exec, "shawl.png");
    const owner = { kind: "costume" as const, id: costume };
    await attach(db.exec, registry, owner, "look", [f], "set");
    expect(await count(db.exec, "costume_asset_binding")).toBe(1);
    expect(await count(db.exec, "character_asset_binding")).toBe(0);
    const m = await resolveMedia({ exec: db.exec, registry }, "costume",
                                 costume, "visual_identity");
    expect(m.assets_most_specific_first.map((x) => x["name"]))
      .toEqual(["shawl.png"]);
    expect(purposesFor(owner, "look")).not.toContain("identity");
    await expect(attach(db.exec, registry, owner, "look", [f], "identity"))
      .rejects.toThrow(/cannot carry/);
  });
});
