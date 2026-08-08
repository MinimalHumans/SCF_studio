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
  const prefix = sceneNumber === null || sceneNumber === ""
    ? "" : String(sceneNumber);
  const used = new Set<string>();
  let highest = -1;
  for (const raw of taken) {
    if (raw === null || raw === "") continue;
    const code = raw.trim().toUpperCase();
    used.add(code);
    if (!code.startsWith(prefix.toUpperCase())) continue;
    const index = letterIndex(code.slice(prefix.length));
    if (index > highest) highest = index;
  }
  for (let i = highest + 1; i < highest + 1000; i += 1) {
    const code = shotCode(sceneNumber, i);
    if (!used.has(code.toUpperCase())) return code;
  }
  return shotCode(sceneNumber, taken.length);
}

/**
 * Restamp a shot code onto a new scene number, keeping its letter.
 *
 * `42A` in a scene that becomes scene 43 returns `43A`. Returns null
 * when nothing should change — the code is unparseable, the scene has no
 * number, or the result matches what is already there.
 *
 * This is NOT a contradiction of the stored-number rule above, but it
 * does narrow it. That rule protects a code a crew already holds on
 * paper, and nobody holds paper on an unlocked script: before locking,
 * a shot list that says 42A for a scene now numbered 43 is not a stable
 * identifier, it is a stale one. So the same `project.scene_numbering`
 * flag governs both — `derived` keeps shot codes tracking their scene,
 * `fixed` freezes them along with the scene numbers, which is the state
 * a distributed shot list needs.
 */
export function restampShotNumber(
    code: string | null, sceneNumber: number | string | null):
    string | null {
  if (code === null || code === "") return null;
  if (sceneNumber === null || sceneNumber === "") return null;
  const letters = /[A-Z]+$/.exec(code.trim().toUpperCase());
  if (letters === null) return null;
  const next = shotCode(sceneNumber, letterIndex(letters[0]));
  return next === code.trim() ? null : next;
}
