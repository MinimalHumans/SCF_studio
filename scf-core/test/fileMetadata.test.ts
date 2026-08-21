// SPDX-License-Identifier: Apache-2.0
/**
 * fileMetadata.test.ts — reading headers without decoding (P5 follow-on).
 *
 * Buffers are built by hand rather than checked in as binaries: the
 * point is that the parsers read the byte layout correctly, and a
 * fixture file would hide which offset was actually being tested.
 */

import { describe, expect, test } from "vitest";
import { readHeaderMetadata } from "../src/fileMetadata.ts";

function bytes(...parts: (number | string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const c of part) out.push(c.charCodeAt(0));
    } else if (Array.isArray(part)) {
      out.push(...part);
    } else {
      out.push(part);
    }
  }
  return new Uint8Array(out);
}

const be32 = (n: number): number[] =>
  [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number): number[] =>
  [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];

describe("PNG", () => {
  const png = (w: number, h: number, depth = 8, colour = 6): Uint8Array =>
    bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR",
          be32(w), be32(h), [depth, colour, 0, 0, 0], be32(0));

  test("reads dimensions from IHDR", () => {
    const meta = readHeaderMetadata(png(1920, 1080));
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.note).toBeNull();
  });

  test("reports depth and colour type", () => {
    const meta = readHeaderMetadata(png(8, 8, 16, 2));
    expect(meta.fields).toContainEqual({ label: "bit depth", value: "16" });
    expect(meta.fields).toContainEqual({ label: "colour", value: "RGB" });
  });
});

describe("JPEG", () => {
  test("walks segments to the frame header", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0], be16(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
      [0xff, 0xc0], be16(17), [8], be16(720), be16(1280),
      [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const meta = readHeaderMetadata(jpeg);
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
    expect(meta.fields).toContainEqual({ label: "components", value: "3" });
  });

  test("notices EXIF and progressive encoding", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe1], be16(10), "Exif", [0, 0, 0, 0],
      [0xff, 0xc2], be16(17), [8], be16(100), be16(200),
      [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const meta = readHeaderMetadata(jpeg);
    expect(meta.fields).toContainEqual({ label: "EXIF", value: "present" });
    expect(meta.fields).toContainEqual({ label: "encoding",
                                         value: "progressive" });
  });

  test("a truncated jpeg reports rather than guessing", () => {
    const meta = readHeaderMetadata(bytes([0xff, 0xd8], new Array(40).fill(0)));
    expect(meta.width).toBeNull();
    expect(meta.note).not.toBeNull();
  });
});

describe("GIF and BMP", () => {
  test("GIF dimensions are little-endian", () => {
    const meta = readHeaderMetadata(
      bytes("GIF89a", [0x20, 0x03], [0xc0, 0x02], new Array(8).fill(0)));
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(704);
  });

  test("BMP reads the DIB header", () => {
    const meta = readHeaderMetadata(
      bytes("BM", new Array(16).fill(0), le32(640), le32(-480),
            new Array(8).fill(0)));
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);   // negative height is top-down
  });
});

describe("WebP", () => {
  test("VP8X carries 24-bit dimensions minus one", () => {
    const meta = readHeaderMetadata(bytes(
      "RIFF", le32(30), "WEBP", "VP8X", le32(10),
      [0x10, 0, 0, 0],
      [(4095) & 255, (4095 >> 8) & 255, 0],
      [(2159) & 255, (2159 >> 8) & 255, 0],
      new Array(8).fill(0)));
    expect(meta.width).toBe(4096);
    expect(meta.height).toBe(2160);
    expect(meta.fields).toContainEqual({ label: "alpha", value: "yes" });
  });
});

describe("OpenEXR", () => {
  /** name\\0 type\\0 size(4) value — the whole attribute table format. */
  function attribute(name: string, type: string,
                     value: number[]): number[] {
    const out: number[] = [];
    for (const c of name) out.push(c.charCodeAt(0));
    out.push(0);
    for (const c of type) out.push(c.charCodeAt(0));
    out.push(0);
    out.push(...le32(value.length));
    out.push(...value);
    return out;
  }

  const exr = bytes(
    [0x76, 0x2f, 0x31, 0x01], le32(2),
    attribute("dataWindow", "box2i",
              [...le32(0), ...le32(0), ...le32(2047), ...le32(1151)]),
    attribute("compression", "compression", [3]),
    attribute("channels", "chlist", [
      ...("R".split("").map((c) => c.charCodeAt(0))), 0,
      ...new Array(16).fill(0),
      ...("G".split("").map((c) => c.charCodeAt(0))), 0,
      ...new Array(16).fill(0),
      0]),
    [0]);

  test("a format with no preview still yields its header", () => {
    // The point of the module: EXR is tier 2 for display and tier 1 for
    // metadata.
    const meta = readHeaderMetadata(exr);
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(1152);
  });

  test("reads compression and channel names", () => {
    const meta = readHeaderMetadata(exr);
    expect(meta.fields).toContainEqual({ label: "compression",
                                         value: "ZIP" });
    expect(meta.fields).toContainEqual({ label: "channels",
                                         value: "R, G" });
  });
});

describe("glTF binary", () => {
  test("reads the JSON chunk's summary", () => {
    const json = JSON.stringify({
      asset: { version: "2.0", generator: "Houdini" },
      meshes: [{}, {}], materials: [{}],
    });
    const glb = bytes("glTF", le32(2), le32(0), le32(json.length),
                      "JSON", json);
    const meta = readHeaderMetadata(glb);
    expect(meta.fields).toContainEqual({ label: "generator",
                                         value: "Houdini" });
    expect(meta.fields).toContainEqual({ label: "meshes", value: "2" });
    expect(meta.width).toBeNull();
  });
});

describe("SVG", () => {
  test("prefers declared dimensions, falls back to viewBox", () => {
    const meta = readHeaderMetadata(
      bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
            new Array(16).fill(32)));
    expect(meta.width).toBe(24);
    expect(meta.fields).toContainEqual({ label: "viewBox",
                                         value: "24 × 24" });
  });
});

describe("unknown input", () => {
  test("says it cannot read rather than inventing", () => {
    const meta = readHeaderMetadata(bytes(new Array(64).fill(7)));
    expect(meta.width).toBeNull();
    expect(meta.fields).toEqual([]);
    expect(meta.note).not.toBeNull();
  });

  test("an empty file is handled", () => {
    expect(readHeaderMetadata(new Uint8Array(0)).note).not.toBeNull();
  });
});

describe("PNG text chunks", () => {
  /** length, type, data, CRC — the CRC is never checked, so it is zero. */
  function chunk(type: string, data: number[]): number[] {
    return [...be32(data.length),
            ...type.split("").map((c) => c.charCodeAt(0)),
            ...data, 0, 0, 0, 0];
  }
  const text = (key: string, value: string): number[] => [
    ...key.split("").map((c) => c.charCodeAt(0)), 0,
    ...value.split("").map((c) => c.charCodeAt(0)),
  ];

  const withChunks = (...extra: number[][]): Uint8Array => bytes(
    [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a],
    chunk("IHDR", [...be32(896), ...be32(1152), 8, 6, 0, 0, 0]),
    ...extra,
    chunk("IDAT", [1, 2, 3]));

  test("reads a generator's prompt out of tEXt", () => {
    // This is the reason the walk exists: the prompt is the most
    // useful thing in a generated image and it lives here.
    const meta = readHeaderMetadata(withChunks(
      chunk("tEXt", text("Description",
                         "A portrait of a confident man --ar 3:4")),
      chunk("tEXt", text("Author", "blckbox"))));
    expect(meta.width).toBe(896);
    expect(meta.fields).toContainEqual({
      label: "Description",
      value: "A portrait of a confident man --ar 3:4",
    });
    expect(meta.fields).toContainEqual({ label: "Author",
                                         value: "blckbox" });
  });

  test("stops at the pixel data rather than scanning the whole file", () => {
    const meta = readHeaderMetadata(withChunks(
      chunk("tEXt", text("before", "kept"))));
    expect(meta.fields.some((f) => f.label === "before")).toBe(true);
  });

  test("compressed text is named, not silently dropped", () => {
    const meta = readHeaderMetadata(withChunks(
      chunk("zTXt", [...text("parameters", ""), 0, 0x78, 0x9c])));
    expect(meta.fields).toContainEqual({
      label: "parameters", value: "(compressed text, not expanded)",
    });
  });

  test("an empty value is skipped", () => {
    const meta = readHeaderMetadata(withChunks(
      chunk("tEXt", text("Empty", ""))));
    expect(meta.fields.some((f) => f.label === "Empty")).toBe(false);
  });

  test("a chunk running past the bytes read says so", () => {
    // A ComfyUI workflow can exceed the header slice; claiming the
    // file has no metadata would be wrong.
    const truncated = bytes(
      [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a],
      chunk("IHDR", [...be32(64), ...be32(64), 8, 6, 0, 0, 0]),
      be32(500000), "tEXt", text("workflow", "{"));
    const meta = readHeaderMetadata(truncated);
    expect(meta.fields.some((f) =>
      f.value.includes("continues past"))).toBe(true);
  });
});
