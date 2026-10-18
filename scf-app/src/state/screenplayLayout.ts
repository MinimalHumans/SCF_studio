// SPDX-License-Identifier: Apache-2.0
/**
 * screenplayLayout.ts — the committed screenplay as industry pages, and
 * as the files that carry it out of the app.
 *
 * Headless so it can be tested. The model is the one every screenplay
 * program shares: Courier 12pt, ten characters to the inch, six lines to
 * the inch, so a page is a grid of character cells and pagination is
 * arithmetic, not measurement. Element positions are Final Draft's
 * defaults (scene heading and action at the 1.5" margin, cue at 3.7",
 * dialogue 2.5"–6.0", parenthetical 3.0"–5.5"). Because the view draws
 * exactly the rows computed here, the page you read, the page you print
 * and the page count all agree.
 *
 * Pagination rules, as the trade applies them:
 *  - a scene heading, a cue or a parenthetical never ends a page;
 *  - action splits only with at least two lines either side;
 *  - a speech that crosses a page ends with (MORE) and resumes under
 *    its cue with (CONT'D);
 *  - blank lines never open a page.
 *
 * Reads blocks (screenplayDoc's `rowsToBlocks`), which already have the
 * Fountain forcing markers stripped; inline emphasis (*, **, ***, _) is
 * parsed here.
 */

import type { TitlePageRow } from "@scf-core/screenplay/rowModel.ts";
import {
  blankBetween, blocksToFountain, type Block,
} from "@scf-core/screenplay/blocks.ts";

/* ── Page geometry ────────────────────────────────────────────────── */

export type PaperSize = "letter" | "a4";

/** Body lines per page: 11" less 1" top and bottom at six lines to the
 *  inch is 54; programs run to 55–56. A4 is taller by about four. */
export const LINES_PER_PAGE: Record<PaperSize, number> = { letter: 55, a4: 58 };

/** Characters from the 1.5" left margin, and the element's width. */
const COLUMNS: Record<string, { indent: number; width: number }> = {
  heading: { indent: 0, width: 60 },
  action: { indent: 0, width: 60 },
  character: { indent: 22, width: 38 },
  parenthetical: { indent: 15, width: 25 },
  dialogue: { indent: 10, width: 35 },
  lyric: { indent: 10, width: 35 },
  transition: { indent: 0, width: 60 },
  centered: { indent: 0, width: 60 },
  // Outline material, when shown at all, sits like action.
  section: { indent: 0, width: 60 },
  synopsis: { indent: 0, width: 60 },
  note: { indent: 0, width: 60 },
};

/* ── Inline emphasis ──────────────────────────────────────────────── */

export const BOLD = 1;
export const ITALIC = 2;
export const UNDERLINE = 4;

export interface Styled {
  plain: string;
  /** A style bitmask per character of `plain`. */
  styles: number[];
}

/**
 * Fountain emphasis: *italic*, **bold**, ***both***, _underline_, and \*
 * for a literal star. A marker only opens when it is closed later in the
 * same element, so a lone asterisk prints as itself.
 */
export function parseEmphasis(src: string): Styled {
  let plain = "";
  const styles: number[] = [];
  let mask = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && (src[i + 1] === "*" || src[i + 1] === "_")) {
      plain += src[i + 1];
      styles.push(mask);
      i += 2;
      continue;
    }
    if (c === "*" || c === "_") {
      let n = 1;
      if (c === "*") while (src[i + n] === "*" && n < 3) n += 1;
      const marker = c.repeat(n);
      const bit = c === "_" ? UNDERLINE
        : n === 3 ? BOLD | ITALIC : n === 2 ? BOLD : ITALIC;
      if ((mask & bit) === bit) {
        mask &= ~bit;
        i += n;
        continue;
      }
      const after = src[i + n];
      if (after !== undefined && after !== " " &&
          src.indexOf(marker, i + n + 1) > 0) {
        mask |= bit;
        i += n;
        continue;
      }
    }
    plain += c;
    styles.push(mask);
    i += 1;
  }
  return { plain, styles };
}

/** Plain text as runs of one style each. */
export function runs(s: Styled, from = 0, to = s.plain.length):
    Array<{ text: string; style: number }> {
  const out: Array<{ text: string; style: number }> = [];
  for (let i = from; i < to; i++) {
    const st = s.styles[i] ?? 0;
    const last = out[out.length - 1];
    if (last !== undefined && last.style === st) last.text += s.plain[i];
    else out.push({ text: s.plain[i]!, style: st });
  }
  return out;
}

/* ── Wrapping ─────────────────────────────────────────────────────── */

/**
 * Word-wrap to `width` columns. Returns [start, end) offsets into the
 * text, trailing spaces excluded; a word longer than a line is broken.
 * Never returns nothing: an empty element is one empty row.
 */
export function wrap(text: string, width: number): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  let start = 0;
  const n = text.length;
  while (start < n) {
    while (start < n && text[start] === " " && rows.length > 0) start += 1;
    if (start >= n) break;
    if (n - start <= width) {
      rows.push([start, n]);
      break;
    }
    let cut = text.lastIndexOf(" ", start + width);
    if (cut <= start) {
      cut = start + width;
      rows.push([start, cut]);
      start = cut;
      continue;
    }
    rows.push([start, cut]);
    start = cut + 1;
  }
  if (rows.length === 0) rows.push([0, 0]);
  // Trim trailing spaces off each row.
  return rows.map(([a, b]) => {
    let e = b;
    while (e > a && text[e - 1] === " ") e -= 1;
    return [a, e] as [number, number];
  });
}

/* ── Layout ───────────────────────────────────────────────────────── */

export interface LayoutOptions {
  paper: PaperSize;
  /** Sections, synopses and notes: outline, not script. Off for a
   *  script sent out. */
  showOutline: boolean;
  /** Blank lines before a scene heading: 1, or 2 as many drafts use. */
  headingSpace: 1 | 2;
  /** A speaker resuming after action in the same scene reads
   *  "NAME (CONT'D)", as Final Draft adds it. */
  autoContd: boolean;
}

/** One printed row of the grid. */
export interface PageRow {
  /** The element type, for styling. */
  type: string;
  /** Leading blank lines before this row. */
  space: number;
  /** Column the row starts at, from the left margin. */
  indent: number;
  styled: Styled;
  from: number;
  to: number;
  /** On a heading's first row: its number, printed in both margins. */
  sceneNumber?: string;
  /** A row the paginator added: (MORE), or a CONT'D cue. */
  synthetic?: boolean;
}

export interface Page {
  number: number;
  rows: PageRow[];
}

interface Element {
  type: string;
  space: number;
  styled: Styled;
  rows: Array<[number, number]>;
  sceneNumber?: string;
  /** The cue's bare name, carried by every element of a speech. */
  speaker: string | null;
}

const CONTD = /\(\s*CONT['’]?D\s*\)/i;
const cueName = (cue: string): string =>
  cue.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\^\s*$/, "").trim();

function layoutText(type: string, text: string): string {
  if (type === "heading" || type === "character" ||
      type === "transition") return text.toUpperCase();
  if (type === "parenthetical") {
    const t = text.trim();
    return t.startsWith("(") ? t : `(${t})`;
  }
  return text;
}

/** Blocks → elements, each with its rows wrapped. */
export function toElements(blocks: readonly Block[],
                           sceneNumbers: ReadonlyMap<number, string>,
                           opts: LayoutOptions): Element[] {
  const out: Element[] = [];
  let speaker: string | null = null;
  let lastSpeaker: string | null = null;
  let prev: Block | null = null;
  for (const b of blocks) {
    if (!opts.showOutline &&
        (b.type === "section" || b.type === "synopsis" || b.type === "note")) {
      continue;
    }
    if (b.type === "heading") lastSpeaker = null;
    let text = layoutText(b.type, b.text);
    if (b.type === "character") {
      const name = cueName(text);
      if (opts.autoContd && name === lastSpeaker && !CONTD.test(text)) {
        text = `${text} (CONT'D)`;
      }
      speaker = name;
      lastSpeaker = name;
    } else if (b.type !== "dialogue" && b.type !== "parenthetical" &&
               b.type !== "lyric") {
      speaker = null;
    }
    const styled = parseEmphasis(text);
    const col = COLUMNS[b.type] ?? COLUMNS["action"]!;
    const rows = b.type === "character"
      ? [[0, styled.plain.length] as [number, number]]
      : wrap(styled.plain, col.width);
    let space = prev === null ? 0
      : blankBetween(prev.type, b.type) ? 1 : 0;
    if (b.type === "heading" && prev !== null) space = opts.headingSpace;
    const num = b.type === "heading" && b.sceneId !== null
      ? sceneNumbers.get(b.sceneId)
      : undefined;
    const metaNum = b.metadata?.["sceneNumber"];
    out.push({
      type: b.type, space, styled, rows,
      ...(b.type === "heading" && (num ?? metaNum) !== undefined
        ? { sceneNumber: String(num ?? metaNum) } : {}),
      speaker: b.type === "character" || b.type === "dialogue" ||
               b.type === "parenthetical" || b.type === "lyric"
        ? speaker : null,
    });
    prev = b;
  }
  return out;
}

function indentOf(el: Element, from: number, to: number): number {
  const col = COLUMNS[el.type] ?? COLUMNS["action"]!;
  const len = to - from;
  if (el.type === "transition") return Math.max(0, col.width - len);
  if (el.type === "centered") return Math.max(0, Math.floor((col.width - len) / 2));
  return col.indent;
}

function rowsOf(el: Element, space: number,
                range: Array<[number, number]>): PageRow[] {
  return range.map(([from, to], i) => ({
    type: el.type, space: i === 0 ? space : 0,
    indent: indentOf(el, from, to), styled: el.styled, from, to,
    ...(i === 0 && el.sceneNumber !== undefined
      ? { sceneNumber: el.sceneNumber } : {}),
  }));
}

function synthetic(type: string, text: string, space = 0): PageRow {
  const styled = parseEmphasis(text);
  const col = COLUMNS[type] ?? COLUMNS["action"]!;
  return { type, space, indent: col.indent, styled, from: 0,
           to: styled.plain.length, synthetic: true };
}

const KEEP_WITH_NEXT = new Set(["heading", "character", "parenthetical"]);
const SPLITTABLE = new Set(["action", "dialogue", "lyric"]);

/**
 * Elements → pages.
 *
 * Greedy, with the trade's look-ahead: before placing an element that
 * must not end a page, check that the first lines of what follows fit
 * too (two lines of it, or all of it if shorter), and break first if
 * not.
 */
export function paginate(elements: readonly Element[],
                         paper: PaperSize): Page[] {
  const L = LINES_PER_PAGE[paper];
  const pages: Page[] = [];
  let rows: PageRow[] = [];
  let used = 0;

  const breakPage = (): void => {
    pages.push({ number: pages.length + 1, rows });
    rows = [];
    used = 0;
  };
  const place = (r: PageRow[]): void => {
    for (const row of r) {
      const space = used === 0 ? 0 : row.space;
      rows.push({ ...row, space });
      used += space + 1;
    }
  };
  /** Lines `el` needs here, counting its space unless at a page top. */
  const cost = (el: Element, n = el.rows.length): number =>
    (used === 0 ? 0 : el.space) + n;
  const minLines = (el: Element): number =>
    SPLITTABLE.has(el.type) ? Math.min(2, el.rows.length) : el.rows.length;
  /** A speech resumes on a new page under its cue, CONT'D. */
  const resumeSpeech = (speaker: string | null): void => {
    if (speaker === null) return;
    place([synthetic("character", `${speaker} (CONT'D)`)]);
  };

  for (let i = 0; i < elements.length; i++) {
    let el = elements[i]!;
    const next = elements[i + 1];

    // Look ahead for elements that must not end a page.
    if (KEEP_WITH_NEXT.has(el.type) && next !== undefined && used > 0) {
      let need = cost(el) + next.space + minLines(next);
      // A heading followed by a cue keeps the cue's first line of
      // speech too.
      const after = elements[i + 2];
      if (el.type === "heading" && next.type === "character" &&
          after !== undefined) need += minLines(after);
      if (used + need > L) breakPage();
    }

    // A speech element that does not fit: split it, or carry the speech
    // over with (MORE) and (CONT'D).
    while (used + cost(el) > L) {
      const inSpeech = el.speaker !== null && el.type !== "character";
      const room = L - used - (used === 0 ? 0 : el.space) - (inSpeech ? 1 : 0);
      const total = el.rows.length;
      const take = Math.min(room, total - 2);
      if (SPLITTABLE.has(el.type) && take >= 2 && used > 0) {
        place(rowsOf(el, el.space, el.rows.slice(0, take)));
        if (inSpeech) place([synthetic("character", "(MORE)")]);
        breakPage();
        if (inSpeech) resumeSpeech(el.speaker);
        el = { ...el, space: 0, rows: el.rows.slice(take),
               sceneNumber: undefined };
        continue;
      }
      if (used === 0) {
        // Taller than a page on its own: cut it at the page.
        const fit = L;
        place(rowsOf(el, 0, el.rows.slice(0, fit)));
        breakPage();
        el = { ...el, space: 0, rows: el.rows.slice(fit), sceneNumber: undefined };
        if (el.rows.length === 0) break;
        continue;
      }
      // Whole element to the next page.
      const prevRow = rows[rows.length - 1];
      if (inSpeech && prevRow !== undefined && prevRow.type !== "character") {
        place([synthetic("character", "(MORE)")]);
        breakPage();
        resumeSpeech(el.speaker);
      } else {
        breakPage();
      }
    }
    if (el.rows.length > 0) place(rowsOf(el, el.space, el.rows));
  }
  if (rows.length > 0 || pages.length === 0) breakPage();
  return pages;
}

export function layoutScreenplay(blocks: readonly Block[],
                                 sceneNumbers: ReadonlyMap<number, string>,
                                 opts: LayoutOptions): Page[] {
  return paginate(toElements(blocks, sceneNumbers, opts), opts.paper);
}

/* ── Title page ───────────────────────────────────────────────────── */

export interface TitleLayout {
  center: Array<{ key: string; lines: string[] }>;
  left: Array<{ key: string; lines: string[] }>;
  right: Array<{ key: string; lines: string[] }>;
}

const CENTER_KEYS = ["title", "credit", "author", "authors", "source"];
const RIGHT_KEYS = ["draft date", "date", "revision"];

/**
 * Where each title-page key sits, as the trade lays one out: title,
 * credit, author and source centred; draft date bottom right; contact,
 * notes and copyright bottom left. A key nobody planned for goes bottom
 * left rather than nowhere.
 */
export function titleLayout(tp: readonly TitlePageRow[]): TitleLayout {
  const out: TitleLayout = { center: [], left: [], right: [] };
  const sorted = [...tp].sort((a, b) => a.sortOrder - b.sortOrder);
  const centerOrder = (k: string): number => CENTER_KEYS.indexOf(k);
  for (const row of sorted) {
    const key = row.key.trim().toLowerCase();
    const lines = row.value.split("\n").map((l) => l.trim())
      .filter((l) => l !== "");
    if (lines.length === 0) continue;
    const entry = { key, lines };
    if (CENTER_KEYS.includes(key)) out.center.push(entry);
    else if (RIGHT_KEYS.includes(key)) out.right.push(entry);
    else out.left.push(entry);
  }
  out.center.sort((a, b) => centerOrder(a.key) - centerOrder(b.key));
  return out;
}

/* ── Fountain ─────────────────────────────────────────────────────── */

/** Title-page rows as Fountain's `Key: value` block, continuation lines
 *  indented, a blank line after. */
export function titlePageFountain(tp: readonly TitlePageRow[]): string {
  let text = "";
  for (const row of [...tp].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = row.key.replace(/\b\w/g, (c) => c.toUpperCase());
    text += `${key}: ${row.value.split("\n").join("\n   ")}\n`;
  }
  return text === "" ? "" : `${text}\n`;
}

export function screenplayFountain(tp: readonly TitlePageRow[],
                                   blocks: Block[]): string {
  return titlePageFountain(tp) + blocksToFountain(blocks);
}

/* ── FDX ──────────────────────────────────────────────────────────── */

const FDX_TYPE: Record<string, string> = {
  heading: "Scene Heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
  centered: "Action",
  lyric: "Dialogue",
};

const xmlEscape = (s: string): string => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function fdxText(text: string, extra = 0): string {
  const s = parseEmphasis(text);
  if (s.plain === "") return "<Text></Text>";
  return runs(s).map((r) => {
    const st = r.style | extra;
    const names = [st & BOLD ? "Bold" : "", st & ITALIC ? "Italic" : "",
                   st & UNDERLINE ? "Underline" : ""].filter((n) => n !== "");
    const attr = names.length > 0 ? ` Style="${names.join("+")}"` : "";
    return `<Text${attr}>${xmlEscape(r.text)}</Text>`;
  }).join("");
}

/**
 * The screenplay as Final Draft XML.
 *
 * Paragraph types Final Draft knows; outline material (sections,
 * synopses, notes) is left out, as it is from a script sent out. A cue
 * marked dual (Fountain's ^) is wrapped with the speech before it in a
 * DualDialogue. The title page is centred and flush paragraphs the way
 * Final Draft's own are, since that is what a reader will see — values
 * only, no `Key:` labels.
 */
export function screenplayFdx(tp: readonly TitlePageRow[], blocks: readonly Block[],
                              sceneNumbers: ReadonlyMap<number, string>):
    string {
  // Speech groups, so a dual cue can take the one before it.
  const items: Array<{ kind: "plain" | "speech" | "dual"; xml: string[] }> = [];
  for (const b of blocks) {
    const type = FDX_TYPE[b.type];
    if (type === undefined) continue;
    let attrs = ` Type="${type}"`;
    if (b.type === "heading") {
      const num = (b.sceneId !== null ? sceneNumbers.get(b.sceneId) : undefined) ??
        b.metadata?.["sceneNumber"];
      if (num !== undefined && num !== null && String(num) !== "") {
        attrs = ` Number="${xmlEscape(String(num))}"` + attrs;
      }
    }
    if (b.type === "centered") attrs += ` Alignment="Center"`;
    const text = b.type === "parenthetical"
      ? layoutText("parenthetical", b.text) : b.text;
    const xml = `<Paragraph${attrs}>${fdxText(text,
      b.type === "lyric" ? ITALIC : 0)}</Paragraph>`;
    const last = items[items.length - 1];
    const open = last !== undefined && last.kind !== "plain" ? last : null;
    if (b.type === "character") {
      const dual = (b.metadata?.["character"] as { dual?: boolean } | undefined)
        ?.dual === true;
      if (dual && open !== null && open.kind === "speech") {
        open.kind = "dual";
        open.xml.push(xml);
      } else {
        items.push({ kind: "speech", xml: [xml] });
      }
    } else if ((b.type === "dialogue" || b.type === "parenthetical" ||
                b.type === "lyric") && open !== null) {
      open.xml.push(xml);
    } else {
      items.push({ kind: "plain", xml: [xml] });
    }
  }
  const content = items.flatMap((it) => it.kind === "dual"
    ? ["<DualDialogue>", ...it.xml, "</DualDialogue>"] : it.xml);

  const layout = titleLayout(tp);
  const centre = (s: string): string =>
    `<Paragraph Alignment="Center" Type="Action">${fdxText(s)}</Paragraph>`;
  const flush = (s: string, align: "Left" | "Right"): string =>
    `<Paragraph Alignment="${align}" Type="Action">${fdxText(s)}</Paragraph>`;
  const blank = '<Paragraph Type="Action"><Text></Text></Paragraph>';
  const title: string[] = [];
  if (layout.center.length > 0 || layout.left.length > 0 ||
      layout.right.length > 0) {
    for (let i = 0; i < 16; i++) title.push(blank);
    layout.center.forEach((e, i) => {
      if (i > 0) title.push(blank);
      for (const l of e.lines) title.push(centre(l));
    });
    for (let i = 0; i < 16; i++) title.push(blank);
    for (const e of layout.left) for (const l of e.lines) title.push(flush(l, "Left"));
    for (const e of layout.right) for (const l of e.lines) title.push(flush(l, "Right"));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    "<Content>",
    ...content,
    "</Content>",
    ...(title.length > 0
      ? ["<TitlePage>", "<Content>", ...title, "</Content>", "</TitlePage>"]
      : []),
    "</FinalDraft>",
    "",
  ].join("\n");
}
