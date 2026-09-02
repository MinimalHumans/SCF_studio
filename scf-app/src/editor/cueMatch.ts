// SPDX-License-Identifier: Apache-2.0
/**
 * Does a cue as written agree with the character it is linked to?
 *
 * The commit review flags a cue whose text disagrees with its linked
 * entity — the George→Jorge case, where a line was edited but kept its
 * old link. That check was string equality, and string equality is the
 * wrong test: a cue is a SHORT FORM by convention. Every screenplay
 * writes `ELEANOR` above dialogue spoken by a character the file knows
 * as `Eleanor Cade`, so the equality test reported eleven conflicts on
 * the conformance fixture — every cue line it has — and offered to
 * break eleven correct links.
 *
 * The rule here: a cue agrees when its words are a contiguous run of
 * whole words in the entity's name. `ELEANOR`, `CADE` and
 * `ELEANOR CADE` all agree with `Eleanor Cade`; `JORGE` does not agree
 * with `George Wells`, and `OLD ELEANOR` does not agree with
 * `Eleanor Cade` because it carries a word the name does not — which is
 * a real question for an author to answer, not noise.
 *
 * WHOLE WORDS, not substrings. `ADA` is a substring of `Adam Shaw` and
 * names a different person; requiring a word boundary is what keeps a
 * short name from silently agreeing with a longer one.
 *
 * THIS IS NOT A MATCHING RULE, and deliberately not used to CHOOSE an
 * entity for an unlinked cue. There the evidence runs the other way:
 * `CADE` alone is consistent with three characters in the fixture, and
 * picking one would be a guess. Here a link already exists and is the
 * authored truth; the only question is whether the cue contradicts it.
 *
 * It is also not part of the format. The spec says nothing about cue
 * shorthand and nothing in a `.scf` depends on this answer — it decides
 * what the editor asks the author about, so it lives in the app.
 *
 * The same word rules answer a second question for the integrity panel:
 * does a scene's ACTION name a character? A cast link is justified by a
 * character being written into the scene, not by their having a line —
 * a screenplay is full of people who are present and silent, and
 * requiring dialogue would mean writing dialogue to satisfy a checker.
 */

/** Uppercased words, with the punctuation a cue picks up removed.
 * `MRS. CADE` and `Mrs Cade` are the same two words, and a possessive
 * names its owner — action writes `Ada's shawl`. */
function words(text: string): string[] {
  return text
    .replace(/['\u2019]s\b/gi, "")
    .toUpperCase()
    .replace(/[.,;:'\u2019"!?()\[\]]/g, "")
    .split(/[\s\-\u2013\u2014_/]+/)
    .filter((w) => w !== "");
}

/** Does `haystack` contain `needle` as a contiguous run of whole words? */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let all = true;
    for (let i = 0; i < needle.length; i += 1) {
      if (needle[i] !== haystack[start + i]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/**
 * True when `cue` names `entityName` under the shorthand convention.
 * Both are compared case- and punctuation-insensitively.
 */
export function cueMatchesEntity(cue: string, entityName: string): boolean {
  const c = words(cue);
  const e = words(entityName);
  if (c.length === 0 || e.length === 0) return false;
  return containsRun(e, c);
}
