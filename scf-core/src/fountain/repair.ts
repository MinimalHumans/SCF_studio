// SPDX-License-Identifier: Apache-2.0
/**
 * fountain/repair.ts — conversion-artifact repair, deliberately small.
 *
 * Scope boundary (project decision, 2026-07-17): reasonable error-proofing
 * only. Users bear responsibility for importing material that respects
 * the screenplay format's conventions; this pass exists for one situation
 * — a conventionally well-formed screenplay mangled by a PDF converter —
 * and is NOT an attempt to make garbage parse. If a file's damage goes
 * beyond these rules, the honest outcome is a degraded import the staging
 * screen makes visible, not deeper heuristics.
 *
 * Exactly one rule family, derived from the golden corpus: heading lines
 * wrapped or shredded by converter markup.
 *   - emphasis characters sprayed on/into the keyword:
 *       "_**I_NT. DARK VOID - NIGHT**"      (108× in one corpus script)
 *   - leading ">" + glued scene number before the keyword:
 *       "> 1**EXT. OCEAN - DAY**"           (124× in another)
 *       "> **865_IN_T.  SENATE ..."
 *
 * A line is repaired only when (a) the transformation actually changed
 * it and (b) the result is a conventionally-formed scene heading. Glued
 * numbers are preserved as Fountain scene numbers (#1#), never
 * discarded. Every repair is reported (before → after, rule) so the
 * import flow can show its work; this pass never runs silently inside
 * parseFountain — the caller applies it and owns the choice.
 */

// One combined regex: prefix and heading must match JOINTLY so the
// engine can backtrack a greedy number capture off a glued keyword
// ("1EXT." must resolve as number 1 + EXT., not number 1E + XT.).
const REPAIR_RE =
  /^>?\s*(\d{1,4}[A-Z]?)?[\s.-]*((?:INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s].*)$/i;

export interface RepairRecord {
  /** 0-based line index in the original text. */
  line: number;
  before: string;
  after: string;
  rule: "heading-artifact" | "mangled-apostrophe";
}

export interface RepairResult {
  text: string;
  repairs: RepairRecord[];
}

function repairHeadingLine(raw: string): string | null {
  // Strip Fountain emphasis characters wholesale; on a heading line they
  // are converter markup, and legitimate headings don't contain * or _.
  const deEmphasized = raw.replace(/[*_]/g, "");
  const m = REPAIR_RE.exec(deEmphasized.trim());
  if (m === null) return null;
  let out = (m[2] ?? "").trimEnd();
  const gluedNumber = m[1];
  if (gluedNumber !== undefined && !/#[^#]+#\s*$/.test(out)) {
    out = `${out} #${gluedNumber}#`;
  }
  return out === raw ? null : out;
}

/**
 * Apply the repair rules line by line, preserving each line's original
 * terminator. Inert on clean input: a line is only touched when a rule
 * transforms it into a well-formed heading.
 */
export function repairConversionArtifacts(input: string): RepairResult {
  const repairs: RepairRecord[] = [];
  let bom = "";
  let text = input;
  if (text.startsWith("\uFEFF")) {
    bom = "\uFEFF";
    text = text.slice(1);
  }
  const parts = text.split(/(\r\n|\n|\r)/);
  // parts alternates content, eol, content, eol, …
  for (let i = 0; i < parts.length; i += 2) {
    let raw = parts[i] ?? "";
    // Rule: export-mangled apostrophe. Some exporters (observed: Celtx)
    // bake U+0080 + U+FFFD — or a bare U+FFFD — into the text where a
    // right single quote belonged ("ALEXIS\u0080\uFFFD BEDROOM"). The
    // bytes are unrecoverable; the pattern after a letter is
    // deterministic. Replaced with an ASCII apostrophe, reported.
    if (/\uFFFD/.test(raw)) {
      const fixed = raw.replace(/(\p{L})\u0080?\uFFFD/gu, "$1'");
      if (fixed !== raw) {
        repairs.push({ line: i / 2, before: raw, after: fixed,
                       rule: "mangled-apostrophe" });
        parts[i] = fixed;
        raw = fixed;
      }
    }
    // Fast reject: rule needs emphasis chars or a ">"/digit prefix to
    // have anything to do.
    if (!/[*_]/.test(raw) && !/^\s*>/.test(raw) &&
        !/^\s*\d{1,4}[A-Z]?\s*(?:INT|EXT|EST)/i.test(raw)) {
      continue;
    }
    const repaired = repairHeadingLine(raw);
    if (repaired !== null) {
      repairs.push({ line: i / 2, before: raw, after: repaired,
                     rule: "heading-artifact" });
      parts[i] = repaired;
    }
  }
  return { text: bom + parts.join(""), repairs };
}
