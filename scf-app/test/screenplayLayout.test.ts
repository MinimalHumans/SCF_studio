// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { parseFdx } from "@scf-core/fdx/parser.ts";
import type { Block } from "../src/editor/screenplayDoc.ts";
import {
  BOLD, ITALIC, layoutScreenplay, LINES_PER_PAGE, parseEmphasis, runs,
  screenplayFdx, screenplayFountain, titleLayout, UNDERLINE, wrap,
  type LayoutOptions, type Page,
} from "../src/state/screenplayLayout.ts";

let n = 0;
const block = (type: Block["type"], text: string,
               extra: Partial<Block> = {}): Block => ({
  id: `b${String(n++)}`, type, text, sceneId: null, characterId: null,
  locationId: null, metadata: null, ...extra,
});

const OPTS: LayoutOptions = {
  paper: "letter", showOutline: false, headingSpace: 1, autoContd: true,
};

const text = (p: Page): string[] =>
  p.rows.map((r) => r.styled.plain.slice(r.from, r.to));

describe("wrapping on the character grid", () => {
  test("wraps at word boundaries within the width", () => {
    const s = "one two three four five";
    expect(wrap(s, 9).map(([a, b]) => s.slice(a, b)))
      .toEqual(["one two", "three", "four five"]);
  });

  test("breaks a word longer than the line", () => {
    const s = "abcdefghij";
    expect(wrap(s, 4).map(([a, b]) => s.slice(a, b)))
      .toEqual(["abcd", "efgh", "ij"]);
  });

  test("an empty element is still one row", () => {
    expect(wrap("", 10)).toEqual([[0, 0]]);
  });
});

describe("emphasis", () => {
  test("bold, italic, both and underline", () => {
    const s = parseEmphasis("a **b** *c* ***d*** _e_");
    expect(s.plain).toBe("a b c d e");
    const styleAt = (ch: string): number => s.styles[s.plain.indexOf(ch)]!;
    expect(styleAt("b")).toBe(BOLD);
    expect(styleAt("c")).toBe(ITALIC);
    expect(styleAt("d")).toBe(BOLD | ITALIC);
    expect(styleAt("e")).toBe(UNDERLINE);
    expect(styleAt("a")).toBe(0);
  });

  test("a lone or escaped star prints as itself", () => {
    expect(parseEmphasis("5 * 3").plain).toBe("5 * 3");
    expect(parseEmphasis("\\*not\\*").plain).toBe("*not*");
  });

  test("runs group a style", () => {
    expect(runs(parseEmphasis("x **yy** z")))
      .toEqual([{ text: "x ", style: 0 }, { text: "yy", style: BOLD },
                { text: " z", style: 0 }]);
  });
});

describe("pagination", () => {
  const actionLine = "Action action action.";

  test("a page holds the page's lines and no more", () => {
    const blocks = Array.from({ length: 60 }, () => block("action", actionLine));
    const pages = layoutScreenplay(blocks, new Map(), OPTS);
    const L = LINES_PER_PAGE.letter;
    for (const p of pages) {
      const lines = p.rows.reduce((t, r) => t + r.space + 1, 0);
      expect(lines).toBeLessThanOrEqual(L);
    }
    // 60 one-line paragraphs, a blank between each: 119 lines.
    expect(pages).toHaveLength(3);
    // No page opens on a blank.
    for (const p of pages) expect(p.rows[0]!.space).toBe(0);
  });

  test("a scene heading never ends a page", () => {
    // 26 paragraphs = 51 lines; a heading would land on 53 with its
    // action on 55–56.
    const blocks = [
      ...Array.from({ length: 26 }, () => block("action", actionLine)),
      block("heading", "INT. HOUSE - DAY"),
      block("action", "Long ".repeat(30)),
    ];
    const pages = layoutScreenplay(blocks, new Map(), OPTS);
    expect(pages).toHaveLength(2);
    expect(text(pages[1]!)[0]).toBe("INT. HOUSE - DAY");
  });

  test("a speech across a page ends with (MORE) and resumes (CONT'D)", () => {
    const blocks = [
      ...Array.from({ length: 25 }, () => block("action", actionLine)),
      block("character", "ELEANOR"),
      // Ten wrapped lines of dialogue.
      block("dialogue", "word ".repeat(68)),
    ];
    const pages = layoutScreenplay(blocks, new Map(), OPTS);
    expect(pages).toHaveLength(2);
    const first = text(pages[0]!);
    expect(first[first.length - 1]).toBe("(MORE)");
    expect(text(pages[1]!)[0]).toBe("ELEANOR (CONT'D)");
  });

  test("a speaker resuming after action is CONT'D, unless turned off", () => {
    const blocks = [
      block("heading", "INT. KITCHEN - DAY"),
      block("character", "ELEANOR"), block("dialogue", "Shut it."),
      block("action", "He does not."),
      block("character", "ELEANOR"), block("dialogue", "Shut it."),
    ];
    const cues = (o: LayoutOptions): string[] =>
      text(layoutScreenplay(blocks, new Map(), o)[0]!)
        .filter((t) => t.startsWith("ELEANOR"));
    expect(cues(OPTS)).toEqual(["ELEANOR", "ELEANOR (CONT'D)"]);
    expect(cues({ ...OPTS, autoContd: false })).toEqual(["ELEANOR", "ELEANOR"]);
  });

  test("outline material is left out unless asked for", () => {
    const blocks = [block("section", "# Act 1"), block("heading", "EXT. ROAD - DAY")];
    expect(text(layoutScreenplay(blocks, new Map(), OPTS)[0]!))
      .toEqual(["EXT. ROAD - DAY"]);
    expect(text(layoutScreenplay(blocks, new Map(),
                                 { ...OPTS, showOutline: true })[0]!))
      .toContain("# Act 1");
  });

  test("headings carry the scene's number and transitions sit right", () => {
    const blocks = [
      block("heading", "ext. road - day", { sceneId: 7 }),
      block("transition", "CUT TO:"),
    ];
    const [page] = layoutScreenplay(blocks, new Map([[7, "12A"]]), OPTS);
    expect(page!.rows[0]!.sceneNumber).toBe("12A");
    expect(text(page!)[0]).toBe("EXT. ROAD - DAY");
    const cut = page!.rows[1]!;
    expect(cut.indent + (cut.to - cut.from)).toBe(60);
  });
});

describe("title page", () => {
  const tp = [
    { key: "contact", value: "me@example.com", sortOrder: 4 },
    { key: "title", value: "HOLLOW CREEK", sortOrder: 0 },
    { key: "author", value: "Minimal Humans", sortOrder: 2 },
    { key: "credit", value: "Written by", sortOrder: 1 },
    { key: "draft date", value: "1889", sortOrder: 3 },
  ];

  test("centred, bottom left and bottom right", () => {
    const t = titleLayout(tp);
    expect(t.center.map((e) => e.key)).toEqual(["title", "credit", "author"]);
    expect(t.right.map((e) => e.key)).toEqual(["draft date"]);
    expect(t.left.map((e) => e.key)).toEqual(["contact"]);
  });

  test("Fountain writes it as a key block before the script", () => {
    const out = screenplayFountain(tp, [block("heading", "EXT. ROAD - DAY")]);
    expect(out.startsWith("Title: HOLLOW CREEK\nCredit: Written by\n")).toBe(true);
    expect(out).toContain("Draft Date: 1889\n");
    expect(out).toContain("\n\nEXT. ROAD - DAY\n");
  });
});

describe("FDX", () => {
  const blocks = [
    block("heading", "INT. KITCHEN - DAY", { sceneId: 3 }),
    block("action", "She does **not** turn & stays."),
    block("character", "ELEANOR"),
    block("parenthetical", "quietly"),
    block("dialogue", "Shut it."),
    block("character", "MARCUS", {
      metadata: { character: { name: "MARCUS", dual: true } } }),
    block("dialogue", "No."),
    block("transition", "CUT TO:"),
    block("section", "# Act 1"),
  ];
  const xml = screenplayFdx([{ key: "title", value: "HOLLOW", sortOrder: 0 }],
                            blocks, new Map([[3, "3"]]));

  test("reads back through the FDX importer as the same script", () => {
    const doc = parseFdx(xml);
    const body = doc.lines.filter((l) => l.type !== "blank" &&
                                         l.type !== "title_page");
    expect(body.map((l) => [l.type, l.raw])).toEqual([
      ["heading", "INT. KITCHEN - DAY"],
      ["action", "She does not turn & stays."],
      ["character", "ELEANOR"],
      ["parenthetical", "(quietly)"],
      ["dialogue", "Shut it."],
      ["character", "MARCUS"],
      ["dialogue", "No."],
      ["transition", "CUT TO:"],
    ]);
    expect(body[0]!.heading?.sceneNumber).toBe("3");
    // The second cue of a dual pair comes back dual.
    expect(body[5]!.character?.dual).toBe(true);
  });

  test("emphasis becomes styled runs, and XML is escaped", () => {
    expect(xml).toContain('<Text Style="Bold">not</Text>');
    expect(xml).toContain("&amp;");
    expect(xml).toContain("<DualDialogue>");
    expect(xml).not.toContain("Act 1");
  });

  test("the title page is there, as values", () => {
    expect(xml).toMatch(/<TitlePage>[\s\S]*HOLLOW[\s\S]*<\/TitlePage>/);
  });
});
