/**
 * editor/lineState.ts — line identity and line type as CodeMirror state.
 *
 * The design's central commitment (Part 3): line identity lives in editor
 * state, not in text diffing. A StateField holds one {id, type} entry per
 * document line and maps it through every transaction:
 *
 *  - typing within a line preserves its ID by construction
 *  - a split assigns the original ID to the fragment that carries the
 *    original CONTENT: mid-line splits keep it on the first fragment;
 *    a split at line start (first fragment empty — the author is
 *    pushing this line down to insert above it) moves the ID, its
 *    type, and therefore its entity links to the pushed-down text.
 *    Recorded as an explicit split event either way
 *  - a join keeps the EARLIER line's ID and records the merge
 *
 * Split/merge are explicit state transitions, not inferences — exactly
 * what G5 beat re-anchoring and the revision round-trip need.
 *
 * Line TYPE is explicit state carried in the same entries: set at import
 * from Stage-1 classification, cycled with Tab, inferred from context
 * only for lines the author newly creates. The editor NEVER re-derives
 * type from text content after creation (the Stage-1 classifier runs at
 * import; nothing re-classifies behind the author's back).
 *
 * The document contains NO blank lines: blanks are a rendering concern
 * (spacing.ts) — the fragility postmortem's first fix.
 */

import {
  StateEffect, StateField, type EditorState, type Transaction,
} from "@codemirror/state";

/** Editor block types: Stage-1 line types minus blank/boneyard/title
 * (blanks are never stored; boneyard/notes survive as their own blocks;
 * the title page is edited outside the script surface). */
export type BlockType =
  | "heading" | "action" | "character" | "dialogue" | "parenthetical"
  | "transition" | "centered" | "lyric" | "section" | "synopsis"
  | "note";

export interface LineEntry {
  /** Stable identity. For rows loaded from the database this is the row
   * uuid; author-created lines get fresh uuids at creation. */
  id: string;
  type: BlockType;
}

export type LineEvent =
  | { kind: "split"; originalId: string; newIds: string[] }
  | { kind: "merge"; survivorId: string; absorbedIds: string[] };

export interface LineStateValue {
  entries: readonly LineEntry[];
  /** Split/merge events from the LAST transaction only — consumers
   * (beat re-anchoring, commit) read them per-update. */
  events: readonly LineEvent[];
}

/** Explicitly set a line's type (Tab cycle, menu). */
export const setLineType = StateEffect.define<{
  line: number; type: BlockType;
}>();

/**
 * Replace the whole entry array (document load, paste, scene move).
 *
 * Paste and scene moves both go through this rather than letting
 * mapThroughTransaction guess. Its inference is right for typed input
 * and wrong for a paste, which knows exactly what its lines are — and
 * its split rule would hand the pasted text the identity of the line it
 * pushed down, the same hijack that caused the scene-linking saga.
 */
export const loadLines = StateEffect.define<LineEntry[]>();

export const TYPE_CYCLE: BlockType[] = [
  "action", "character", "dialogue", "parenthetical", "transition",
  "heading",
];

/** Context inference for author-created lines (Enter): Celtx-style
 * lightweight flow. Applied ONLY to newly minted lines. */
export function inferredTypeAfter(previous: BlockType): BlockType {
  switch (previous) {
    case "heading": return "action";
    case "character": return "dialogue";
    case "parenthetical": return "dialogue";
    case "dialogue": return "character";
    case "transition": return "heading";
    case "section": return "action";
    case "synopsis": return "action";
    default: return "action";
  }
}

export interface IdMinter {
  (): string;
}

let minter: IdMinter = () => crypto.randomUUID();
/** Tests inject a deterministic minter. */
export function setIdMinter(m: IdMinter): void {
  minter = m;
}

/** Mint a line id through the same source, so paste and scene moves are
 * deterministic under an injected minter too. */
export function mintLineId(): string {
  return minter();
}

function mapThroughTransaction(
    value: LineStateValue, tr: Transaction): LineStateValue {
  if (!tr.docChanged) {
    return value.events.length > 0
      ? { entries: value.entries, events: [] } : value;
  }
  // Work over the old entries; process changes back-to-front so earlier
  // line numbers stay valid while we splice.
  const entries = [...value.entries];
  const events: LineEvent[] = [];
  interface Op {
    startLine: number; // 1-based line in the OLD doc
    removedLines: number; // newlines removed
    addedLines: number; // newlines inserted
  }
  const ops: Op[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const startLine = tr.startState.doc.lineAt(fromA).number;
    const endLine = tr.startState.doc.lineAt(toA).number;
    ops.push({
      startLine,
      removedLines: endLine - startLine,
      addedLines: inserted.lines - 1,
    });
  });
  for (const op of ops.reverse()) {
    const idx = op.startLine - 1;
    if (op.removedLines === 0 && op.addedLines === 0) continue;

    // First: joins. Lines startLine..startLine+removedLines collapse
    // into the first; the earlier line's ID survives.
    if (op.removedLines > 0) {
      const absorbed = entries
        .slice(idx + 1, idx + 1 + op.removedLines)
        .map((e) => e.id);
      const survivor = entries[idx];
      entries.splice(idx + 1, op.removedLines);
      if (survivor !== undefined && absorbed.length > 0) {
        events.push({ kind: "merge", survivorId: survivor.id,
                      absorbedIds: absorbed });
      }
    }
    // Then: splits. Identity follows the ORIGINAL CONTENT: normally the
    // first fragment keeps the id; but a split at line start leaves the
    // first fragment empty — the author pushed the line down to type
    // something new above it, so the id (with its entity links) must
    // travel to the pushed-down fragment. Without this, typing a new
    // scene above an existing heading hijacked that heading's scene.
    if (op.addedLines > 0) {
      const original = entries[idx];
      const newEntries: LineEntry[] = [];
      let prevType: BlockType = original?.type ?? "action";
      for (let k = 0; k < op.addedLines; k++) {
        const t = inferredTypeAfter(prevType);
        newEntries.push({ id: minter(), type: t });
        prevType = t;
      }
      entries.splice(idx + 1, 0, ...newEntries);
      if (original !== undefined) {
        if (idx + 1 <= tr.newDoc.lines - 1 + 1 &&
            idx + 1 <= tr.newDoc.lines &&
            tr.newDoc.line(idx + 1).length === 0 &&
            newEntries.length > 0) {
          const minted = entries[idx + 1]!.id;
          entries[idx + 1] = { id: original.id, type: original.type };
          entries[idx] = {
            id: minted,
            type: inferredTypeAfter(entries[idx - 1]?.type ?? "action"),
          };
        }
        events.push({ kind: "split", originalId: original.id,
                      newIds: newEntries.map((e) => e.id) });
      }
    }
  }
  return { entries, events };
}

export const lineState = StateField.define<LineStateValue>({
  create: () => ({ entries: [], events: [] }),
  update: (value, tr) => {
    let next = mapThroughTransaction(value, tr);
    for (const effect of tr.effects) {
      if (effect.is(loadLines)) {
        next = { entries: effect.value, events: [] };
      } else if (effect.is(setLineType)) {
        const entries = [...next.entries];
        const entry = entries[effect.value.line - 1];
        if (entry !== undefined) {
          entries[effect.value.line - 1] =
            { ...entry, type: effect.value.type };
        }
        next = { entries, events: next.events };
      }
    }
    return next;
  },
});

export function lineEntries(state: EditorState): readonly LineEntry[] {
  return state.field(lineState).entries;
}

export function lineEvents(state: EditorState): readonly LineEvent[] {
  return state.field(lineState).events;
}

/** Invariant check — one entry per document line. */
export function assertAligned(state: EditorState): void {
  const n = state.field(lineState).entries.length;
  if (n !== state.doc.lines) {
    throw new Error(
      `lineState misaligned: ${n} entries, ${state.doc.lines} lines`);
  }
}
