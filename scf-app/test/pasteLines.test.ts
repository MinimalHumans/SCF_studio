import { describe, expect, it } from "vitest";
import { planPasteEntries } from "../src/editor/pasteLines.ts";

/**
 * The clipboard carries text and nothing else — no payload, no smuggled
 * links, no identity travelling between documents. What still needs
 * pinning is that a paste never STEALS identity: CodeMirror's split rule
 * gives the first fragment the original line's id, so pasting above a
 * heading would hand the pasted text that heading's scene while the real
 * heading was pushed down and committed as a new one.
 */
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
