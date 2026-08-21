// SPDX-License-Identifier: Apache-2.0
/**
 * proposals/propose.ts — Stage 3: entity proposal. Heuristic, and honest
 * about it: this stage produces PROPOSALS, never rows. The user reviews a
 * staging screen (accept all / per-item / merge / rename) — or takes the
 * one-click "accept best guess" path — and only then does the application
 * create rows, all marked machine-created. v1's _find_or_create_*
 * auto-creation is the regret this design bans; silent entity creation
 * from a heuristic parser is how a project fills with THE and TWO MEN as
 * characters.
 *
 * Confidence scoring is designed from the golden corpus's documented
 * damage, not guesswork. The private tier showed, concretely:
 *  - stray "@" force markers on mixed-case action sentences (Aliens) —
 *    so forced lowercase cues that read like prose score low
 *  - CSV-quote-wrapped lines ("RIPLEY) — so wrapping quotes are a
 *    visible normalization and a penalty
 *  - ">"-prefixed, number-glued, emphasis-wrapped headings (Wonka:
 *    "> 1**EXT. OCEAN - DAY**") — Stage 1 stays spec-faithful, but the
 *    character scorer penalizes transition-shaped and heading-shaped cues
 *  - OCR page furniture ("(CONTINUED) A86") — penalized by pattern
 *
 * Every normalization is recorded on the proposal (raw → normalized,
 * steps listed) so the staging screen can SHOW its work.
 */

import type { FountainDocument, FountainLine } from "../fountain/types.ts";

export type Confidence = "high" | "medium" | "low";

export interface NormalizationStep {
  step: string; // e.g. "stripped extension (V.O.)"
  before: string;
  after: string;
}

export interface SceneProposal {
  /** Index of the heading line in the document. */
  lineIndex: number;
  headingText: string;
  /** Explicit #x# number if present, else 1-based ordinal as string. */
  sceneNumber: string;
  intExt: string | null; // "INT" | "EXT" | "INT/EXT" | "EST" | null
  locationName: string | null;
  timeOfDay: string | null;
  confidence: Confidence; // near-deterministic: high, auto-accept
}

export interface LocationProposal {
  name: string;
  /** Heading line indexes this location was derived from. */
  fromLines: number[];
  occurrences: number;
  /** Names this proposal might duplicate — shown, never auto-merged. */
  mergeCandidates: string[];
  confidence: Confidence;
}

export interface CharacterProposal {
  name: string;
  rawCues: string[];
  occurrences: number;
  /** Cue lines this came from. */
  fromLines: number[];
  normalizations: NormalizationStep[];
  /** Extensions seen across occurrences (V.O., O.S., CONT'D …). */
  extensionsSeen: string[];
  /** Reasons confidence was reduced — shown on the staging screen. */
  suspicions: string[];
  /** For "ELEANOR AND MARCUS" cues: the proposed split, shown. */
  splitOf?: string;
  /** Names this cue likely duplicates (letters-only match) — shown. */
  mergeCandidates: string[];
  confidence: Confidence;
}

export interface SceneCharacterLink {
  sceneLineIndex: number;
  characterName: string;
}

export interface PropProposal {
  name: string;
  occurrences: number;
  fromLines: number[];
  /** How many distinct scenes mention it — a real prop tends to recur. */
  scenes: number;
  /**
   * Heading line index of each scene it appears in, so an accepted prop
   * can be placed in the script rather than created floating. Same
   * shape as SceneCharacterLink.sceneLineIndex.
   */
  sceneLines: number[];
  /** Which evidence fired: "introduced", "handled", "recurring". */
  signals: string[];
  /** Ranking score; the staging screen sorts on this. */
  score: number;
  /** Never "high": this pass proposes, a human creates. */
  confidence: Confidence;
}

export interface ProposalSet {
  scenes: SceneProposal[];
  locations: LocationProposal[];
  characters: CharacterProposal[];
  links: SceneCharacterLink[];
  props: PropProposal[];
}

// ---------------------------------------------------------------------------
// Heading parsing (near-deterministic)
// ---------------------------------------------------------------------------

const HEADING_PARSE_RE =
  /^\s*\.?\s*(INT\.?\/EXT|I\/E|INT|EXT|EST)?[.\s]*\s*(.*)$/i;
const TIME_WORDS = [
  "DAY", "NIGHT", "MORNING", "AFTERNOON", "EVENING", "DAWN", "DUSK",
  "CONTINUOUS", "LATER", "MOMENTS LATER", "SAME", "SAME TIME", "SUNSET",
  "SUNRISE", "MAGIC HOUR",
];

export function parseHeading(text: string): {
  intExt: string | null; locationName: string | null;
  timeOfDay: string | null; sceneNumber: string | null;
} {
  let t = text.trim();
  let sceneNumber: string | null = null;
  const num = /#([^\s#][^#]*)#\s*$/.exec(t);
  if (num !== null) {
    sceneNumber = num[1] ?? null;
    t = t.slice(0, num.index).trimEnd();
  }
  const m = HEADING_PARSE_RE.exec(t);
  const intExtRaw = m?.[1];
  const rest = (m?.[2] ?? t).trim();
  // Time of day: the segment after the last " - " when it's a known word
  // (or starts with one: "NIGHT (1962)" still reads as NIGHT).
  let locationName: string | null = rest === "" ? null : rest;
  let timeOfDay: string | null = null;
  const parts = rest.split(/\s+-+\s+|\s+–\s+/);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1]!.trim().toUpperCase();
    if (TIME_WORDS.some((w) => tail === w || tail.startsWith(w + " "))) {
      timeOfDay = parts[parts.length - 1]!.trim();
      locationName = parts.slice(0, -1).join(" - ").trim() || null;
    }
  }
  return {
    intExt: intExtRaw !== undefined
      ? intExtRaw.toUpperCase().replace("INT./EXT", "INT/EXT")
          .replace("I/E", "INT/EXT").replace(/\.$/, "")
      : null,
    locationName, timeOfDay, sceneNumber,
  };
}

function smartTitle(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'/(])\p{L}/gu,
                                 (c) => c.toUpperCase());
}

/**
 * smartTitle capitalizes after an apostrophe (O'Brien), which turns
 * CREATURE'S into Creature'S. Props are the only place a possessive is
 * routine, so the correction lives here rather than in smartTitle,
 * where it would also touch cue and location names.
 */
function propTitle(s: string): string {
  return smartTitle(s).replace(/(['’])S(?=\b)/g, "$1s");
}

// ---------------------------------------------------------------------------
// Character cue normalization + suspicion scoring
// ---------------------------------------------------------------------------

/** Extensions that mark continuity/placement, not identity. */
const IDENTITY_NEUTRAL_EXT =
  /^(CONT'?D\.?|CONTINUED|CONT\.?|V\.?O\.?|O\.?S\.?|O\.?C\.?|OFF|ON (TV|RADIO|PHONE)|INTO (PHONE|RADIO)|SUBTITLED?|PRE-?LAP)$/i;

const PAGE_FURNITURE_RE =
  /^\(?CONTINUED\)?\b|^\(?MORE\)?$|^[A-Z]\d{2,}$|\bA\d{2,}\b/;

export function normalizeCue(raw: string): {
  name: string; steps: NormalizationStep[]; suspicions: string[];
} {
  const steps: NormalizationStep[] = [];
  const suspicions: string[] = [];
  let t = raw.trim();
  const record = (step: string, next: string): void => {
    if (next !== t) {
      steps.push({ step, before: t, after: next });
      t = next;
    }
  };
  // Stage-1 force/dual markers are syntax, not identity — and the
  // corpus showed converters spraying them onto prose ("@M-40 ^with
  // scanners"), so stray mid-cue carets strip too, visibly.
  record("stripped force marker (@)", t.replace(/^@\s*/, ""));
  // OCR/markup junk glued to cue edges ("\_ GORMAN") — strip visibly so
  // the cue merges into its clean group.
  record("stripped edge artifacts",
         t.replace(/^[\\_\-*~%$=+|<>\s]+/, "")
          .replace(/[\\_\-*~%$=+|<>\s]+$/, "").trim());
  record("stripped dual/caret artifact",
         t.replace(/\s*\^\s*/g, " ").trim());
  // Corpus: CSV-quote wrapping ("RIPLEY / **RIPLEY **)
  record("stripped wrapping quotes",
         t.replace(/^["']+/, "").replace(/["']+$/, "").trim());
  record("stripped emphasis markers",
         t.replace(/^[*_]+|[*_]+$/g, "").trim());
  record("stripped trailing punctuation",
         t.replace(/[.,;:·]+$/u, "").trim());
  // Trailing parenthesized extensions (may survive Stage 1 when quotes
  // hid them from the cue parser).
  for (;;) {
    const m = /\(([^()]*)\)\s*$/.exec(t);
    if (m === null) break;
    const ext = (m[1] ?? "").trim();
    record(`stripped extension (${ext})`,
           t.slice(0, m.index).trimEnd());
    if (!IDENTITY_NEUTRAL_EXT.test(ext)) {
      suspicions.push(`unusual extension "(${ext})"`);
    }
  }
  record("collapsed whitespace", t.replace(/\s{2,}/g, " "));

  // Suspicion patterns, each traced to corpus damage. HARD suspicions
  // (prefixed "!") force low confidence no matter what follows the cue —
  // a prose-shaped forced cue with dialogue after it is exactly the
  // Aliens failure mode.
  const words = t.split(/\s+/).filter((w) => w !== "");
  const lower = /\p{Ll}/u.test(t);
  if (lower && !/^\p{Lu}/u.test(t)) {
    // Legitimate forced cues (@McClane) are name-shaped: they start
    // uppercase. A lowercase-initial cue is a wrap fragment or prose.
    suspicions.push("!forced cue starts lowercase");
  } else if (lower && words.length > 2) {
    suspicions.push("!forced cue reads like prose");
  } else if (lower) {
    suspicions.push("contains lowercase (forced cue)");
  }
  if (t.length > 28) suspicions.push("!far too long for a cue");
  else if (t.length > 24) suspicions.push("unusually long for a cue");
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const digits = (t.match(/\d/g) ?? []).length;
  if (digits > 0 && digits >= letters) {
    suspicions.push("!mostly digits");
  }
  if (words.length === 1 && CUE_STOPWORDS.has(t.toUpperCase())) {
    suspicions.push("!function word, not a name");
  }
  if (words.length > 4) suspicions.push("!reads like a sentence");
  if (/[.!?]$/.test(t)) suspicions.push("!ends like a sentence");
  if (/--|,/.test(t)) suspicions.push("contains sentence punctuation");
  // Heading-shaped even behind glued page/scene-number prefixes
  // ("182-82-INT. CORRIDOR" — the number-glue family the corpus showed).
  if (/^[\d\s.#-]*(INT|EXT|EST)[./\s]/i.test(t) || /\bTO:$/.test(t)) {
    suspicions.push("!heading- or transition-shaped");
  }
  if (PAGE_FURNITURE_RE.test(raw.trim()) || PAGE_FURNITURE_RE.test(t)) {
    suspicions.push("!looks like page furniture (CONTINUED/page code)");
  }
  if (/^\d+$/.test(t)) suspicions.push("!digits only");
  return { name: t, steps, suspicions };
}

/** Single function words are never character names ("THE" is the
 * design doc's own example of the failure). */
const CUE_STOPWORDS = new Set([
  "THE", "A", "AN", "AND", "OR", "OF", "IN", "ON", "AT", "TO", "BY",
  "IT", "AS", "IS", "WE", "HE", "SHE", "ALL", "MORE", "END", "OUT",
]);

/** Hard suspicions force low confidence; the "!" prefix marks them. */
export function hasHardSuspicion(suspicions: string[]): boolean {
  return suspicions.some((s) => s.startsWith("!"));
}

/** "ELEANOR AND MARCUS" / "ELEANOR/MARCUS" → split candidates. */
function splitCue(name: string): string[] | null {
  const bySlash = name.split("/").map((s) => s.trim());
  if (bySlash.length === 2 && bySlash.every((s) => /^\p{Lu}/u.test(s))) {
    return bySlash;
  }
  const byAnd = name.split(/\s+(?:AND|&)\s+/);
  if (byAnd.length === 2 &&
      byAnd.every((s) => s !== "" && s.split(/\s+/).length <= 3)) {
    return byAnd.map((s) => s.trim());
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props (two signals, gated, scored)
// ---------------------------------------------------------------------------

/**
 * Capitalization is NOT a prop signal. In a screenplay, mid-line caps
 * mean "production, take note" — writers cap character introductions,
 * sound cues, and camera-worthy actions just as readily as objects. The
 * first version of this pass keyed off caps alone and produced 356
 * candidates from one feature, led by TWO OLD HUNTERS, SUN, HOWLING and
 * TOSSES THE MEN; scripts that don't use the convention produced almost
 * nothing, since nothing about being a prop makes a word capitalized.
 *
 * So two signals, both about the phrase's SYNTAX rather than its case:
 *
 *   introduced — a caps phrase sitting where a noun phrase sits: after a
 *     determiner, possessive, or preposition ("a RED BALL", "his
 *     LIGHTNING ROD", "MOTHER'S GLOVES"). Verbs do not follow
 *     determiners, which is what removes TOSSES and PUSHES.
 *
 *   handled — the object of a handling verb, at any capitalization
 *     ("picks up the umbrella", "draws his scalpel"). Physical handling
 *     is what makes something a prop in production terms, and this
 *     signal works on the scripts that cap nothing.
 *
 * What survives is then filtered by category, not by an allow-list of
 * known props: an allow-list would cap recall at whatever is on it and
 * fail on period, invented, or culturally specific objects. The residual
 * noise falls into four enumerable classes instead, below.
 *
 * This pass is a head start, not a census. It is tuned for precision,
 * proposes nothing above medium, and so can never create a prop through
 * best-guess acceptance — the editor's select-and-create is the accurate
 * path, and the staging screen says so.
 */

const PROP_STOPLIST = new Set([
  "CONTINUED", "CONT'D", "FADE", "FADE IN", "FADE OUT", "CUT", "CUT TO",
  "DISSOLVE", "SMASH", "MATCH", "ANGLE", "ANGLE ON", "CLOSE", "CLOSE ON",
  "CLOSER", "WIDE", "WIDER", "POV", "INSERT", "INTERCUT", "TITLE",
  "TITLES", "SUPER", "CAMERA", "V.O", "O.S", "DAY", "NIGHT", "LATER",
  "MOMENTS", "BEAT", "PAUSE", "SILENCE", "THE", "END", "MORE", "OMITTED",
  "INT", "EXT", "REVEALING", "REVEAL", "SFX", "VFX", "CGI",
]);

/** People. A role noun is a character, not a thing to be held. */
const PROP_REJECT_PEOPLE = new Set([
  "man", "men", "woman", "women", "boy", "girl", "child", "children",
  "kid", "baby", "guy", "lady", "person", "people", "crowd", "group",
  "figure", "stranger", "guest", "servant", "butler", "maid", "cook",
  "driver", "guard", "soldier", "officer", "cop", "police", "doctor",
  "nurse", "priest", "hunter", "sailor", "worker", "waiter", "waitress",
  "clerk", "bartender", "nun", "monk", "gravedigger", "mourner",
  "villager", "passenger", "student", "teacher", "librarian", "captain",
  "detective", "attendant", "assistant", "stablehand", "scullery",
  "family", "mother", "father", "brother", "sister", "son", "daughter",
  "wife", "husband", "friend", "boss", "neighbour", "neighbor",
]);

/** Sounds. A script names them constantly; none of them is an object. */
const PROP_REJECT_SOUNDS = new Set([
  "noise", "sound", "scream", "screams", "shout", "yell", "howl",
  "howling", "roar", "crash", "bang", "boom", "thud", "thump", "knock",
  "creak", "crack", "cracks", "click", "hiss", "whisper", "silence",
  "echo", "music", "song", "laughter", "sob", "gasp", "whistle", "rustle",
  "footsteps", "voice", "voices", "ring", "buzz", "beep", "siren",
]);

/** Weather, light, and other things nobody puts on a props table. */
const PROP_REJECT_ELEMENTS = new Set([
  "sun", "moon", "sky", "cloud", "clouds", "rain", "snow", "snowstorm",
  "storm", "wind", "fog", "mist", "ice", "water", "sea", "ocean", "wave",
  "waves", "fire", "flame", "flames", "smoke", "steam", "dust", "mud",
  "blood", "light", "lights", "darkness", "shadow", "shadows",
  "firelight", "sunlight", "moonlight", "daylight", "lightning",
  "thunder", "explosion", "flash", "glow", "air", "ground", "earth",
  "sand", "grass", "trees", "tree", "forest", "mountain", "horizon",
]);

/** Body parts. "GLOVED HANDS" is a shot, not a prop; the gloves are. */
const PROP_REJECT_BODY = new Set([
  "hand", "hands", "arm", "arms", "leg", "legs", "foot", "feet", "head",
  "face", "eye", "eyes", "mouth", "lips", "nose", "ear", "ears", "hair",
  "finger", "fingers", "thumb", "shoulder", "shoulders", "chest", "back",
  "neck", "throat", "stomach", "belly", "skin", "bone", "bones", "teeth",
  "tooth", "knee", "knees", "wrist", "waist", "body", "flesh", "heart",
]);

/** Abstractions a handling verb can still take as an object. */
const PROP_REJECT_ABSTRACT = new Set([
  "gaze", "look", "glance", "breath", "smile", "frown", "step", "steps",
  "moment", "way", "rest", "side", "edge", "top", "bottom", "front",
  "middle", "distance", "silence", "time", "turn", "pace", "position",
  "place", "course", "chance", "care", "hold", "grip", "aim", "note",
  "notice", "notices", "seat", "stand", "lead", "shape", "deck",
]);

/** Words that end a noun phrase — the object stops before them. */
const NP_TERMINATORS = new Set([
  "in", "on", "at", "to", "from", "of", "for", "with", "and", "or",
  "but", "into", "onto", "toward", "towards", "up", "down", "out",
  "over", "under", "off", "like", "as", "that", "which", "who", "then",
  "before", "after", "while", "against", "across", "behind", "beside",
  "through", "around", "away", "back", "forward", "even", "further",
  "closer", "himself", "herself", "itself", "themselves", "him", "her",
  "them", "it", "is", "are", "was", "were", "still", "again", "just",
]);

const DETERMINERS =
  "a|an|the|his|her|its|their|our|my|your|one|two|three|four|five|six|" +
  "another|each|every|some|several|that|this|these|those";

/** Verbs whose object is, by definition, something physical. */
const HANDLING_VERBS = [
  "picks up", "pick up", "picking up", "puts down", "sets down",
  "holds", "holding", "grabs", "grabbing", "grips", "clutches",
  "clutching", "pulls", "pulling", "draws", "drawing", "lifts",
  "lifting", "hands", "carries", "carrying", "drops", "takes", "opens",
  "closes", "unwraps", "wraps", "loads", "reloads", "aims", "throws",
  "tosses", "hurls", "wields", "raises", "pockets", "wears", "wearing",
  "removes", "offers", "passes", "hoists", "brandishes", "swings",
  "slams", "pours", "lights", "strikes", "waves", "clasps", "snatches",
];

/** Immediately before a caps phrase: what makes it a noun phrase. */
const NP_LEAD = new RegExp(
  `(?:\\b(?:${DETERMINERS})\\s+|['’]s\\s+|` +
  `\\b(?:${HANDLING_VERBS.join("|")})\\s+|` +
  `\\b(?:with|in|on|from|into|onto|under|behind|beside|through|over|` +
  `reveals|reveal)\\s+)$`, "i");

// The object stops before a terminator INSIDE the pattern, not after —
// a greedy capture swallowed the next clause's verb ("the umbrella and
// opens") and the regex then resumed past it, losing "the shutters".
const NOT_TERMINATOR =
  `(?!(?:${[...NP_TERMINATORS].join("|")})\\b)`;
const NP_WORD = `${NOT_TERMINATOR}[\\p{L}][\\p{L}'’-]*`;

const HANDLING_RE = new RegExp(
  `\\b(?:${HANDLING_VERBS.join("|")})\\s+(?:${DETERMINERS})\\s+` +
  `(${NP_WORD}(?:\\s+${NP_WORD}){0,2})`, "giu");

const CAPS_PHRASE =
  /((?:\p{Lu}[\p{Lu}'’-]+\s?){1,4})(?=[\s.,;:!?)-]|$)/gu;

/** Trailing em-dash remnants were being kept: "NOISE-", "VEIL-". */
function tidyPhrase(raw: string): string {
  return raw
    .replace(/^[^\p{L}\d]+/gu, "")
    .replace(/[^\p{L}\d]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude singular for head-word lookups: gloves → glove, boxes → box. */
function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    return w.slice(0, -1);
  }
  return w;
}

function inRejectLexicon(word: string): boolean {
  const w = word.toLowerCase();
  const s = singular(w);
  for (const set of [PROP_REJECT_PEOPLE, PROP_REJECT_SOUNDS,
                     PROP_REJECT_ELEMENTS, PROP_REJECT_BODY,
                     PROP_REJECT_ABSTRACT]) {
    if (set.has(w) || set.has(s)) return true;
  }
  return false;
}

/**
 * Is this phrase worth proposing at all? Judged on its HEAD word (the
 * last one), which is what the phrase actually denotes: "carved ebony
 * coffin" is a coffin, "gloved hands" is hands.
 */
export function propCandidateRejection(phrase: string): string | null {
  const words = phrase.split(/\s+/).filter((w) => w !== "");
  const head = words[words.length - 1];
  if (head === undefined || phrase.length < 3) return "too short";
  if (words.length > 4) return "too long for a prop name";
  if (PROP_STOPLIST.has(phrase.toUpperCase())) return "screenplay furniture";
  if (/\d/.test(phrase)) return "contains digits";
  if (inRejectLexicon(head)) return "person, sound, element, or body part";
  // A capped verb ("DROPS") that also appears as a handling verb is a
  // verb, whatever the caps suggest.
  if (words.length === 1 &&
      HANDLING_VERBS.includes(phrase.toLowerCase())) return "verb";
  if (words.every((w) => inRejectLexicon(w))) {
    return "person, sound, element, or body part";
  }
  return null;
}

/** The object of a handling verb, truncated where the noun phrase ends. */
function handlingObject(captured: string): string {
  // "hands her a towel" — the verb pattern ate "her", so a second
  // determiner can still lead the object.
  const lead = new RegExp(`^(?:${DETERMINERS})\\s+`, "i");
  // An em-dash remnant ends the phrase: "the cane- but does not".
  const cut = tidyPhrase(captured).split(/[-–—]\s|\s[-–—]/)[0] ?? "";
  const words = tidyPhrase(cut).replace(lead, "").split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (NP_TERMINATORS.has(lower)) break;
    if (lower.endsWith("ly") && lower.length > 4) break; // adverb
    out.push(w);
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// The proposal pass
// ---------------------------------------------------------------------------

export function propose(doc: FountainDocument): ProposalSet {
  const scenes: SceneProposal[] = [];
  const locationsByKey = new Map<string, LocationProposal>();
  const cueGroups = new Map<string, {
    rawCues: Set<string>; fromLines: number[];
    steps: NormalizationStep[]; suspicions: Set<string>;
    extensions: Set<string>; dialogueFollows: number;
  }>();
  const links: SceneCharacterLink[] = [];
  const propHits = new Map<string, {
    display: string; lines: number[];
    sceneLines: Set<number>; signals: Set<string>;
  }>();

  /** Same object seen twice under different casing is one candidate. */
  const recordProp = (phrase: string, signal: string,
                      lineIndex: number, sceneLine: number): void => {
    const key = phrase.toUpperCase();
    const hit = propHits.get(key) ??
      { display: phrase, lines: [], sceneLines: new Set<number>(),
        signals: new Set<string>() };
    hit.lines.push(lineIndex);
    // Action before the first heading belongs to no scene.
    if (sceneLine >= 0) hit.sceneLines.add(sceneLine);
    hit.signals.add(signal);
    propHits.set(key, hit);
  };

  let currentSceneLine = -1;
  let ordinal = 0;
  let lastCueName: string | null = null;

  for (const line of doc.lines) {
    if (line.type === "heading") {
      ordinal += 1;
      currentSceneLine = line.index;
      lastCueName = null;
      const parsed = parseHeading(line.raw);
      scenes.push({
        lineIndex: line.index,
        headingText: line.raw.trim(),
        sceneNumber: line.heading?.sceneNumber ?? parsed.sceneNumber ??
                     String(ordinal),
        intExt: parsed.intExt,
        locationName: parsed.locationName !== null
          ? smartTitle(parsed.locationName) : null,
        timeOfDay: parsed.timeOfDay,
        confidence: "high",
      });
      if (parsed.locationName !== null) {
        const name = smartTitle(parsed.locationName);
        const key = name.toUpperCase();
        const existing = locationsByKey.get(key);
        if (existing !== undefined) {
          existing.occurrences += 1;
          existing.fromLines.push(line.index);
        } else {
          locationsByKey.set(key, {
            name, fromLines: [line.index], occurrences: 1,
            mergeCandidates: [], confidence: "high",
          });
        }
      }
      continue;
    }

    if (line.type === "character" && line.character !== undefined) {
      const rawCue = line.raw.trim();
      const norm = normalizeCue(rawCue);
      const key = norm.name.toUpperCase();
      if (norm.name === "") { lastCueName = null; continue; }
      const group = cueGroups.get(key) ?? {
        rawCues: new Set(), fromLines: [], steps: [],
        suspicions: new Set(), extensions: new Set(), dialogueFollows: 0,
      };
      group.rawCues.add(rawCue);
      group.fromLines.push(line.index);
      for (const s of norm.steps) {
        if (!group.steps.some((x) => x.step === s.step &&
                                     x.before === s.before)) {
          group.steps.push(s);
        }
      }
      for (const s of norm.suspicions) group.suspicions.add(s);
      for (const e of line.character.extensions) group.extensions.add(e);
      cueGroups.set(key, group);
      lastCueName = norm.name;
      if (currentSceneLine !== -1) {
        if (!links.some((l) => l.sceneLineIndex === currentSceneLine &&
                               l.characterName === norm.name)) {
          links.push({ sceneLineIndex: currentSceneLine,
                       characterName: norm.name });
        }
      }
      continue;
    }

    if (line.type === "dialogue" && lastCueName !== null) {
      const group = cueGroups.get(lastCueName.toUpperCase());
      if (group !== undefined) group.dialogueFollows += 1;
      lastCueName = null; // count once per cue occurrence
      continue;
    }

    if (line.type === "action") {
      const text = line.effective ?? line.raw;

      // Signal 1 — introduced: a caps phrase in noun-phrase position.
      // A line with no lowercase at all carries no case contrast, so
      // caps says nothing about any part of it. (PDF conversions
      // produce these by the hundred.)
      const hasContrast = /\p{Ll}/u.test(text);
      for (const m of hasContrast ? text.matchAll(CAPS_PHRASE) : []) {
        const before = text.slice(0, m.index ?? 0);
        let phrase = tidyPhrase(m[1] ?? "");
        // A determiner swept into the match ("THE RED BALL") is itself
        // the evidence — strip it and count the gate as passed.
        const led = new RegExp(`^(?:${DETERMINERS})\\s+`, "i");
        const ledIn = led.test(phrase);
        if (ledIn) phrase = phrase.replace(led, "");
        if (!ledIn && !NP_LEAD.test(before)) continue;
        if (propCandidateRejection(phrase) !== null) continue;
        recordProp(phrase, "introduced", line.index, currentSceneLine);
      }

      // Signal 2 — handled: the object of a handling verb, any case.
      for (const m of text.matchAll(HANDLING_RE)) {
        const phrase = handlingObject(m[1] ?? "");
        if (propCandidateRejection(phrase) !== null) continue;
        recordProp(phrase, "handled", line.index, currentSceneLine);
      }
    }
  }

  // Location merge candidates: containment or near-identical names —
  // shown, never auto-merged.
  const locations = [...locationsByKey.values()];
  for (const a of locations) {
    for (const b of locations) {
      if (a === b) continue;
      const A = a.name.toUpperCase();
      const B = b.name.toUpperCase();
      if (A.includes(B) || B.includes(A) ||
          A.replace(/[^A-Z0-9]/g, "") === B.replace(/[^A-Z0-9]/g, "")) {
        if (!a.mergeCandidates.includes(b.name)) {
          a.mergeCandidates.push(b.name);
        }
      }
    }
  }

  // Character confidence: corpus-informed.
  const characters: CharacterProposal[] = [];
  const cueNames = new Set([...cueGroups.keys()]);
  for (const [key, group] of cueGroups) {
    const suspicions = [...group.suspicions];
    const occurrences = group.fromLines.length;
    let confidence: Confidence;
    if (hasHardSuspicion(suspicions)) {
      confidence = "low";
    } else if (suspicions.length === 0 &&
        (occurrences >= 2 || group.dialogueFollows >= 1)) {
      confidence = "high";
    } else if (suspicions.length <= 1 && group.dialogueFollows >= 1) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
    const proposal: CharacterProposal = {
      name: keyDisplay(group, key),
      rawCues: [...group.rawCues],
      occurrences,
      fromLines: group.fromLines,
      normalizations: group.steps,
      extensionsSeen: [...group.extensions],
      suspicions,
      mergeCandidates: [],
      confidence,
    };
    characters.push(proposal);
    // Dual-cue split: propose the parts (marked), keep the joint cue low.
    const split = splitCue(proposal.name);
    if (split !== null) {
      proposal.suspicions.push("joint cue — split proposed");
      proposal.confidence = "low";
      for (const part of split) {
        if (cueNames.has(part.toUpperCase())) continue;
        characters.push({
          name: part, rawCues: [proposal.name],
          occurrences: proposal.occurrences,
          fromLines: proposal.fromLines,
          normalizations: [{ step: "split joint cue",
                             before: proposal.name, after: part }],
          extensionsSeen: [], suspicions: [], splitOf: proposal.name,
          mergeCandidates: [], confidence: "medium",
        });
      }
    }
  }

  // Near-duplicate cues (letters-only forms colliding: RIPL.EY vs
  // RIPLEY): the weaker proposal is demoted to a merge candidate of the
  // stronger — shown on staging, kept out of best-guess.
  const lettersOnly = (s: string): string =>
    (s.toUpperCase().match(/\p{L}/gu) ?? []).join("");
  const byLetters = new Map<string, CharacterProposal[]>();
  for (const c of characters) {
    const k = lettersOnly(c.name);
    if (k === "") continue;
    byLetters.set(k, [...(byLetters.get(k) ?? []), c]);
  }
  for (const group of byLetters.values()) {
    if (group.length < 2) continue;
    const strongest = [...group].sort((a, b) =>
      b.occurrences - a.occurrences)[0]!;
    for (const c of group) {
      if (c === strongest) continue;
      strongest.mergeCandidates.push(c.name);
      c.mergeCandidates.push(strongest.name);
      c.suspicions.push(`!near-duplicate of ${strongest.name}`);
      c.confidence = "low";
    }
  }

  // Props: scored, never above medium. Two signals agreeing, or one
  // signal repeated across scenes, is as strong as this pass gets — a
  // prop is only ever created by a human ticking the box.
  const characterKeys = new Set(characters.map((c) => c.name.toUpperCase()));
  const props: PropProposal[] = [...propHits.entries()]
    .filter(([key]) => !cueNames.has(key) && !characterKeys.has(key))
    .map(([, hit]) => {
      const signals = [...hit.signals];
      const sceneLines = [...hit.sceneLines].sort((a, b) => a - b);
      const scenes = sceneLines.length;
      let score = 0;
      if (signals.includes("introduced")) score += 2;
      if (signals.includes("handled")) score += 3;
      if (signals.length > 1) score += 3;
      score += Math.min(3, hit.lines.length - 1);
      if (scenes > 1) score += 2;
      if (scenes > 1) signals.push("recurring");
      return {
        name: propTitle(hit.display),
        occurrences: hit.lines.length,
        fromLines: hit.lines,
        scenes,
        sceneLines,
        signals,
        score,
        confidence: (score >= 6 ? "medium" : "low") as Confidence,
      };
    })
    .sort((a, b) => b.score - a.score || b.occurrences - a.occurrences ||
                    a.name.localeCompare(b.name));

  return { scenes, locations, characters, links, props };
}

function keyDisplay(group: { rawCues: Set<string> }, key: string): string {
  // Prefer the normalized form's casing as seen; fall back to the key.
  const first = [...group.rawCues][0];
  if (first !== undefined) {
    const norm = normalizeCue(first).name;
    if (norm.toUpperCase() === key) return norm;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Accept best guess (the one-click fast path)
// ---------------------------------------------------------------------------

export interface AcceptedSet {
  scenes: SceneProposal[];
  locations: LocationProposal[];
  characters: CharacterProposal[];
  links: SceneCharacterLink[];
  props: PropProposal[];
  /** Everything here is machine-created and must be marked as such. */
  machineCreated: true;
}

/**
 * Apply default confidence thresholds: scenes and locations accept;
 * characters accept at high/medium (joint cues stay out, splits go in);
 * props accept only at high — which propose() never assigns, so the
 * default best-guess creates no props. The staging screen can loosen
 * any of this per item.
 */
export function acceptBestGuess(p: ProposalSet): AcceptedSet {
  const characters = p.characters.filter(
    (c) => c.confidence !== "low");
  const names = new Set(characters.map((c) => c.name));
  return {
    scenes: p.scenes,
    locations: p.locations,
    characters,
    links: p.links.filter((l) => names.has(l.characterName)),
    props: p.props.filter((x) => x.confidence === "high"),
    machineCreated: true,
  };
}
