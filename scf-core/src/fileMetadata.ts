// SPDX-License-Identifier: Apache-2.0
/**
 * fileMetadata.ts — reading what a file says about itself.
 *
 * Derived, never stored (conventions §2, §9). The row holds an address;
 * dimensions, channels and compression are facts about the CONTENT and
 * are read from the bytes each time they are shown. `size_bytes` and
 * `source_mtime` are the exception and stay stored, because they are
 * hints about the REFERENCE going stale rather than facts about what is
 * inside it. That line is the one to hold: no width column, ever.
 *
 * The consequence is that metadata cannot be queried, and that is the
 * accepted trade. A filter over thousands of assets would mean reading
 * thousands of files, so if something needs storing to be queried, it
 * does not get queried.
 *
 * Everything here parses HEADERS only — the first few tens of KB — so
 * nothing is decoded and nothing large is read. That makes the metadata
 * tier deliberately unlike the preview tier: an EXR cannot be displayed
 * but its header parses cleanly, and a .glb carries a JSON chunk. The
 * formats that preview worst are often the ones where this helps most,
 * because it is the only way to learn anything without opening Nuke.
 *
 * Pure: takes bytes, returns facts. No browser, no filesystem.
 */

export interface MetadataField {
  label: string;
  value: string;
}

export interface FileMetadata {
  width: number | null;
  height: number | null;
  fields: MetadataField[];
  /** Set when nothing could be read, explaining why. */
  note: string | null;
}

const NOTHING = (note: string): FileMetadata => ({
  width: null, height: null, fields: [], note,
});

function ascii(b: Uint8Array, at: number, len: number): string {
  let out = "";
  for (let i = at; i < at + len && i < b.length; i += 1) {
    out += String.fromCharCode(b[i] ?? 0);
  }
  return out;
}

const u16 = (b: Uint8Array, at: number): number =>
  ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number): number =>
  ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0);
const u32 = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) |
   ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const i32le = (b: Uint8Array, at: number): number => {
  const v = (((b[at + 3] ?? 0) << 24) | ((b[at + 2] ?? 0) << 16) |
             ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0));
  return v | 0;
};
const u32le = (b: Uint8Array, at: number): number => i32le(b, at) >>> 0;

const PNG_COLOR: Record<number, string> = {
  0: "greyscale", 2: "RGB", 3: "indexed", 4: "greyscale + alpha",
  6: "RGBA",
};

/**
 * PNG text chunks — where generated images keep their prompt.
 *
 * Midjourney writes `Description` (the prompt, flags and job id),
 * `Author` and `Creation Time`; ComfyUI writes `prompt` and `workflow`
 * as JSON; A1111 writes `parameters`. All of it is plain `tEXt`:
 * key, NUL, value. This is the most useful thing in the file for
 * anyone working with generated material, and it costs one walk of the
 * chunk list.
 *
 * `zTXt` and compressed `iTXt` are noted but not expanded — inflating
 * needs an async DecompressionStream and this parser is deliberately
 * synchronous and pure.
 */
function pngTextChunks(b: Uint8Array): MetadataField[] {
  const fields: MetadataField[] = [];
  let at = 8;

  while (at + 12 <= b.length) {
    const length = u32(b, at);
    const type = ascii(b, at + 4, 4);
    const data = at + 8;
    if (type === "IDAT" || type === "IEND") break;   // pixels start here
    if (data + length > b.length) {
      fields.push({ label: type === "tEXt" ? "text" : type,
                    value: "(chunk continues past the bytes read)" });
      break;
    }

    if (type === "tEXt") {
      let split = data;
      while (split < data + length && (b[split] ?? 0) !== 0) split += 1;
      const key = ascii(b, data, split - data);
      const value = new TextDecoder().decode(
        b.subarray(split + 1, data + length)).trim();
      if (key !== "" && value !== "") fields.push({ label: key, value });
    } else if (type === "iTXt") {
      let p = data;
      while (p < data + length && (b[p] ?? 0) !== 0) p += 1;
      const key = ascii(b, data, p - data);
      const compressed = (b[p + 1] ?? 0) === 1;
      if (compressed) {
        fields.push({ label: key, value: "(compressed text, not expanded)" });
      } else {
        // flag, method, then NUL-terminated language and translated key
        let q = p + 3;
        for (let skipped = 0; skipped < 2 && q < data + length; q += 1) {
          if ((b[q] ?? 0) === 0) skipped += 1;
        }
        const value = new TextDecoder().decode(
          b.subarray(q, data + length)).trim();
        if (key !== "" && value !== "") fields.push({ label: key, value });
      }
    } else if (type === "zTXt") {
      let split = data;
      while (split < data + length && (b[split] ?? 0) !== 0) split += 1;
      fields.push({ label: ascii(b, data, split - data),
                    value: "(compressed text, not expanded)" });
    }

    at = data + length + 4;                          // + CRC
  }
  return fields;
}

function png(b: Uint8Array): FileMetadata {
  if (ascii(b, 12, 4) !== "IHDR") return NOTHING("PNG header not found");
  const fields: MetadataField[] = [
    { label: "bit depth", value: String(b[24] ?? 0) },
  ];
  const colour = PNG_COLOR[b[25] ?? -1];
  if (colour !== undefined) fields.push({ label: "colour", value: colour });
  if ((b[28] ?? 0) === 1) {
    fields.push({ label: "interlaced", value: "yes" });
  }
  fields.push(...pngTextChunks(b));
  return { width: u32(b, 16), height: u32(b, 20), fields, note: null };
}

/** Walk JPEG segments to the frame header. */
function jpeg(b: Uint8Array): FileMetadata {
  let at = 2;
  const fields: MetadataField[] = [];
  let progressive = false;

  while (at + 4 < b.length) {
    if ((b[at] ?? 0) !== 0xff) { at += 1; continue; }
    const marker = b[at + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = u16(b, at + 2);
    if (marker === 0xe1 && ascii(b, at + 4, 4) === "Exif") {
      fields.push({ label: "EXIF", value: "present" });
    }
    // SOF0..SOF15, excluding the huffman/arithmetic/restart markers.
    const isFrame = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      progressive = marker === 0xc2;
      const components = b[at + 9] ?? 0;
      fields.push({ label: "precision",
                    value: `${b[at + 4] ?? 0}-bit` });
      fields.push({ label: "components", value: String(components) });
      if (progressive) {
        fields.push({ label: "encoding", value: "progressive" });
      }
      return { width: u16(b, at + 7), height: u16(b, at + 5), fields,
               note: null };
    }
    at += 2 + length;
  }
  return NOTHING("no JPEG frame header in the first bytes read");
}

function gif(b: Uint8Array): FileMetadata {
  return {
    width: u16le(b, 6), height: u16le(b, 8),
    fields: [{ label: "version", value: ascii(b, 3, 3) }],
    note: null,
  };
}

function webp(b: Uint8Array): FileMetadata {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") {
    const w = 1 + (((b[26] ?? 0) << 16) | ((b[25] ?? 0) << 8) |
                   (b[24] ?? 0));
    const h = 1 + (((b[29] ?? 0) << 16) | ((b[28] ?? 0) << 8) |
                   (b[27] ?? 0));
    const flags = b[20] ?? 0;
    const fields: MetadataField[] = [];
    if ((flags & 0x10) !== 0) fields.push({ label: "alpha", value: "yes" });
    if ((flags & 0x02) !== 0) {
      fields.push({ label: "animated", value: "yes" });
    }
    return { width: w, height: h, fields, note: null };
  }
  if (chunk === "VP8 ") {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff,
             fields: [{ label: "encoding", value: "lossy" }], note: null };
  }
  if (chunk === "VP8L") {
    const bits = u32le(b, 21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      fields: [{ label: "encoding", value: "lossless" }], note: null,
    };
  }
  return NOTHING("unrecognised WebP chunk");
}

function bmp(b: Uint8Array): FileMetadata {
  return { width: i32le(b, 18), height: Math.abs(i32le(b, 22)),
           fields: [], note: null };
}

const EXR_COMPRESSION = ["none", "RLE", "ZIPS", "ZIP", "PIZ", "PXR24",
                         "B44", "B44A", "DWAA", "DWAB"];

/**
 * OpenEXR attribute table.
 *
 * The reason this module exists: an EXR is tier-2 for preview — no
 * decoder — but its header is a plain list of name/type/size/value and
 * carries exactly what a compositor wants to know. Reading it needs no
 * decoding at all.
 */
function exr(b: Uint8Array): FileMetadata {
  let at = 8;                       // magic (4) + version (4)
  const fields: MetadataField[] = [];
  let width: number | null = null;
  let height: number | null = null;

  const readString = (): string | null => {
    let out = "";
    while (at < b.length) {
      const c = b[at] ?? 0;
      at += 1;
      if (c === 0) return out;
      out += String.fromCharCode(c);
      if (out.length > 255) return null;
    }
    return null;
  };

  for (let guard = 0; guard < 200; guard += 1) {
    const name = readString();
    if (name === null || name === "") break;
    const type = readString();
    if (type === null) break;
    const size = u32le(b, at);
    at += 4;
    const value = at;
    if (at + size > b.length) break;

    if (name === "dataWindow" && type === "box2i") {
      width = i32le(b, value + 8) - i32le(b, value) + 1;
      height = i32le(b, value + 12) - i32le(b, value + 4) + 1;
    } else if (name === "compression" && size >= 1) {
      const code = b[value] ?? 0;
      fields.push({ label: "compression",
                    value: EXR_COMPRESSION[code] ?? `code ${code}` });
    } else if (name === "channels" && type === "chlist") {
      const names: string[] = [];
      let p = value;
      while (p < value + size) {
        let channel = "";
        while (p < b.length && (b[p] ?? 0) !== 0) {
          channel += String.fromCharCode(b[p] ?? 0);
          p += 1;
        }
        p += 1;
        if (channel === "") break;
        names.push(channel);
        p += 16;                    // pixel type, flags, sampling
      }
      if (names.length > 0) {
        fields.push({ label: "channels", value: names.join(", ") });
      }
    } else if (type === "string" && size < 200) {
      const text = ascii(b, value + 4, Math.max(0, size - 4)).trim();
      if (text !== "") fields.push({ label: name, value: text });
    }
    at = value + size;
  }

  if (width === null && fields.length === 0) {
    return NOTHING("EXR header not readable from the bytes read");
  }
  return { width, height, fields, note: null };
}

/** glTF binary: the first chunk is JSON, which describes the scene. */
function glb(b: Uint8Array): FileMetadata {
  const jsonLength = u32le(b, 12);
  const start = 20;
  if (start + jsonLength > b.length) {
    return NOTHING("glTF JSON chunk is longer than the header read");
  }
  try {
    const text = new TextDecoder().decode(
      b.subarray(start, start + jsonLength));
    const doc = JSON.parse(text) as Record<string, unknown>;
    const fields: MetadataField[] = [];
    const asset = doc["asset"] as Record<string, unknown> | undefined;
    if (typeof asset?.["generator"] === "string") {
      fields.push({ label: "generator", value: asset["generator"] });
    }
    if (typeof asset?.["version"] === "string") {
      fields.push({ label: "glTF version", value: asset["version"] });
    }
    for (const key of ["meshes", "materials", "animations", "nodes",
                       "images"]) {
      const list = doc[key];
      if (Array.isArray(list) && list.length > 0) {
        fields.push({ label: key, value: String(list.length) });
      }
    }
    return { width: null, height: null, fields, note: null };
  } catch {
    return NOTHING("glTF JSON chunk did not parse");
  }
}

function svg(b: Uint8Array): FileMetadata {
  const text = new TextDecoder().decode(b.subarray(0, 4096));
  const box = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/
    .exec(text);
  const w = /\bwidth\s*=\s*["']([\d.]+)/.exec(text);
  const h = /\bheight\s*=\s*["']([\d.]+)/.exec(text);
  const width = w !== null ? Number(w[1]) : box !== null
    ? Number(box[1]) : null;
  const height = h !== null ? Number(h[1]) : box !== null
    ? Number(box[2]) : null;
  const fields: MetadataField[] = [];
  if (box !== null) {
    fields.push({ label: "viewBox", value: `${box[1]} × ${box[2]}` });
  }
  if (width === null && height === null && fields.length === 0) {
    return NOTHING("no dimensions declared in this SVG");
  }
  return { width, height, fields, note: null };
}

/**
 * What a file's header says, from its leading bytes.
 *
 * Dispatched on the magic number rather than the extension: the
 * extension is a hint about bytes and can be wrong, and here the bytes
 * themselves are in hand.
 */
export function readHeaderMetadata(bytes: Uint8Array): FileMetadata {
  const b = bytes;
  if (b.length < 16) return NOTHING("too few bytes to identify");

  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return png(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (ascii(b, 0, 3) === "GIF") return gif(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  if (ascii(b, 0, 2) === "BM") return bmp(b);
  if (b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01) {
    return exr(b);
  }
  if (ascii(b, 0, 4) === "glTF") return glb(b);
  const head = new TextDecoder().decode(b.subarray(0, 200));
  if (head.includes("<svg") || head.includes("<?xml")) return svg(b);

  return NOTHING("this format does not declare a header we can read");
}

/** How much of a file to read. Every parser above works well within it. */
export const HEADER_BYTES = 96 * 1024;
