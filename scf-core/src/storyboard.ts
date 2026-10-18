// SPDX-License-Identifier: Apache-2.0
/**
 * storyboard.ts — the storyboard as a sequence of frames.
 *
 * Headless so it can be tested. The order is the shot list's order —
 * scenes in story order, shots in `shot_order`, grouped under beats —
 * so this builds on `buildSheets` rather than restating it: a board and
 * a shot list of the same scene must never disagree about what comes
 * next.
 *
 * Read-only, and nothing is stored: the options are a viewer's
 * preference, kept in localStorage.
 */

import type { Row, SqlExec } from "./db.ts";
import { SCENE_ORDER_BY, SCENE_ORDER_JOIN } from "./structure.ts";
import { buildSheets, type SceneSheet } from "./shotlist.ts";

export const BOARD_TABS = ["Board", "Lightbox"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

/** Rows: each scene a band, frames left to right. Columns: each scene a
 *  column, frames top to bottom, scenes side by side like a wall. */
export type BoardLayout = "rows" | "columns";
/** Overlaid on the picture, or set beneath it. */
export type CaptionPlace = "overlay" | "below";
export type FrameSize = "s" | "m" | "l";

export interface StoryboardOptions {
  tab: BoardTab;
  layout: BoardLayout;
  size: FrameSize;
  /** "project" (technical_specs.aspect_ratio), or a ratio as text. */
  aspect: string;
  captions: CaptionPlace;
  showNumber: boolean;
  showName: boolean;
  showDescription: boolean;
  /** Scene headings between the groups. */
  sceneHeads: boolean;
  groupByBeat: boolean;
  includeCut: boolean;
  /** Shots with no storyboard or start frame still hold a place. */
  showUnboarded: boolean;
  /** "all", or one scene's id as a string. */
  scope: string;
}

export const DEFAULT_BOARD_OPTIONS: StoryboardOptions = {
  tab: "Board",
  layout: "rows",
  size: "m",
  aspect: "project",
  captions: "below",
  showNumber: true,
  showName: false,
  showDescription: true,
  sceneHeads: true,
  groupByBeat: false,
  includeCut: false,
  showUnboarded: true,
  scope: "all",
};

export function withBoardDefaults(saved: unknown): StoryboardOptions {
  if (saved === null || typeof saved !== "object") return DEFAULT_BOARD_OPTIONS;
  const s = { ...DEFAULT_BOARD_OPTIONS, ...(saved as Partial<StoryboardOptions>) };
  if (!(BOARD_TABS as readonly string[]).includes(s.tab)) s.tab = "Board";
  return s;
}

/**
 * A ratio from how people write one: "16:9", "2.39:1", "1.85",
 * "2.35:1 (scope)". Null when there is no number in it.
 */
export function parseAspect(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const m = /(\d+(?:\.\d+)?)\s*(?:[:x×/]\s*(\d+(?:\.\d+)?))?/i.exec(text);
  if (m === null) return null;
  const w = Number(m[1]);
  const h = m[2] === undefined ? 1 : Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  const r = w / h;
  // A bare "35" is not a ratio anyone means.
  return r >= 0.3 && r <= 4 ? r : null;
}

export const ASPECT_CHOICES = ["16:9", "1.85:1", "2.39:1", "4:3", "1:1", "9:16"];

/** The ratio the board draws at: the choice, else the project's, else
 *  16:9. */
export function boardAspect(choice: string,
                            projectRatio: string | null): number {
  if (choice !== "project") return parseAspect(choice) ?? 16 / 9;
  return parseAspect(projectRatio) ?? 16 / 9;
}

export interface BoardFrame {
  /** Position in the whole board, 0-based: the lightbox steps by it. */
  index: number;
  shot: Row;
  scene: Row;
  /** "A", "B" … when grouped by beat, else null. */
  beatLetter: string | null;
  beat: Row | null;
  identifier: string | null;
}

export interface BoardScene {
  scene: Row;
  /** Beat groups, as the shot list draws them. */
  groups: Array<{ beat: Row | null; letter: string | null;
                  frames: BoardFrame[] }>;
  frameCount: number;
}

/**
 * The board: scenes in story order, each with its frames, every frame
 * numbered by its place in the whole board.
 *
 * Unboarded shots are dropped only when asked; a scene left with
 * nothing is dropped with them.
 */
export function buildBoard(
  scenes: readonly Row[], beats: readonly Row[], shots: readonly Row[],
  frameOf: ReadonlyMap<number, string>,
  opts: Pick<StoryboardOptions, "scope" | "groupByBeat" | "includeCut" |
                                "showUnboarded">,
): { scenes: BoardScene[]; frames: BoardFrame[] } {
  const sheets: SceneSheet[] = buildSheets(scenes, beats, shots, opts);
  const all: BoardFrame[] = [];
  const out: BoardScene[] = [];
  for (const sheet of sheets) {
    const groups: BoardScene["groups"] = [];
    for (const g of sheet.groups) {
      const frames: BoardFrame[] = [];
      for (const shot of g.shots) {
        const identifier = frameOf.get(Number(shot["id"])) ?? null;
        if (identifier === null && !opts.showUnboarded) continue;
        const f: BoardFrame = {
          index: all.length, shot, scene: sheet.scene,
          beatLetter: g.letter, beat: g.beat, identifier,
        };
        all.push(f);
        frames.push(f);
      }
      if (frames.length > 0) groups.push({ beat: g.beat, letter: g.letter, frames });
    }
    const n = groups.reduce((t, g) => t + g.frames.length, 0);
    if (n > 0) out.push({ scene: sheet.scene, groups, frameCount: n });
  }
  return { scenes: out, frames: all };
}

/** The lightbox's next position: stops at the ends rather than
 *  wrapping, so the last frame is noticeably the last. */
export function step(index: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** What a storyboard is built from, as the file holds it. */
export interface BoardRows {
  scenes: Row[];
  beats: Row[];
  shots: Row[];
  /** The project's aspect ratio as written ("16:9"), if it has one. */
  aspectRatio: string | null;
}

/** The rows a storyboard is made from, scenes in story order. */
export async function readBoardRows(exec: SqlExec): Promise<BoardRows> {
  const [scenes, beats, shots, specs] = await Promise.all([
    exec("SELECT s.id, s.scene_number, s.name " +
         `FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`),
    exec("SELECT id, name, scene_id, beat_order, description " +
         "FROM story_beat"),
    exec("SELECT id, name, scene_id, story_beat_id, shot_number, " +
         "shot_order, description, lifecycle_status FROM shot"),
    exec("SELECT aspect_ratio FROM technical_specs LIMIT 1"),
  ]);
  const ratio = specs[0]?.["aspect_ratio"];
  return {
    scenes, beats, shots,
    aspectRatio: typeof ratio === "string" && ratio !== "" ? ratio : null,
  };
}
