// SPDX-License-Identifier: Apache-2.0
/**
 * preview.test.ts — preview tiers (P5).
 *
 * The load-bearing assertion is that an unknown format lands in `named`
 * rather than `native`: handing an unknown extension to an <img>
 * produces a broken-image icon, which reads as "this asset is broken"
 * when the truth is "this tool does not know that format".
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { listAssets } from "../src/assetIndex.ts";
import { previewCapability } from "../src/preview.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { FIXTURE_PATH } from "./setup.ts";

describe("previewCapability", () => {
  test("browser-decodable formats are native", () => {
    expect(previewCapability("png")).toMatchObject({ tier: "native",
                                                     kind: "image" });
    expect(previewCapability("mp4")).toMatchObject({ tier: "native",
                                                     kind: "video" });
    expect(previewCapability("wav")).toMatchObject({ tier: "native",
                                                     kind: "audio" });
    expect(previewCapability("md")).toMatchObject({ tier: "native",
                                                    kind: "text" });
    expect(previewCapability("pdf")).toMatchObject({ tier: "native",
                                                     kind: "pdf" });
  });

  test("case does not matter", () => {
    expect(previewCapability("PNG").tier).toBe("native");
  });

  test("production formats are decoded, not named", () => {
    // The distinction matters: 'decoded' means there IS an image in
    // there and SCF cannot get at it yet, which is a different message
    // from 'there is nothing to look at'.
    for (const ext of ["exr", "glb", "mov", "psd", "usd"]) {
      expect(previewCapability(ext).tier, ext).toBe("decoded");
      expect(previewCapability(ext).detail, ext).not.toBeNull();
    }
  });

  test("archives and model weights are named", () => {
    expect(previewCapability("zip").tier).toBe("named");
    expect(previewCapability("safetensors").tier).toBe("named");
    // A LoRA is invoked, not looked at — there is no image of it.
    expect(previewCapability("safetensors").detail)
      .toContain("invoked");
  });

  test("an unknown format is named, never native", () => {
    const cap = previewCapability("qqq");
    expect(cap.tier).toBe("named");
    expect(cap.kind).toBeNull();
    expect(cap.detail).toContain("qqq");
  });

  test("no extension is named and says why", () => {
    expect(previewCapability(null)).toMatchObject({ tier: "named",
                                                    kind: null });
  });

  test("another .scf is named, not treated as media", () => {
    expect(previewCapability("scf").detail).toContain("layers");
  });
});

describe("the fixture's mix", () => {
  let fixture: NodeDatabase;

  beforeAll(() => {
    fixture = openNodeDatabase(FIXTURE_PATH, { readOnly: true });
  });

  afterAll(() => fixture.close());

  test("nearly half of a real project is not natively previewable",
    async () => {
      const assets = await listAssets(fixture.exec);
      const tiers = assets.map((a) => previewCapability(a.format).tier);
      // Six native since schema 2.13, which added a concept painting
      // reachable only through a polymorphic asset_relationship (§8.6).
      // The point of the test is the MIX, not the total.
      expect(tiers.filter((t) => t === "native").length).toBe(6);
      expect(tiers.filter((t) => t === "decoded").length).toBe(2); // exr, glb
      expect(tiers.filter((t) => t === "named").length).toBe(1);   // zip
      expect(tiers.filter((t) => t !== "native").length)
        .toBeGreaterThanOrEqual(3);
    });
});
