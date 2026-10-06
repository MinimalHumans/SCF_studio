// SPDX-License-Identifier: Apache-2.0
/**
 * characterPresence.ts — where a character is in the film, read from the
 * script and the links, for the Scenes & Lines tab.
 *
 * Two sources describe presence and they can disagree: the AUTHORED link
 * (`scene_character`) and the WRITTEN script (cue lines whose
 * `character_id` points at the character). This module reads both and
 * reports where they part, in the terms scanIntegrity already uses, so
 * the tab can show the disagreement beside the scene instead of in a
 * separate panel.
 *
 * Which scene a line belongs to is the scene of the nearest heading
 * above it (spec §3.4) — never the line's own `scene_id`, which only
 * headings reliably carry. The walk is done here in one pass over the
 * script, in line order.
 *
 * Headless, like the other editor modules.
 */

import type { Row, SqlExec } from "@scf-core/db.ts";

/** One stretch of speech: a cue and the dialogue under it. */
export interface Speech {
  /** The cue line, so the Script tab can be opened at it. */
  cueOrder: number;
  cueUuid: string;
  /** The scene of the heading above the cue; null before any heading. */
  sceneId: number | null;
  /** The cue as written: "ELEANOR (V.O.)". */
  cue: string;
  /** Dialogue and parentheticals under the cue, in order. */
  parts: Array<{ kind: "dialogue" | "parenthetical"; text: string }>;
}

/** Line types that carry speech under a cue. Anything else ends it. */
const SPEECH = new Set(["dialogue", "parenthetical"]);

/** Content a scene shows, as scanIntegrity counts it. */
const BODY = new Set(["action", "character", "dialogue", "parenthetical",
                      "transition", "centered", "lyric"]);

export interface ScriptPresence {
  speeches: Speech[];
  /** Scenes with any body content under their heading. */
  writtenScenes: Set<number>;
  /** The heading line's uuid per scene, to open the script there. */
  headingLine: Map<number, string>;
}

/** Every speech of a character, and what the script says about scenes. */
export async function readScriptPresence(
    exec: SqlExec, characterId: number): Promise<ScriptPresence> {
  const lines = await exec(
    "SELECT line_order, line_type, content, scene_id, character_id, uuid " +
    "FROM screenplay_lines ORDER BY line_order");
  const speeches: Speech[] = [];
  const writtenScenes = new Set<number>();
  const headingLine = new Map<number, string>();
  let scene: number | null = null;
  let current: Speech | null = null;

  for (const l of lines) {
    const type = String(l["line_type"]);
    if (type === "heading") {
      current = null;
      const sid = l["scene_id"];
      scene = sid === null || sid === undefined ? null : Number(sid);
      if (scene !== null && !headingLine.has(scene)) {
        headingLine.set(scene, String(l["uuid"] ?? ""));
      }
      continue;
    }
    if (scene !== null && BODY.has(type)) writtenScenes.add(scene);
    if (type === "character") {
      current = null;
      if (Number(l["character_id"]) === characterId) {
        current = {
          cueOrder: Number(l["line_order"]), cueUuid: String(l["uuid"] ?? ""),
          sceneId: scene, cue: String(l["content"] ?? ""), parts: [],
        };
        speeches.push(current);
      }
      continue;
    }
    if (current !== null && SPEECH.has(type)) {
      current.parts.push({ kind: type as "dialogue" | "parenthetical",
                           text: String(l["content"] ?? "") });
      continue;
    }
    current = null;
  }
  return { speeches, writtenScenes, headingLine };
}

/** Presences that are silent by nature, so never asked about. */
export const QUIET_ROLES = new Set(["mentioned", "background"]);

export interface ScenePresence {
  sceneId: number;
  /** The scene_character link, if there is one. */
  link: Row | null;
  speeches: number;
  /**
   * Where links and script disagree:
   * - `silent`: linked to a scene that is written, and has no cue in it.
   *   Often right — a silent presence — so it is a question, not an error.
   * - `unlinked`: speaks in a scene it is not linked to.
   */
  mismatch: "silent" | "unlinked" | null;
}

/**
 * Every scene the character touches, by link or by speech, in the order
 * given. Scenes neither linked nor spoken in are left out.
 */
export function presenceByScene(sceneOrder: number[], links: Row[],
                                script: ScriptPresence): ScenePresence[] {
  const linkOf = new Map(links.map((l) => [Number(l["scene_id"]), l]));
  const spoken = new Map<number, number>();
  for (const s of script.speeches) {
    if (s.sceneId === null) continue;
    spoken.set(s.sceneId, (spoken.get(s.sceneId) ?? 0) + 1);
  }
  const out: ScenePresence[] = [];
  for (const sceneId of sceneOrder) {
    const link = linkOf.get(sceneId) ?? null;
    const speeches = spoken.get(sceneId) ?? 0;
    if (link === null && speeches === 0) continue;
    out.push({
      sceneId, link, speeches,
      mismatch: link === null ? "unlinked"
        : speeches === 0 && script.writtenScenes.has(sceneId) &&
          // A mention or an extra is not expected to speak.
          !QUIET_ROLES.has(String(link["role_in_scene"] ?? ""))
          ? "silent" : null,
    });
  }
  return out;
}
