// SPDX-License-Identifier: Apache-2.0
/**
 * shotlist.ts — what a printed shot list says, and in what order.
 *
 * Headless so the rules can be tested: which shots appear (cut shots
 * are not in the film, §6.6.1), how they group under beats, what a
 * column prints, and how the industry short forms are derived. The
 * view only lays it out.
 *
 * Everything here is a reading of rows the Shoot tab wrote; nothing is
 * stored. The options are a preference of whoever is printing, so they
 * live in localStorage, not the .scf.
 */

import type { Row, SqlExec } from "./db.ts";
import { SCENE_ORDER_BY, SCENE_ORDER_JOIN } from "./structure.ts";

/** One column of the table, in the order they print. */
export const SHOTLIST_COLUMNS = [
  "frame", "shot", "title", "size", "angle", "lens", "move", "sec",
  "action", "cast", "props", "notes", "done",
] as const;
export type ShotlistColumn = (typeof SHOTLIST_COLUMNS)[number];

export const COLUMN_LABEL: Record<ShotlistColumn, string> = {
  frame: "Storyboard",
  shot: "Shot",
  title: "Title",
  size: "Size",
  angle: "Angle",
  lens: "Lens",
  move: "Move",
  sec: "Sec",
  action: "Action and framing",
  cast: "Cast",
  props: "Props",
  notes: "Notes",
  done: "Done",
};

export type Orientation = "landscape" | "portrait";
export type PaperSize = "letter" | "a4";

/** Which shots a sheet takes in — all a reader of the data needs. */
export interface SheetOptions {
  /** "all", or one scene's id as a string. */
  scope: string;
  groupByBeat: boolean;
  includeCut: boolean;
}

export interface ShotlistOptions extends SheetOptions {
  columns: Record<ShotlistColumn, boolean>;
  orientation: Orientation;
  paper: PaperSize;
  /** Location, light, cast and props above each scene's table. */
  sceneHeader: boolean;
  /** ECU, MCU, MW … rather than the words as stored. */
  abbreviate: boolean;
  /** Each scene starts on a fresh page. */
  pagePerScene: boolean;
  /** Legend of the short forms used, after the last table. */
  legend: boolean;
}

export const DEFAULT_OPTIONS: ShotlistOptions = {
  columns: {
    frame: true, shot: true, title: false, size: true, angle: true,
    lens: true, move: true, sec: true, action: true, cast: false,
    props: false, notes: false, done: true,
  },
  orientation: "landscape",
  paper: "letter",
  scope: "all",
  groupByBeat: true,
  sceneHeader: true,
  includeCut: false,
  abbreviate: true,
  pagePerScene: true,
  legend: true,
};

/** Merge what was remembered over the defaults, so a column added in a
 *  later version appears with its default rather than as undefined. */
export function withDefaults(saved: unknown): ShotlistOptions {
  if (saved === null || typeof saved !== "object") return DEFAULT_OPTIONS;
  const s = saved as Partial<ShotlistOptions>;
  return {
    ...DEFAULT_OPTIONS, ...s,
    columns: { ...DEFAULT_OPTIONS.columns, ...(s.columns ?? {}) },
  };
}

/* ── Short forms ──────────────────────────────────────────────────── */

/**
 * Shot sizes as a camera report writes them. Keys are lower-cased and
 * hyphens and underscores read as spaces, so "Medium-Close_up" finds
 * MCU. Anything not listed prints as stored: a writer's own vocabulary
 * is not wrong, only unabbreviated.
 */
const SIZE_SHORT: Record<string, string> = {
  "extreme close up": "ECU", "extreme closeup": "ECU",
  "big close up": "BCU",
  "close up": "CU", "closeup": "CU",
  "medium close up": "MCU", "medium closeup": "MCU",
  "medium": "M", "medium shot": "M", "mid shot": "M",
  "medium wide": "MW", "medium long": "MLS", "medium full": "MF",
  "cowboy": "MCS", "american": "MCS",
  "full": "FS", "full shot": "FS",
  "wide": "WS", "wide shot": "WS", "long": "LS", "long shot": "LS",
  "extreme wide": "EWS", "extreme long": "ELS",
  "establishing": "EST",
  "insert": "INS",
  "two shot": "2S", "three shot": "3S",
  "over the shoulder": "OTS", "over shoulder": "OTS",
  "point of view": "POV", "pov": "POV",
};

const SIZE_LONG: Record<string, string> = {
  ECU: "extreme close-up", BCU: "big close-up", CU: "close-up",
  MCU: "medium close-up", M: "medium", MW: "medium wide",
  MLS: "medium long", MF: "medium full", MCS: "medium cowboy",
  FS: "full shot", WS: "wide", LS: "long", EWS: "extreme wide",
  ELS: "extreme long", EST: "establishing", INS: "insert",
  "2S": "two shot", "3S": "three shot", OTS: "over the shoulder",
  POV: "point of view",
};

/** Angles keep their words; only the long ones shorten. */
const ANGLE_SHORT: Record<string, string> = {
  "eye level": "Eye level", "low angle": "Low", "high angle": "High",
  "low": "Low", "high": "High",
  "birds eye": "Bird's eye", "bird's eye": "Bird's eye",
  "overhead": "Overhead", "top down": "Overhead",
  "worms eye": "Worm's eye", "worm's eye": "Worm's eye",
  "dutch": "Dutch", "dutch angle": "Dutch", "dutch tilt": "Dutch",
  "over the shoulder": "OTS", "point of view": "POV", "pov": "POV",
};

const key = (v: string): string =>
  v.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");

const cap = (v: string): string =>
  v === "" ? v : v[0]!.toUpperCase() + v.slice(1);

export function shortSize(v: string | null): string {
  if (v === null || v.trim() === "") return "";
  return SIZE_SHORT[key(v)] ?? cap(v.trim());
}

export function shortAngle(v: string | null): string {
  if (v === null || v.trim() === "") return "";
  return ANGLE_SHORT[key(v)] ?? cap(v.trim());
}

/** "the camera pushes in" stays as written; "push_in" reads "Push in". */
export function tidy(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (s === "") return "";
  return cap(s.includes(" ") ? s : s.replace(/[_-]+/g, " "));
}

/** The abbreviations actually used in a list, for its legend. */
export function sizeLegend(sizes: readonly string[]): Array<[string, string]> {
  const used = new Set(sizes.filter((s) => s in SIZE_LONG));
  return [...used].sort((a, b) =>
    Object.keys(SIZE_LONG).indexOf(a) - Object.keys(SIZE_LONG).indexOf(b))
    .map((s) => [s, SIZE_LONG[s]!]);
}

/** Seconds as a list prints them: 6, 2.5, or "" when unknown. */
export function seconds(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A running time for the header: "43 s", "2 min 05 s". */
export function runningTime(totalSeconds: number): string {
  const t = Math.round(totalSeconds);
  if (t < 60) return `${String(t)} s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m)} min ${String(s).padStart(2, "0")} s`;
}

/* ── Grouping ─────────────────────────────────────────────────────── */

export interface BeatGroup {
  /** null: shots on the scene but in no beat. */
  beat: Row | null;
  /** "A", "B" … by the beat's place in the scene. */
  letter: string | null;
  shots: Row[];
}

export interface SceneSheet {
  scene: Row;
  groups: BeatGroup[];
  shotCount: number;
  /** Sum of the known durations, and whether every shot had one. */
  seconds: number;
  allTimed: boolean;
}

const num = (v: unknown): number => Number(v ?? 0);
const byOrder = (field: string) => (a: Row, b: Row): number =>
  num(a[field]) - num(b[field]) || num(a["id"]) - num(b["id"]);

/**
 * The scenes to print, in the order given (story order), each with its
 * shots grouped under beats.
 *
 * A scene with no shots to print is left out — a shot list is a list of
 * shots, and a page that says "no shots" for every uncovered scene of a
 * feature would bury the twelve that have them. Shots in no beat come
 * first, then each beat in `beat_order`: loose shots are usually the
 * establishing coverage the beats sit inside.
 */
export function buildSheets(
  scenes: readonly Row[], beats: readonly Row[], shots: readonly Row[],
  opts: SheetOptions,
): SceneSheet[] {
  const out: SceneSheet[] = [];
  for (const scene of scenes) {
    const sceneId = num(scene["id"]);
    if (opts.scope !== "all" && String(sceneId) !== opts.scope) continue;
    const mine = shots
      .filter((s) => num(s["scene_id"]) === sceneId)
      .filter((s) => opts.includeCut || s["lifecycle_status"] !== "cut")
      .sort(byOrder("shot_order"));
    if (mine.length === 0) continue;

    const sceneBeats = beats
      .filter((b) => num(b["scene_id"]) === sceneId)
      .sort(byOrder("beat_order"));
    const groups: BeatGroup[] = [];
    if (!opts.groupByBeat) {
      groups.push({ beat: null, letter: null, shots: mine });
    } else {
      const known = new Set(sceneBeats.map((b) => num(b["id"])));
      const loose = mine.filter((s) =>
        s["story_beat_id"] === null || !known.has(num(s["story_beat_id"])));
      if (loose.length > 0) groups.push({ beat: null, letter: null, shots: loose });
      sceneBeats.forEach((b, i) => {
        const inBeat = mine.filter(
          (s) => num(s["story_beat_id"]) === num(b["id"]));
        if (inBeat.length === 0) return;
        groups.push({
          beat: b, letter: String.fromCharCode(65 + (i % 26)), shots: inBeat,
        });
      });
    }

    const timed = mine.filter((s) => seconds(s["duration_seconds"]) !== "");
    out.push({
      scene, groups, shotCount: mine.length,
      seconds: timed.reduce((t, s) => t + num(s["duration_seconds"]), 0),
      allTimed: timed.length === mine.length,
    });
  }
  return out;
}

/**
 * A beat's banner: "BEAT A — Waking up in the room." The stored name is
 * dropped when it is only the default "Beat A" the Shoot tab gave it,
 * so the banner does not read "BEAT A — Beat A".
 */
export function beatBanner(group: BeatGroup): string | null {
  if (group.beat === null) return null;
  const name = String(group.beat["name"] ?? "").trim();
  const desc = String(group.beat["description"] ?? "").trim();
  const generic = /^beat\s+[a-z]$/i.test(name);
  const words = [generic ? "" : name, desc].filter((s) => s !== "");
  const head = `Beat ${group.letter ?? ""}`.trim();
  return words.length === 0 ? head : `${head} — ${words.join(". ")}`;
}

/**
 * What the Action column says. The description is the framing; the
 * name is a title, printed only when there is no description or when
 * the Title column is off and it says something the description does
 * not.
 */
export function actionText(shot: Row, titleColumn: boolean): string {
  const name = String(shot["name"] ?? "").trim();
  const desc = String(shot["description"] ?? "").trim();
  if (desc === "") return titleColumn ? "" : name;
  if (titleColumn || name === "" || desc.startsWith(name)) return desc;
  return `${name}. ${desc}`;
}

// ---------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------

/** Everything a shot list is built from, as the file holds it. */
export interface ShotlistRows {
  scenes: Row[];
  beats: Row[];
  shots: Row[];
  locations: Row[];
  /** Scene-level lighting only. */
  lighting: Row[];
  sceneCast: Row[];
  sceneProps: Row[];
  shotCast: Row[];
  shotProps: Row[];
}

/**
 * The rows a shot list is made from, in one read: the editor's page and
 * an MCP client ask this and get the same answer. Scenes come back in
 * STORY order (a scene's number is a label, never an order).
 */
export async function readShotlistRows(exec: SqlExec): Promise<ShotlistRows> {
  const [scenes, beats, shots, locations, lighting, sceneCast, sceneProps,
         shotCast, shotProps] = await Promise.all([
    exec("SELECT s.id, s.uuid, s.scene_number, s.name, s.location_id, " +
         "s.summary " +
         `FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`),
    exec("SELECT id, uuid, name, scene_id, beat_order, description " +
         "FROM story_beat"),
    exec("SELECT id, uuid, name, scene_id, story_beat_id, shot_number, " +
         "shot_order, shot_size, camera_angle, camera_movement, " +
         "lens_choice, duration_seconds, description, notes, " +
         "lifecycle_status FROM shot"),
    exec("SELECT id, name, setting, key_features FROM location"),
    // Scene-level lighting only: a shot's own row is a delta, and the
    // header describes the room the shots are in.
    exec("SELECT scene_id, lighting_style, overall_mood, key_source, " +
         "light_quality FROM lighting_design WHERE shot_id IS NULL " +
         "ORDER BY id"),
    exec("SELECT sc.scene_id, c.name FROM scene_character sc " +
         "JOIN character c ON c.id = sc.character_id ORDER BY sc.id"),
    exec("SELECT sp.scene_id, p.name FROM scene_prop sp " +
         "JOIN prop p ON p.id = sp.prop_id ORDER BY sp.id"),
    exec("SELECT sc.shot_id, c.name FROM shot_character sc " +
         "JOIN character c ON c.id = sc.character_id ORDER BY sc.id"),
    exec("SELECT sp.shot_id, p.name FROM shot_prop sp " +
         "JOIN prop p ON p.id = sp.prop_id ORDER BY sp.id"),
  ]);
  return { scenes, beats, shots, locations, lighting, sceneCast, sceneProps,
           shotCast, shotProps };
}
