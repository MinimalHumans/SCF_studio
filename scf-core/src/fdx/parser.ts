/**
 * fdx/parser.ts — FDX import: XML → the same typed line stream Fountain
 * produces, so Stages 2–3 are shared.
 *
 * "Genuinely the easier half": FDX paragraph types are explicit, so there
 * are no classification heuristics here — only mapping. Handled per the
 * design doc:
 *  - paragraph types (Scene Heading, Action, Character, Dialogue,
 *    Parenthetical, Transition) → line types; unknown types map to
 *    action with the original type recorded
 *  - text runs with styling flattened; bold/italic/underline preserved
 *    as inline marks (offsets into the flattened text)
 *  - dual dialogue (DualDialogue wrapper) → dual flag on the second cue
 *  - scene numbers (Number attribute) → heading meta and kept for the
 *    scene entity
 *  - revision marks (RevisionID) → note-like line metadata, not text
 *  - title page (TitlePage element) → title_page lines
 *
 * The XML walk is deliberately minimal and dependency-free (elements,
 * attributes, text, the five predefined entities plus numeric refs) —
 * enough for well-formed FDX, which Final Draft always emits. Import is
 * one-way; byte round-trip is a Fountain property, not an FDX one.
 */

import type {
  CharacterMeta, FountainDocument, FountainLine, LineType,
} from "../fountain/types.ts";

// ---------------------------------------------------------------------------
// Minimal XML
// ---------------------------------------------------------------------------

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[body] ?? m;
  });
}

/** Parse a well-formed XML document into a tree. Throws on malformed. */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { tag: "", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const re =
    /<\?[^?]*\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^>\s]+)\s*>|<([^>\s/]+)((?:\s+[^>\s=]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of text.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    const [, cdata, closeTag, openTag, attrText, selfClose, textRun] = m;
    if (cdata !== undefined) {
      top.children.push(cdata);
    } else if (closeTag !== undefined) {
      if (stack.length < 2 || top.tag !== closeTag) {
        throw new Error(`mismatched </${closeTag}>`);
      }
      stack.pop();
    } else if (openTag !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (attrText ?? "")
          .matchAll(/([^\s=]+)="([^"]*)"/g)) {
        attrs[a[1]!] = decodeEntities(a[2]!);
      }
      const el: XmlElement = { tag: openTag, attrs, children: [] };
      top.children.push(el);
      if (selfClose !== "/") stack.push(el);
    } else if (textRun !== undefined) {
      if (textRun.trim() !== "") top.children.push(decodeEntities(textRun));
    }
  }
  if (stack.length !== 1) {
    throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  }
  return root;
}

function childElements(el: XmlElement, tag?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement =>
    typeof c !== "string" && (tag === undefined || c.tag === tag));
}

function findFirst(el: XmlElement, tag: string): XmlElement | null {
  for (const c of childElements(el)) {
    if (c.tag === tag) return c;
    const nested = findFirst(c, tag);
    if (nested !== null) return nested;
  }
  return null;
}

// ---------------------------------------------------------------------------
// FDX mapping
// ---------------------------------------------------------------------------

export interface InlineMark {
  start: number;
  end: number;
  styles: string[]; // e.g. ["Bold", "Italic"]
}

/** Line metadata specific to FDX import. */
export interface FdxLineMeta {
  /** Original FDX paragraph type when it had no direct mapping. */
  originalType?: string;
  /** Inline style marks over the flattened text. */
  marks?: InlineMark[];
  /** Revision identifier, recorded, never rendered as text. */
  revisionId?: string;
}

export type FdxLine = FountainLine & { fdx?: FdxLineMeta };

export interface FdxDocument extends FountainDocument {
  lines: FdxLine[];
}

const TYPE_MAP: Record<string, LineType> = {
  "Scene Heading": "heading",
  "Action": "action",
  "Character": "character",
  "Dialogue": "dialogue",
  "Parenthetical": "parenthetical",
  "Transition": "transition",
};

function flattenText(paragraph: XmlElement):
    { text: string; marks: InlineMark[] } {
  let text = "";
  const marks: InlineMark[] = [];
  for (const run of childElements(paragraph, "Text")) {
    const start = text.length;
    for (const c of run.children) {
      if (typeof c === "string") text += c;
    }
    const style = run.attrs["Style"];
    if (style !== undefined && style !== "" && text.length > start) {
      marks.push({ start, end: text.length,
                   styles: style.split("+").map((s) => s.trim()) });
    }
  }
  return { text, marks };
}

function cueMeta(text: string): CharacterMeta {
  let name = text.trim();
  const extensions: string[] = [];
  const extRe = /\(([^()]*)\)\s*$/;
  for (;;) {
    const m = extRe.exec(name);
    if (m === null) break;
    extensions.unshift(m[1] ?? "");
    name = name.slice(0, m.index).trimEnd();
  }
  return { name: name.trim(), extensions, dual: false, forced: false };
}

/** Parse FDX XML into the shared typed line stream. */
export function parseFdx(xml: string): FdxDocument {
  const root = parseXml(xml);
  const lines: FdxLine[] = [];
  let index = 0;

  const push = (type: LineType, raw: string,
                extra: Partial<FdxLine> = {}): void => {
    lines.push({ index: index++, raw, eol: "\n", type, ...extra });
  };
  const pushBlank = (): void => {
    // Fountain-shaped stream: paragraphs separated by explicit blanks so
    // Stages 2–3 see the same conventions from both importers.
    if (lines.length > 0) push("blank", "");
  };

  const emitParagraph = (p: XmlElement, dual: boolean): void => {
    const fdxType = p.attrs["Type"] ?? "General";
    const { text, marks } = flattenText(p);
    const mapped = TYPE_MAP[fdxType];
    const meta: FdxLineMeta = {};
    if (marks.length > 0) meta.marks = marks;
    if (p.attrs["RevisionID"] !== undefined) {
      meta.revisionId = p.attrs["RevisionID"];
    }
    if (mapped === undefined) meta.originalType = fdxType;
    const fdx = Object.keys(meta).length > 0 ? { fdx: meta } : {};

    // Dialogue-block members attach to the previous line without a blank.
    const attached = mapped === "dialogue" || mapped === "parenthetical";
    if (!attached) pushBlank();

    if (mapped === "heading") {
      const num = p.attrs["Number"];
      push("heading", text, {
        ...(num !== undefined && num !== ""
          ? { heading: { sceneNumber: num } } : {}),
        ...fdx,
      });
    } else if (mapped === "character") {
      push("character", text,
           { character: { ...cueMeta(text), dual }, ...fdx });
    } else {
      push(mapped ?? "action", text, fdx);
    }
  };

  const content = findFirst(root, "Content");
  if (content !== null) {
    for (const node of childElements(content)) {
      if (node.tag === "Paragraph") {
        emitParagraph(node, false);
      } else if (node.tag === "DualDialogue") {
        // Two cue groups; the second carries the dual flag (matching
        // Fountain's ^ convention).
        let cueCount = 0;
        for (const p of childElements(node, "Paragraph")) {
          const isCue = p.attrs["Type"] === "Character";
          if (isCue) cueCount++;
          emitParagraph(p, isCue && cueCount === 2);
        }
      }
    }
  }

  // Title page (optional): emitted before content, key from paragraph
  // text "Key: value" when present, else plain values.
  const titlePage = findFirst(root, "TitlePage");
  if (titlePage !== null) {
    const tpLines: FdxLine[] = [];
    let tpIndex = 0;
    for (const p of childElements(findFirst(titlePage, "Content")
                                  ?? titlePage, "Paragraph")) {
      const { text } = flattenText(p);
      if (text.trim() === "") continue;
      const key = /^([A-Za-z][A-Za-z0-9 _\-]*):\s*(.*)$/.exec(text);
      tpLines.push({
        index: tpIndex++, raw: text, eol: "\n", type: "title_page",
        titlePage: key !== null
          ? { key: key[1] ?? "", value: (key[2] ?? "").trim() }
          : { value: text.trim() },
      });
    }
    if (tpLines.length > 0) {
      tpLines.push({ index: tpIndex++, raw: "", eol: "\n",
                     type: "blank" });
      for (const l of lines) l.index += tpLines.length;
      lines.unshift(...tpLines);
    }
  }

  return { bom: false, lines };
}
