import { describe, expect, it } from "vitest";
import {
  decodeClip, encodeClip, planPasteEntries, resolvePaste,
  type ClipLine, type ClipPayload,
} from "../src/editor/clipboard.ts";

const line = (over: Partial<ClipLine> = {}): ClipLine => ({
  uuid: "u1", type: "action", text: "He waits.", whole: true,
  sceneId: null, characterId: null, locationId: null, ...over,
});

const payload = (lines: ClipLine[], project = "P"): ClipPayload =>
  ({ v: 1, project, lines });

let n = 0;
const mint = (): string => `new-${String(++n)}`;
const resolve = (p: ClipPayload, live: string[], project = "P") => {
  n = 0;
  return resolvePaste(p, {
    project, liveIds: new Set(live), mint,
  });
};

describe("clipboard payload", () => {
  it("round-trips", () => {
    const p = payload([line(), line({ uuid: "u2", type: "heading" })]);
    expect(decodeClip(encodeClip(p))).toEqual(p);
  });

  it("rejects anything that is not ours", () => {
    expect(decodeClip(null)).toBeNull();
    expect(decodeClip("")).toBeNull();
    expect(decodeClip("INT. KITCHEN - DAY")).toBeNull();
    expect(decodeClip(JSON.stringify({ v: 2, project: "P", lines: [] })))
      .toBeNull();
    expect(decodeClip(JSON.stringify({ v: 1, project: "P" }))).toBeNull();
  });
});

describe("paste identity", () => {
  it("moves when the source lines are gone: uuids and links survive", () => {
    const p = payload([
      line({ uuid: "h1", type: "heading", text: "INT. MOON BASE - DAY",
             sceneId: 7 }),
      line({ uuid: "a1", type: "action", text: "Dust settles." }),
    ]);
    const r = resolve(p, ["other"]);
    expect(r.mode).toBe("move");
    expect(r.lines.map((l) => l.id)).toEqual(["h1", "a1"]);
    // The whole point: a moved scene keeps its entity rather than
    // leaving an orphaned duplicate behind.
    expect(r.lines[0]!.sceneId).toBe(7);
  });

  it("copies when the source lines are still in the document", () => {
    const p = payload([line({ uuid: "a1", characterId: 3 })]);
    const r = resolve(p, ["a1"]);
    expect(r.mode).toBe("copy");
    expect(r.lines[0]!.id).toBe("new-1");
    // Type and speaker carry; a duplicated cue is still that character.
    expect(r.lines[0]!.type).toBe("action");
    expect(r.lines[0]!.characterId).toBe(3);
  });

  it("a copied heading never claims the original's scene", () => {
    const p = payload([
      line({ uuid: "h1", type: "heading", sceneId: 7, locationId: 2 }),
    ]);
    const r = resolve(p, ["h1"]);
    expect(r.mode).toBe("copy");
    expect(r.lines[0]!.sceneId).toBeNull();
    expect(r.lines[0]!.locationId).toBe(2);
  });

  it("never reuses identity across projects", () => {
    const p = payload([line({ uuid: "a1" })], "OTHER-FILE");
    const r = resolve(p, []);
    expect(r.mode).toBe("copy");
    expect(r.lines[0]!.id).toBe("new-1");
  });

  it("a partial line forces copy for the whole payload", () => {
    // Half a line cannot move: the original still exists holding the
    // rest of its text, and two lines cannot share one uuid.
    const p = payload([
      line({ uuid: "a1", whole: false }),
      line({ uuid: "a2" }),
    ]);
    const r = resolve(p, []);
    expect(r.mode).toBe("copy");
    expect(r.lines.map((l) => l.id)).toEqual(["new-1", "new-2"]);
  });

  it("keeps type for every line, which is the bug it exists to fix", () => {
    const p = payload([
      line({ uuid: "h", type: "heading", text: "INT. BAR - NIGHT" }),
      line({ uuid: "c", type: "character", text: "ALEXIS" }),
      line({ uuid: "d", type: "dialogue", text: "Not tonight." }),
      line({ uuid: "a", type: "action", text: "She leaves." }),
    ]);
    const r = resolve(p, ["h", "c", "d", "a"]);
    expect(r.lines.map((l) => l.type))
      .toEqual(["heading", "character", "dialogue", "action"]);
    expect(r.text).toBe(
      "INT. BAR - NIGHT\nALEXIS\nNot tonight.\nShe leaves.");
  });
});

describe("paste entry placement", () => {
  const doc = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ id: `L${String(i)}`, type: "action" as const }));
  const pasted = [
    { id: "P0", type: "heading" as const },
    { id: "P1", type: "character" as const },
    { id: "P2", type: "dialogue" as const },
  ];

  it("a block insert pushes the landing line DOWN with its id", () => {
    // Dropping a cut scene on another scene's heading is how you move
    // one. The landing heading must survive intact: it keeps its
    // identity and therefore its scene link, and the pasted lines sit
    // above it as their own lines.
    const next = planPasteEntries(doc(4), pasted, {
      firstLine: 2, lastLine: 2, atLineStart: true, blockInsert: true,
    });
    expect(next.map((e) => e.id))
      .toEqual(["L0", "P0", "P1", "P2", "L1", "L2", "L3"]);
    expect(next.map((e) => e.type)).toEqual([
      "action", "heading", "character", "dialogue",
      "action", "action", "action",
    ]);
  });

  it("a fragment pasted at a line start merges into that line", () => {
    // Not whole lines, so no trailing newline is inserted and the last
    // pasted fragment splices onto the existing text — ordinary editor
    // behaviour, and the existing line's entry goes with the merge.
    const next = planPasteEntries(doc(4), pasted, {
      firstLine: 2, lastLine: 2, atLineStart: true, blockInsert: false,
    });
    expect(next.map((e) => e.id))
      .toEqual(["L0", "P0", "P1", "P2", "L2", "L3"]);
  });

  it("a mid-line paste continues that line, which keeps its identity", () => {
    const next = planPasteEntries(doc(4), pasted, {
      firstLine: 2, lastLine: 2, atLineStart: false, blockInsert: false,
    });
    expect(next.map((e) => e.id))
      .toEqual(["L0", "L1", "P1", "P2", "L2", "L3"]);
  });

  it("replacing a multi-line selection consumes exactly those lines", () => {
    const next = planPasteEntries(doc(6), pasted, {
      firstLine: 2, lastLine: 4, atLineStart: true, blockInsert: false,
    });
    expect(next.map((e) => e.id))
      .toEqual(["L0", "P0", "P1", "P2", "L4", "L5"]);
  });

  it("stays aligned: one entry per resulting line, always", () => {
    // The count is derived from the SAME rules the dispatch uses to
    // build the text, so a drift between them fails here rather than
    // as a misaligned gutter three edits later.
    for (const atLineStart of [true, false]) {
      for (const blockInsert of [true, false]) {
        for (let first = 1; first <= 4; first++) {
          for (let last = first; last <= 4; last++) {
            if (blockInsert && (!atLineStart || first !== last)) continue;
            const next = planPasteEntries(doc(4), pasted,
              { firstLine: first, lastLine: last, atLineStart,
                blockInsert });
            const expected = blockInsert
              // nothing consumed; a trailing newline is inserted
              ? 4 + pasted.length
              // lines first..last are consumed by the replacement
              : (first - 1) + pasted.length + (4 - last);
            expect(next).toHaveLength(expected);
          }
        }
      }
    }
  });
});
