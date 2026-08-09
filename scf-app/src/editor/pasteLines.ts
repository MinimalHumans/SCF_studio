/**
 * editor/pasteLines.ts — keeping paste from stealing a line's identity.
 *
 * The clipboard carries TEXT and nothing else. Copy, cut and paste are
 * deliberately plain: no hidden payload, no smuggled scene or character
 * links, no identity travelling between documents. Links are made in the
 * editor, and a scene is moved or duplicated from the rail, where the
 * operation is a database operation and says so.
 *
 * What still needs handling is identity, because CodeMirror's mapping
 * does not know what a paste means. Its split rule gives the FIRST
 * fragment the original line's id — so pasting above a heading handed
 * the pasted text that heading's identity, and therefore its scene,
 * while the real heading was pushed down with a fresh id and committed
 * as a new scene. Two records, both wrong. That is the same identity
 * hijack as the scene-linking saga, arriving through the clipboard.
 *
 * So the whole entry array is stated rather than inferred. Pasted lines
 * are new lines; the line they landed on keeps what it had.
 */

import type { BlockType } from "./lineState.ts";

export interface PasteShape {
  /** 1-based line holding the start of the replaced selection. */
  firstLine: number;
  /** 1-based line holding its end. */
  lastLine: number;
  /** True when the selection began exactly at firstLine's start. */
  atLineStart: boolean;
  /**
   * The paste lands as whole lines ABOVE firstLine rather than merging
   * into it: an empty selection resting at a line start, with a payload
   * of complete lines. The caller inserts a trailing newline to match.
   *
   * This is the case that matters. Dropping a cut scene at the top of
   * another scene's heading is the ordinary way to move one, and plain
   * merge semantics would splice the last pasted line onto the existing
   * heading — producing one mangled slug instead of two scenes.
   */
  blockInsert: boolean;
}

/**
 * The whole entry array after a paste.
 *
 * This is stated rather than inferred on purpose. mapThroughTransaction
 * treats a paste as a split, and its split rule gives the pushed-down
 * text a fresh id while the pasted text inherits the original's — the
 * same identity hijack that caused the scene-linking saga, except here
 * it strands the line the author pasted ABOVE. Computing the array
 * outright removes the guess.
 *
 * A paste landing mid-line continues that line, so the line keeps its
 * own identity and the first pasted line has no entry of its own: its
 * text merged into text that was already there. Symmetrically, when the
 * selection ended mid-line, that line's tail merges into the last pasted
 * line and its entry is consumed — a merge loses one identity, and there
 * is no honest way around that.
 */
export function planPasteEntries<E extends { id: string; type: BlockType }>(
    existing: readonly E[],
    pasted: readonly { id: string; type: BlockType }[],
    shape: PasteShape): Array<E | { id: string; type: BlockType }> {
  if (shape.blockInsert) {
    // Nothing is consumed: the line at firstLine is pushed down whole,
    // and keeps its identity — and therefore its scene link.
    return [
      ...existing.slice(0, shape.firstLine - 1),
      ...pasted,
      ...existing.slice(shape.firstLine - 1),
    ];
  }
  const head = shape.atLineStart
    ? [] : existing.slice(shape.firstLine - 1, shape.firstLine);
  const body = pasted.slice(shape.atLineStart ? 0 : 1);
  return [
    ...existing.slice(0, shape.firstLine - 1),
    ...head,
    ...body,
    ...existing.slice(shape.lastLine),
  ];
}
