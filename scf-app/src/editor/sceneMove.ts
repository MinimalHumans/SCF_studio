// SPDX-License-Identifier: Apache-2.0
/**
 * editor/sceneMove.ts — moving a whole scene within the script.
 *
 * Reordering a scene is a STRUCTURAL edit that happens to be expressed
 * as text. Doing it through the clipboard works (see clipboard.ts) but
 * relies on a payload surviving a round trip; doing it as a first-class
 * move cannot fail that way, and it is what the Scene Rail's drag
 * issues.
 *
 * The scene entity is never touched. Its id, its uuid, its beats, prop
 * tags, shots and junction rows are all untouched, because nothing about
 * the entity changed — only where its heading sits in the line order.
 * That is the whole point: a moved scene must not leave an orphaned
 * duplicate behind, which is exactly what delete-and-recreate produces.
 *
 * A scene BLOCK is a heading plus everything down to the next heading —
 * the same "slugline to slugline" definition SCENE_SCRIPT_SQL uses in
 * shootOps.ts, and what a scene means anyway. Lines before the first
 * heading are a preamble and belong to no block; they never move and
 * nothing can be moved above them.
 *
 * Pure: line texts and entries in, line texts and entries out. The
 * caller turns that into one transaction.
 */

import type { LineEntry } from "./lineState.ts";

export interface SceneBlock {
  /** 0-based index into the lines array of the heading. */
  start: number;
  /** 0-based index of the last line in the block, inclusive. */
  end: number;
}

/** Heading-led blocks in document order. Preamble lines are excluded. */
export function sceneBlocks(
    entries: readonly { type: string }[]): SceneBlock[] {
  const blocks: SceneBlock[] = [];
  entries.forEach((entry, i) => {
    if (entry.type !== "heading") return;
    const last = blocks[blocks.length - 1];
    if (last !== undefined) last.end = i - 1;
    blocks.push({ start: i, end: entries.length - 1 });
  });
  return blocks;
}

export interface MovePlan {
  /** Full new document text. */
  doc: string;
  /** Full new entry array, aligned with it. */
  entries: LineEntry[];
  /** 0-based line index the moved heading ends up on. */
  headingAt: number;
}

/**
 * Move block `from` so it sits immediately before block `before`.
 * `before === blocks.length` means "after everything".
 *
 * Returns null for a no-op (moving a block before itself, or before the
 * block that already follows it), so the caller can skip the write
 * rather than churn a revision.
 *
 * The plan is a whole-document replacement rather than a two-part splice.
 * A move is an explicit, deliberate action on a document the editor
 * already holds in memory, so the simplicity is worth more than the
 * smaller changeset — and it makes the result trivially verifiable:
 * lines and entries are reordered by the same slice, so they cannot
 * drift out of alignment.
 */
export function planSceneMove(
    lines: readonly string[], entries: readonly LineEntry[],
    from: number, before: number): MovePlan | null {
  const blocks = sceneBlocks(entries);
  const source = blocks[from];
  if (source === undefined) return null;
  if (before < 0 || before > blocks.length) return null;
  if (before === from || before === from + 1) return null;

  const anchor = before === blocks.length
    ? lines.length : blocks[before]!.start;

  const cut = <T>(xs: readonly T[]): T[] => {
    const moved = xs.slice(source.start, source.end + 1);
    const rest = [...xs.slice(0, source.start),
                  ...xs.slice(source.end + 1)];
    // The anchor was measured on the ORIGINAL array; removing the block
    // shifts anything after it left by the block's length.
    const at = anchor > source.end
      ? anchor - moved.length : anchor;
    return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  };

  const movedLength = source.end - source.start + 1;
  const headingAt = anchor > source.end ? anchor - movedLength : anchor;

  return {
    doc: cut(lines).join("\n"),
    entries: cut(entries),
    headingAt,
  };
}

/**
 * Index of the block whose heading carries `lineIndex`, or -1 for
 * preamble lines.
 */
export function blockOfLine(
    entries: readonly { type: string }[], lineIndex: number): number {
  const blocks = sceneBlocks(entries);
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.start <= lineIndex) return i;
  }
  return -1;
}
