// SPDX-License-Identifier: Apache-2.0
/**
 * The first reader of `region_box` gets the first tests of it.
 *
 * Most of these are about REFUSING, which is the point: the field has
 * been writable for the whole life of the schema with nothing reading
 * it back, so anything at all could be sitting in one. A parser that
 * throws on a bad box would take down a thumbnail; a parser that
 * guesses would crop a corner of a plate and present it as somebody's
 * face.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { parseRegionBox, regionFits, visualAnchorFor }
  from "../src/anchors.ts";
import { loadRegistry, type Registry, type ScfContext }
  from "../src/index.ts";
import { openNodeDatabase } from "../src/node.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const REGISTRY = join(HERE, "..", "registry", "registry.json");

let ctx: ScfContext;

beforeAll(async () => {
  const registry: Registry = loadRegistry(
    JSON.parse(readFileSync(REGISTRY, "utf8")));
  const db = openNodeDatabase(FIXTURE, { readOnly: true });
  ctx = { exec: db.exec, registry };
});

describe("parseRegionBox", () => {
  test("reads the shape the registry's placeholder documents", () => {
    const box = parseRegionBox('{"x": 420, "y": 180, "w": 480, "h": 600}');
    expect(box).toEqual({ x: 420, y: 180, w: 480, h: 600 });
  });

  test("takes an already-parsed object as well as stored text", () => {
    expect(parseRegionBox({ x: 0, y: 0, w: 10, h: 10 }))
      .toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  test("absent is not an error", () => {
    for (const raw of [null, undefined, ""]) {
      expect(parseRegionBox(raw)).toBeNull();
    }
  });

  test("unparseable, wrong-typed and incomplete all give null", () => {
    for (const raw of ["not json", "[1,2,3,4]", "42", '"a string"',
                       '{"x":1,"y":2,"w":3}', '{"x":"a","y":2,"w":3,"h":4}']) {
      expect(parseRegionBox(raw)).toBeNull();
    }
  });

  // A zero-width box is a typo, not a region. Passing it through would
  // divide by zero in any crop that used it.
  test("a non-positive size is refused", () => {
    expect(parseRegionBox('{"x":1,"y":1,"w":0,"h":10}')).toBeNull();
    expect(parseRegionBox('{"x":1,"y":1,"w":10,"h":-4}')).toBeNull();
  });

  test("a negative origin is refused", () => {
    expect(parseRegionBox('{"x":-5,"y":0,"w":10,"h":10}')).toBeNull();
  });

  test("numeric strings are accepted — SQLite hands back what was put in",
       () => {
    expect(parseRegionBox('{"x":"10","y":"20","w":"30","h":"40"}'))
      .toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});

describe("regionFits", () => {
  const box = { x: 100, y: 100, w: 200, h: 200 };

  test("a box inside the image fits", () => {
    expect(regionFits(box, 1024, 1024)).toBe(true);
  });

  test("a box measured on a larger image does not", () => {
    expect(regionFits(box, 256, 1024)).toBe(false);
    expect(regionFits(box, 1024, 256)).toBe(false);
  });

  test("flush against the edge fits", () => {
    expect(regionFits(box, 300, 300)).toBe(true);
  });

  // Before an <img> loads, naturalWidth is 0. Answering "true" there
  // would apply a crop against dimensions nobody has yet.
  test("an unloaded image never fits", () => {
    expect(regionFits(box, 0, 0)).toBe(false);
  });
});

describe("visualAnchorFor", () => {
  test("finds Eleanor's anchor and the asset it points at", async () => {
    const found = await visualAnchorFor(ctx, "character", 1);
    expect(found).not.toBeNull();
    expect(found?.anchor["name"]).toBe("Eleanor face anchor");
    expect(found?.asset?.["identifier"])
      .toBe("@project/assets/eleanor_face_ref.png");
  });

  test("the fixture's anchor carries a readable region", async () => {
    const found = await visualAnchorFor(ctx, "character", 1);
    // Authored so this code path is exercised by a published artifact
    // rather than only by the unit tests above — the same reasoning as
    // §4.1's unscripted scene and §12.17's mismatches.
    expect(found?.region).not.toBeNull();
  });

  test("the prop anchor resolves to an asset with no thumbnail",
       async () => {
    const found = await visualAnchorFor(ctx, "prop", 1);
    expect(found?.anchor["name"]).toBe("Locket, canonical");
    // A .glb is preview tier 2. The anchor is correct and there is
    // still nothing to show, which is a state the UI has to have.
    expect(String(found?.asset?.["identifier"])).toMatch(/\.glb$/);
  });

  test("a subject with no anchor is null, not a finding", async () => {
    expect(await visualAnchorFor(ctx, "character", 2)).toBeNull();
  });

  test("an unknown subject type finds nothing", async () => {
    expect(await visualAnchorFor(ctx, "scene", 1)).toBeNull();
  });
});
