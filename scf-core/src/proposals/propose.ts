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
  confidence: Confidence; // default-unchecked below high
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
// Props (confidence-scored, conservative)
// ---------------------------------------------------------------------------

const PROP_STOPLIST = new Set([
  "CONTINUED", "CONT'D", "FADE", "FADE IN", "FADE OUT", "CUT", "CUT TO",
  "DISSOLVE", "SMASH", "MATCH", "ANGLE", "ANGLE ON", "CLOSE", "CLOSE ON",
  "CLOSER", "WIDE", "WIDER", "POV", "INSERT", "INTERCUT", "TITLE",
  "TITLES", "SUPER", "CAMERA", "V.O", "O.S", "DAY", "NIGHT", "LATER",
  "MOMENTS", "BEAT", "PAUSE", "SILENCE", "THE", "END", "MORE", "OMITTED",
  "INT", "EXT", "REVEALING", "REVEAL", "SFX", "VFX", "CGI",
]);

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
  const propHits = new Map<string, { lines: number[] }>();

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
      // Mid-line ALL-CAPS phrases (the Fountain emphasis convention for
      // introductions). Conservative: 1–3 words, letters only, not at
      // line start, not stoplisted.
      const text = line.effective ?? line.raw;
      for (const m of text.matchAll(
          /(?<=\p{Ll}[\s,]\s?)((?:\p{Lu}[\p{Lu}'’-]+\s?){1,3})(?=[\s.,;:!?]|$)/gu)) {
        const phrase = (m[1] ?? "").trim();
        if (phrase.length < 3 || PROP_STOPLIST.has(phrase)) continue;
        const hit = propHits.get(phrase) ?? { lines: [] };
        hit.lines.push(line.index);
        propHits.set(phrase, hit);
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

  // Props: recurring phrases rate medium, single mentions low; never
  // high — props are always reviewed (default-unchecked below high).
  const props: PropProposal[] = [...propHits.entries()]
    .filter(([name]) => !cueNames.has(name.toUpperCase()))
    .map(([name, hit]) => ({
      name: smartTitle(name),
      occurrences: hit.lines.length,
      fromLines: hit.lines,
      confidence: (hit.lines.length >= 3 ? "medium" : "low") as Confidence,
    }));

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
