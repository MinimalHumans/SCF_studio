/**
 * editor/clipboard.ts — screenplay-aware copy, cut and paste.
 *
 * The editor's line TYPE and line IDENTITY live in editor state, not in
 * the text (lineState.ts). A plain-text clipboard therefore carries
 * neither: before this module, pasting a scene produced N fresh uuids
 * typed by `inferredTypeAfter` chaining, which bottoms out at "action"
 * — the whole paste arrived as action lines with no links.
 *
 * So copy and cut write a second clipboard flavour alongside text/plain
 * (Chromium-only app; a custom DataTransfer type is available and the
 * plain text still pastes into Final Draft). Paste reads it back.
 *
 * The interesting decision is IDENTITY, and it turns on one question:
 * are the source lines still in the document?
 *
 *  - GONE  -> this was a cut: the same lines are landing somewhere else,
 *             so they keep their uuids and every link hanging off them.
 *             Beats and prop tags anchor to the line uuid, so they
 *             follow with no work at all. This is what makes moving a
 *             scene a move rather than a delete-and-recreate that
 *             strands the original scene entity as an orphaned
 *             duplicate.
 *  - PRESENT -> this was a copy: fresh uuids. Type and character/location
 *             links carry (a duplicated cue is still that character),
 *             but a duplicated heading DROPS its scene id — one scene
 *             entity belongs to exactly one heading, an invariant
 *             linkAndCreateAtCommit already enforces. Dropping it here
 *             means the commit review can say "this will create a new
 *             scene" instead of silently shedding it.
 *
 * Partial lines (a selection starting mid-line) can never take part in a
 * move: the original line still exists holding the rest of its text, so
 * two lines would claim one uuid. They are marked `whole: false` and
 * force copy semantics for the whole payload.
 *
 * Identity reuse is also scoped to the project that produced it — a
 * uuid is minted per file, so honouring one across projects would
 * invent a lineage that does not exist (conventions §5).
 *
 * Everything here is pure: no CodeMirror, no DOM, no SQL.
 */

import type { BlockType } from "./lineState.ts";

export const SCF_CLIP_MIME = "application/x-scf-lines";

export interface ClipLine {
  /** Source line uuid, for move detection. */
  uuid: string;
  type: BlockType;
  text: string;
  /** False when the selection cut this line short at either end. */
  whole: boolean;
  sceneId: number | null;
  characterId: number | null;
  locationId: number | null;
}

export interface ClipPayload {
  v: 1;
  /** Identifies the working database, so uuids are never reused across
   * projects. */
  project: string;
  lines: ClipLine[];
}

export type PasteMode = "move" | "copy";

export interface PastedLine {
  id: string;
  type: BlockType;
  sceneId: number | null;
  characterId: number | null;
  locationId: number | null;
}

export interface PasteResolution {
  mode: PasteMode;
  lines: PastedLine[];
  /** Text to insert, joined with newlines. */
  text: string;
  /** Every source line was taken end to end, so the payload is a run of
   * complete lines rather than a fragment. Only these can be inserted as
   * a BLOCK (see planPasteEntries). */
  wholeLines: boolean;
}

export function encodeClip(payload: ClipPayload): string {
  return JSON.stringify(payload);
}

/** Parse a clipboard payload, tolerating anything that is not ours. */
export function decodeClip(raw: string | null | undefined):
    ClipPayload | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<ClipPayload>;
  if (p.v !== 1 || typeof p.project !== "string" ||
      !Array.isArray(p.lines)) {
    return null;
  }
  const lines: ClipLine[] = [];
  for (const line of p.lines) {
    if (typeof line !== "object" || line === null) return null;
    const l = line as Partial<ClipLine>;
    if (typeof l.uuid !== "string" || typeof l.type !== "string" ||
        typeof l.text !== "string") {
      return null;
    }
    lines.push({
      uuid: l.uuid,
      type: l.type,
      text: l.text,
      whole: l.whole !== false,
      sceneId: typeof l.sceneId === "number" ? l.sceneId : null,
      characterId: typeof l.characterId === "number" ? l.characterId : null,
      locationId: typeof l.locationId === "number" ? l.locationId : null,
    });
  }
  return { v: 1, project: p.project, lines };
}

export interface ResolveOptions {
  /** Current project key — a payload from another project is a copy. */
  project: string;
  /** Line uuids present in the document right now. */
  liveIds: ReadonlySet<string>;
  mint: () => string;
}

/**
 * Decide what the pasted lines should be. Move semantics apply only when
 * EVERY source line is whole, from this project, and absent from the
 * document — a half-move has no coherent meaning, and guessing per line
 * would let one paste both revive a uuid and duplicate another.
 */
export function resolvePaste(
    payload: ClipPayload, options: ResolveOptions): PasteResolution {
  const sameProject = payload.project === options.project;
  const allWhole = payload.lines.every((l) => l.whole);
  const allGone = payload.lines.length > 0 &&
    payload.lines.every((l) => !options.liveIds.has(l.uuid));
  const mode: PasteMode =
    sameProject && allWhole && allGone ? "move" : "copy";

  const lines = payload.lines.map((line) => {
    if (mode === "move") {
      return {
        id: line.uuid,
        type: line.type,
        sceneId: line.sceneId,
        characterId: line.characterId,
        locationId: line.locationId,
      };
    }
    return {
      id: options.mint(),
      type: line.type,
      // A copied heading must not claim the scene its original owns.
      sceneId: line.type === "heading" ? null : line.sceneId,
      characterId: line.characterId,
      locationId: line.locationId,
    };
  });

  return {
    mode, lines,
    text: payload.lines.map((l) => l.text).join("\n"),
    wholeLines: allWhole,
  };
}

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
