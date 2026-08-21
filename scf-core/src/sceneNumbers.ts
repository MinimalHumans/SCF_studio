// SPDX-License-Identifier: Apache-2.0
/**
 * sceneNumbers.ts — scene numbers as labels.
 *
 * Implements spec §4.2. A scene number is a LABEL for a position, not
 * the position itself: `12A` is the scene inserted after 12, `A12` the
 * one inserted before it. Production practice, and the reason a locked
 * script can gain scenes without renumbering the ones a crew already
 * holds.
 *
 * Two rules from the spec shape everything here:
 *
 * §4.2.3 — the grammar is a PARSE, not a constraint. A label that does
 * not match is opaque: still valid data, still stored, simply excluded
 * from §4.2.2's ordering and left to the next fallback. Nothing in this
 * module ever rejects a value.
 *
 * §4.2.2 — ordering is `A12 < B12 < 12 < 12A < 12B`. Letter runs are
 * bijective base-26 (A=1, Z=26, AA=27), which is the same scheme
 * shots.ts uses for shot letters, one-based here because a run is only
 * ever present when it means something.
 */

export interface SceneNumberParts {
  /** Letter run before the digits, uppercased. "" when absent. */
  prefix: string;
  /** The numeric part. Leading zeros are consumed. */
  digits: number;
  /** Letter run after the digits, uppercased. "" when absent. */
  suffix: string;
}

/** Bijective base-26: A→1, Z→26, AA→27. 0 for an empty run. */
export function runIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

const SCENE_NUMBER = /^([A-Z]{1,3})?([0-9]+)([A-Z]{1,3})?$/;

/**
 * Parse a scene number into its parts, or null if it does not match
 * §4.2.1. Null is not an error — see the opaque rule above.
 */
export function parseSceneNumber(
    raw: string | number | null | undefined): SceneNumberParts | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toUpperCase();
  if (text === "") return null;
  const m = SCENE_NUMBER.exec(text);
  if (m === null) return null;
  return {
    prefix: m[1] ?? "",
    digits: Number(m[2]),
    suffix: m[3] ?? "",
  };
}

/**
 * The §4.2.2 sort tuple. Null for an opaque label, which callers sort
 * after everything that parses.
 *
 * The second term is what puts `A12` before `12`: a prefix marks a
 * scene inserted BEFORE the numbered one, so prefixed sorts first
 * within the same digits.
 */
export function sceneNumberSortKey(
    raw: string | number | null | undefined):
    [number, number, number, number] | null {
  const parts = parseSceneNumber(raw);
  if (parts === null) return null;
  return [
    parts.digits,
    parts.prefix === "" ? 1 : 0,
    runIndex(parts.prefix),
    runIndex(parts.suffix),
  ];
}

/**
 * Compare two scene numbers per §4.2.2. Absent sorts after present,
 * opaque sorts after both, and two opaque labels compare equal so the
 * caller's next fallback decides — never by string, which would put
 * "pickup-3" in a position the spec does not define.
 */
export function compareSceneNumbers(
    a: string | number | null | undefined,
    b: string | number | null | undefined): number {
  const blank = (v: unknown): boolean =>
    v === null || v === undefined || String(v).trim() === "";
  if (blank(a) !== blank(b)) return blank(a) ? 1 : -1;
  if (blank(a)) return 0;

  const ka = sceneNumberSortKey(a);
  const kb = sceneNumberSortKey(b);
  if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
  if (ka === null || kb === null) return 0;

  for (let i = 0; i < ka.length; i += 1) {
    const va = ka[i] ?? 0;
    const vb = kb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * SQL twin of `compareSceneNumbers`.
 *
 * SQLite has no regex, so the parse is rebuilt from GLOB tests and
 * substr. Doing that inline in ORDER BY meant every term restating
 * every subexpression, so it is computed once per scene in a join and
 * the ORDER BY just reads columns.
 *
 * The letter runs are never converted to their bijective index:
 * ordering by (length, text) is equivalent within one alphabet and far
 * cheaper to read.
 *
 * The parse must agree with `parseSceneNumber` exactly — a list ordered
 * by SQL and the same list ordered in TypeScript disagreeing is the
 * class of bug §4.1 already cost us once. `sceneNumbers.test.ts` runs
 * both engines over the same labels and compares the orders.
 */
export function sceneNumberOrderJoin(
    on: string, alias = "sn", table = "scene"): string {
  const preLen =
    "CASE WHEN n GLOB '[A-Z][A-Z][A-Z][0-9]*' THEN 3 " +
    "WHEN n GLOB '[A-Z][A-Z][0-9]*' THEN 2 " +
    "WHEN n GLOB '[A-Z][0-9]*' THEN 1 ELSE 0 END";
  const sufLen =
    "CASE WHEN n GLOB '*[0-9][A-Z][A-Z][A-Z]' THEN 3 " +
    "WHEN n GLOB '*[0-9][A-Z][A-Z]' THEN 2 " +
    "WHEN n GLOB '*[0-9][A-Z]' THEN 1 ELSE 0 END";
  return (
    "LEFT JOIN (SELECT scene_id, n, pre_len, suf_len, mid, " +
    "(length(mid) > 0 AND mid NOT GLOB '*[^0-9]*') AS ok " +
    "FROM (SELECT scene_id, n, pre_len, suf_len, " +
    "substr(n, pre_len + 1, length(n) - pre_len - suf_len) AS mid " +
    `FROM (SELECT scene_id, n, ${preLen} AS pre_len, ` +
    `${sufLen} AS suf_len ` +
    "FROM (SELECT id AS scene_id, upper(trim(scene_number)) AS n " +
    `FROM ${table})))) ${alias} ON ${alias}.scene_id = ${on}`
  );
}

/**
 * ORDER BY terms reading the columns `sceneNumberOrderJoin` supplies.
 * Blank last, then opaque last, then the §4.2.2 tuple.
 */
export function sceneNumberOrderTerms(alias = "sn"): string {
  const a = alias;
  const ok = `${a}.ok`;
  return [
    `(${a}.n IS NULL OR ${a}.n = '')`,
    `(NOT ${ok})`,
    `CASE WHEN ${ok} THEN CAST(${a}.mid AS INTEGER) END`,
    `CASE WHEN ${ok} THEN (${a}.pre_len = 0) END`,
    `CASE WHEN ${ok} THEN ${a}.pre_len END`,
    `CASE WHEN ${ok} THEN substr(${a}.n, 1, ${a}.pre_len) END`,
    `CASE WHEN ${ok} THEN ${a}.suf_len END`,
    `CASE WHEN ${ok} THEN substr(${a}.n, ` +
      `length(${a}.n) - ${a}.suf_len + 1, ${a}.suf_len) END`,
  ].join(", ");
}
