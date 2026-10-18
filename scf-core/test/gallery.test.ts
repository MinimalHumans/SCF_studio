// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "../src/node.ts";
import {
  describeUses, extensionOf, filterItems, loadGallery, presentItems,
  scoreOf, sortItems,
  type GalleryItem, type Use,
} from "../src/gallery.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));
let db: ReturnType<typeof openNodeDatabase>;
let items: GalleryItem[];
beforeAll(async () => {
  db = openNodeDatabase(FIXTURE, { readOnly: true });
  items = await loadGallery(db.exec);
});
afterAll(() => db.close());

const named = (n: string): GalleryItem =>
  items.find((i) => i.asset["name"] === n)!;

describe("what the gallery reads from the fixture", () => {
  test("every current asset, with its kind from the extension", () => {
    expect(items.length).toBeGreaterThan(40);
    expect(named("eleanor_face_anchor.png").kind).toBe("image");
    expect(named("eleanor_face_video.mp4").kind).toBe("video");
    expect(named("chime_hero_takes.wav").kind).toBe("audio");
  });

  test("a character's anchor reaches the character", () => {
    const uses = named("eleanor_face_anchor.png").uses;
    expect(uses.some((u) => u.subject?.kind === "character" &&
                            /eleanor/i.test(u.subject.name))).toBe(true);
  });

  test("the poster is used by the project", () => {
    expect(named("poster01.png").uses
      .some((u) => u.subject?.kind === "project" && u.how === "poster")).toBe(true);
  });

  test("a lead's face outranks a one-scene prop, which outranks nothing", () => {
    const face = named("eleanor_face_anchor.png").score;
    const unused = items.filter((i) => i.uses.length === 0);
    expect(face).toBeGreaterThan(named("kettle_baseline.png").score);
    for (const u of unused) expect(u.score).toBe(0);
  });

  test("the visual filter keeps pictures and moving pictures", () => {
    const visual = filterItems(items, "all", true);
    expect(visual.every((i) => i.kind === "image" || i.kind === "video")).toBe(true);
    expect(visual.length).toBeLessThan(items.length);
  });

  test("filters by what the asset serves", () => {
    const props = filterItems(items, "prop", false);
    expect(props.map((i) => i.asset["name"])).toContain("kettle_baseline.png");
    expect(props.map((i) => i.asset["name"])).not.toContain("eleanor_face_anchor.png");
  });
});

describe("ranking", () => {
  const subject = (id: number): Use["subject"] =>
    ({ kind: "character", id, name: `C${String(id)}` });

  test("each subject counts once, weighted by its scenes", () => {
    const weight = new Map([["character:1", 10], ["character:2", 1]]);
    const uses: Use[] = [
      { subject: subject(1), how: "look board" },
      { subject: subject(1), how: "face anchor" },
      { subject: subject(2), how: "look board" },
      { subject: null, how: "derived from" },
    ];
    // 4 direct uses + (1 + 10) + (1 + 1).
    expect(scoreOf(uses, weight)).toBe(17);
  });

  test("random is stable for a seed and changes with it", () => {
    const a = sortItems(items, "random", 7).map((i) => i.asset["id"]);
    const b = sortItems([...items].reverse(), "random", 7).map((i) => i.asset["id"]);
    const c = sortItems(items, "random", 8).map((i) => i.asset["id"]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("alphabetical is natural order", () => {
    const names = sortItems(items, "alphabetical").map((i) => String(i.asset["name"]));
    expect(names.indexOf("demo_kitchen_day_01.png"))
      .toBeLessThan(names.indexOf("demo_kitchen_day_02.png"));
    expect(names[0]!.toLowerCase() <= names[1]!.toLowerCase()).toBe(true);
  });

  test("importance puts the highest score first", () => {
    const s = sortItems(items, "importance").map((i) => i.score);
    expect(s).toEqual([...s].sort((x, y) => y - x));
  });
});

describe("small pieces", () => {
  test("extensions", () => {
    expect(extensionOf("@project/a/b.PNG")).toBe("png");
    expect(extensionOf("noext")).toBeNull();
    expect(extensionOf(null)).toBeNull();
  });

  test("uses read per subject", () => {
    expect(describeUses([
      { subject: { kind: "character", id: 1, name: "Eleanor" }, how: "look board" },
      { subject: { kind: "character", id: 1, name: "Eleanor" }, how: "face anchor" },
      { subject: null, how: "derived from" },
    ])).toEqual(["Eleanor — look board, face anchor", "derived from"]);
  });
});

describe("only files that are there", () => {
  const item = (id: number): GalleryItem => ({
    asset: { id, name: `a${String(id)}` }, kind: "image", uses: [], score: 0,
  });
  const list = [item(1), item(2), item(3), item(4)];
  const states = new Map([[1, "resolved"], [2, "missing"], [3, "resolved"]]);

  test("missing, unresolved-yet and broken files are left out", () => {
    expect(presentItems(list, states, new Set([3]), false)
      .map((i) => i.asset["id"])).toEqual([1]);
  });

  test("everything when asked for", () => {
    expect(presentItems(list, states, new Set([3]), true)).toHaveLength(4);
  });
});
