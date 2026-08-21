// SPDX-License-Identifier: Apache-2.0
/**
 * shots.ts — shot numbering.
 *
 * A shot number is deliberately STORED, not derived, which contradicts
 * the rule applied to scene labels and prop names. The reason is that
 * `42A` is not a display label: it is an identifier issued to a crew.
 * Once a shot list goes out, 42A stays 42A even if the scene renumbers,
 * and silently rewriting it would rewrite paperwork that exists on
 * paper.
 *
 * So the code below only ever supplies a DEFAULT at creation time, and
 * a derived code the UI can show beside an authored one when the two
 * have drifted — so a list can be reissued deliberately rather than
 * changing under someone.
 */

/** A, B, … Z, AA, AB — spreadsheet columns, for the same reason. */
export function shotLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * The code a shot would have if numbering were derived: scene number
 * plus its position. An unnumbered scene has nothing to build on, so it
 * yields the letter alone rather than inventing a number.
 */
export function shotCode(sceneNumber: number | string | null,
                         index: number): string {
  const letter = shotLetter(index);
  if (sceneNumber === null || sceneNumber === "") return letter;
  return `${String(sceneNumber)}${letter}`;
}

/** Inverse of shotLetter: A→0, Z→25, AA→26. -1 if not a letter run. */
export function letterIndex(letters: string): number {
  if (!/^[A-Z]+$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Default for a new shot: one past the HIGHEST code the scene has used,
 * not the first gap.
 *
 * Numbering continues rather than backfilling because a shot number is
 * an identifier a crew may already hold: if 42B is cut, the next setup
 * should be 42D, not a second 42B meaning something else. This is a
 * guard, not a guarantee — the database keeps no record of codes that
 * once existed, so deleting the LAST shot in a scene does free its code
 * again. A production that needs the stronger promise wants a stored
 * counter, which is a locking-era concern.
 */
export function nextShotNumber(sceneNumber: number | string | null,
                               taken: Array<string | null>): string {
  const used = new Set<string>();
  let highest = -1;
  for (const raw of taken) {
    if (raw === null || raw === "") continue;
    used.add(raw.trim().toUpperCase());
    const parsed = parseShotCode(raw, sceneNumber);
    if (parsed !== null && parsed.index > highest) highest = parsed.index;
  }
  for (let i = highest + 1; i < highest + 1000; i += 1) {
    const code = shotCode(sceneNumber, i);
    if (!used.has(code.toUpperCase())) return code;
  }
  return shotCode(sceneNumber, taken.length);
}

/**
 * Split a shot code into its scene prefix and its ordinal, per §4.4.2.
 *
 * THE PARSE IS RELATIVE TO THE SCENE. A code is read by removing the
 * scene's own number from the front, never by taking the trailing
 * letter run in isolation — those two readings diverge the moment a
 * scene number ends in a letter, which §4.2.1 permits:
 *
 *   shot "12AB" in scene "12A"  →  prefix "12A", letters "B",  index 1
 *   trailing-run reading        →  prefix "12",  letters "AB", index 27
 *
 * The second is wrong, and was what this module did until spec 0.10.
 * Returns null when the code does not belong to this scheme for that
 * scene — an authored code, a prefix that does not match, letters that
 * are not a letter run. Null is never an error (§9.1): it means leave
 * the code alone.
 */
export function parseShotCode(
    code: string | null,
    sceneNumber: number | string | null): { index: number } | null {
  if (code === null || code === "") return null;
  const text = code.trim().toUpperCase();
  const prefix = sceneNumber === null || sceneNumber === ""
    ? "" : String(sceneNumber).trim().toUpperCase();
  if (!text.startsWith(prefix)) return null;
  const index = letterIndex(text.slice(prefix.length));
  return index < 0 ? null : { index };
}

/**
 * Restamp a shot code from one scene number onto another, keeping its
 * ordinal. `42A` in a scene renumbered 42 → 43 returns `43A`.
 *
 * Takes the scene's OLD number because §4.4.2's parse needs it: the
 * code was minted under that number and can only be split by it.
 * Returns null when nothing should change — the code does not parse
 * against the old number, the new scene has no number, or the result
 * matches what is already there.
 *
 * This is NOT a contradiction of the stored-number rule above, but it
 * does narrow it. That rule protects a code a crew already holds on
 * paper, and nobody holds paper on an unlocked script: before locking,
 * a shot list that says 42A for a scene now numbered 43 is not a stable
 * identifier, it is a stale one. So the same `project.numbering_policy`
 * flag governs both — `derived` keeps shot codes tracking their scene,
 * `fixed` freezes them along with the scene numbers, which is the state
 * a distributed shot list needs.
 */
export function restampShotNumber(
    code: string | null,
    fromSceneNumber: number | string | null,
    toSceneNumber: number | string | null): string | null {
  if (toSceneNumber === null || toSceneNumber === "") return null;
  const parsed = parseShotCode(code, fromSceneNumber);
  if (parsed === null) return null;
  const next = shotCode(toSceneNumber, parsed.index);
  return next === (code ?? "").trim() ? null : next;
}
