// SPDX-License-Identifier: Apache-2.0
/**
 * queryPaths.ts — machine-readable canonical query paths.
 * See docs/conventions.md.
 *
 * Each walkable query declares its parameters and the entities on its
 * resolution path with a requirement level. readiness.ts walks these to
 * produce Q14 reports; the definitions are also the documentation-of-record
 * for what each query needs.
 *
 * Requirement levels:
 *   required     — absence blocks the query's consumer (Q14: blocker)
 *   recommended  — the query runs but the answer is impoverished (warning)
 *   optional     — enriches the answer (ok when absent, or a suggestion
 *                  where the position makes the absence notable)
 *
 * Only queries with a defined generative/pre-flight consumer are walkable;
 * analytic queries (Q01, Q03, Q04, Q09–Q12, Q15) read whatever exists and
 * have no readiness semantics beyond their constituent walkable queries.
 */

export type Requirement = "required" | "recommended" | "optional";

export interface QueryStep {
  /**
   * The registry entities this step is about. ALWAYS registry entity
   * names, never prose.
   *
   * Free text here cannot be resolved by a third party: `costume +
   * costume_scene` is two entities, `bundle + *_asset_binding` a
   * pattern, `performance_state (vocal)` a filtered subset, and
   * `media: voice_identity` an asset intent rather than an entity at
   * all. Reading those as a person would is not a specification, which
   * is what `filter` and `intent` below are for.
   *
   * `emit_normative_data.mjs` checks every name here against the
   * registry and refuses to publish an unknown one.
   */
  entities: string[];
  /**
   * The entities whose rows decide the step (§12.9.1), where that is
   * fewer than `entities`. The rest are context: they name a finding
   * but cannot satisfy the step. `costume + costume_scene` is the case
   * it exists for — a character's costumes say nothing about what is
   * worn at this scene, so "satisfied by any of them" read literally
   * reported a character wearing nothing here as ready.
   *
   * Absent means every entity the step names decides it.
   */
  satisfiedBy?: string[];
  requirement: Requirement;
  purpose: string;
  /**
   * Narrows the step to a subset of those entities' rows — what a label
   * would otherwise carry as a prose parenthetical. `values` is a
   * disjunction: any one of them satisfies the step.
   */
  filter?: { field: string; values: string[] };
  /**
   * For a media step: the asset intent whose bundle must resolve. The
   * entity is `bundle` either way; this says which one. A step on
   * `bundle` with neither this nor `intentBySubjectType` (Q13's own)
   * takes the target's `intent` parameter.
   */
  intent?: string;
  /**
   * For a media step whose intent depends on the kind of subject asked
   * about: subject kind → intent. Q02's is the case it exists for — the
   * Q13 answer Q02 nests asks a location for `environment` and any other
   * subject for `visual_identity` (§12.16), and a single `intent` said
   * `visual_identity` for all three, so every location was a blocker
   * the text said it was not. Present instead of `intent`, never with it.
   */
  intentBySubjectType?: Record<string, string>;
  /**
   * `"seen"` on a step about how characters look (§12.9): it is assessed
   * only for characters SEEN at the position (§2.4.1, §4.6). A target
   * with a character subject not seen there — heard, named, or not there
   * at all — reports the step as not applying; a target with no subject
   * (Q07) assesses it for each character seen. Until rc.6 only Q07's
   * `purpose` said so, and a reader had to guess for Q02.
   */
  appliesTo?: "seen";
  /**
   * The canonical query that RESOLVES this step's rows (§12.9.1): the
   * step is satisfied by the rows that query's answer lets contribute
   * at the position, and by no other row the step's entities hold.
   * Q13's anchors are the case it exists for — §12.8 keeps only those
   * of the intent's anchor type and verified, and §4.8 keeps a
   * variant's only where it is in force and sets the subject's own
   * aside there. Until rc.7 the step counted every verified anchor
   * naming the subject, and called Marcus pinned at scenes where Q13
   * returns no anchor for him.
   */
  resolvedBy?: string;
  /**
   * Human-readable, DERIVED from the fields above. Present so a
   * renderer has something to print; never the machine-readable part.
   */
  label: string;
}

export interface QueryPath {
  name: string;
  /**
   * The target's parameters under Q14's names for them (§12.9), a
   * trailing `?` marking an optional one. Envelope names, not row-id
   * names: a third party reads this list against §12.9's table.
   */
  params: string[];
  description: string;
  steps: QueryStep[];
}

/** The display label, composed rather than authored. */
function labelFor(entities: string[], filter?: QueryStep["filter"],
                  intent?: string,
                  intentBySubjectType?: Record<string, string>): string {
  if (intent !== undefined) return `media: ${intent}`;
  if (intentBySubjectType !== undefined) {
    return "media: " + Object.entries(intentBySubjectType)
      .map(([kind, i]) => `${kind}=${i}`).join(", ");
  }
  const base = entities.join(" + ");
  return filter === undefined
    ? base : `${base} (${filter.values.join("/")})`;
}

const step = (entities: string[], requirement: Requirement, purpose: string,
              extra: { filter?: QueryStep["filter"]; intent?: string;
                       intentBySubjectType?: Record<string, string>;
                       satisfiedBy?: string[]; appliesTo?: "seen";
                       resolvedBy?: string } = {},
             ): QueryStep => ({
  entities,
  ...(extra.satisfiedBy === undefined
    ? {} : { satisfiedBy: extra.satisfiedBy }),
  requirement,
  purpose,
  ...(extra.filter === undefined ? {} : { filter: extra.filter }),
  ...(extra.intent === undefined ? {} : { intent: extra.intent }),
  ...(extra.intentBySubjectType === undefined
    ? {} : { intentBySubjectType: extra.intentBySubjectType }),
  ...(extra.appliesTo === undefined ? {} : { appliesTo: extra.appliesTo }),
  ...(extra.resolvedBy === undefined ? {} : { resolvedBy: extra.resolvedBy }),
  label: labelFor(entities, extra.filter, extra.intent,
                  extra.intentBySubjectType),
});

export const QUERY_PATHS: Record<string, QueryPath> = {
  Q02: {
    name: "Subject in context",
    params: ["subjectType", "subject", "scene", "shot?"],
    description: "Everything needed to realize a subject in a scene; the " +
                 "character steps apply to a character subject only.",
    steps: [
      step(["character_appearance_profile"], "recommended",
           "static appearance baseline", { appliesTo: "seen" }),
      step(["physical_character_profile"], "recommended",
           "movement/face baseline", { appliesTo: "seen" }),
      step(["vocal_profile"], "optional", "voice baseline"),
      step(["costume", "costume_scene"], "recommended", "what they wear here",
           { satisfiedBy: ["costume_scene"], appliesTo: "seen" }),
      step(["relationship_state"], "optional",
           "where their relationships stand"),
      step(["performance_state"], "optional",
           "scene-scoped modulation (absence = baseline holds)"),
      // Per subject kind, as the Q13 answer Q02 nests asks (§12.16).
      step(["bundle"], "required", "assets to condition on",
           { intentBySubjectType: { character: "visual_identity",
                                    prop: "visual_identity",
                                    location: "environment" } }),
    ],
  },
  Q05: {
    name: "Voice direction",
    params: ["character", "scene"],
    description: "How this character's lines should sound in a scene.",
    steps: [
      step(["vocal_profile"], "required", "the voice baseline"),
      step(["bundle"], "required", "reference audio to condition on",
           { intent: "voice_identity" }),
      step(["performance_state"], "optional",
           "modulation; absence = baseline holds",
           { filter: { field: "modality", values: ["vocal"] } }),
      step(["performance_beat"], "recommended", "per-line direction",
           { filter: { field: "modality", values: ["vocal"] } }),
      step(["dialogue_rhythm"], "recommended", "scene speech rhythm"),
      step(["sound_perspective"], "optional", "whose ears we use"),
    ],
  },
  Q06: {
    name: "Physical direction",
    params: ["character", "scene"],
    description: "How this character moves/behaves in a scene.",
    steps: [
      step(["physical_character_profile"], "required", "movement baseline"),
      step(["scene_blocking", "action_sequence"], "recommended",
           "staging container"),
      step(["performance_state"], "optional",
           "modulation; absence = baseline holds",
           { filter: { field: "modality", values: ["physical"] } }),
      // Physical only: Q06 returns physical beats (§12.6), and a step
      // counting what its target does not read reports a readiness the
      // answer does not have. Facial beats are Q02's and Q04's.
      step(["performance_beat"], "optional", "moment direction",
           { filter: { field: "modality", values: ["physical"] } }),
      step(["character_environment_physicality"], "optional",
           "how they relate to this place"),
      step(["bundle"], "optional", "motion reference",
           { intent: "motion" }),
    ],
  },
  Q07: {
    name: "Look resolution",
    params: ["scene", "shot?"],
    description: "What a frame in this scene/shot should look like.",
    steps: [
      step(["project_color_palette"], "required",
           "the direction cascade's color root"),
      step(["visual_identity"], "required", "material/aesthetic root"),
      step(["color_script"], "optional", "the color script's summary"),
      step(["color_script_entry"], "recommended",
           "position-keyed color intent (latest-wins)"),
      step(["scene_color_palette"], "recommended", "scene color opinion"),
      step(["look_development"], "optional",
           "look development root, on the shot cascade"),
      step(["lighting_design"], "recommended", "scene/shot lighting"),
      step(["shot_design"], "optional", "shot-level composition"),
      step(["character_appearance_profile"], "recommended",
           "each character seen at the position (§2.4.1, §4.6)",
           { appliesTo: "seen" }),
    ],
  },
  Q08: {
    name: "Soundscape",
    params: ["scene"],
    description: "What this scene sounds like.",
    steps: [
      step(["sonic_identity"], "required", "the sound world's root"),
      step(["scene_music_design"], "recommended",
           "authored silence beats accidental silence"),
      step(["location_sound_profile"], "recommended", "the room itself"),
      step(["dialogue_sound_design"], "optional", "speech treatment"),
      step(["sound_cue", "music_cue"], "optional", "specific cues"),
    ],
  },
  Q13: {
    name: "Media resolution",
    params: ["subjectType", "subject", "intent", "scene?", "shot?"],
    description: "Assets in force for a subject and intent.",
    steps: [
      // A media step: only the subject's Q13 references satisfy it. The
      // bindings are context — a binding that exists but is excluded at
      // the position resolves nothing, and without `satisfiedBy` the
      // multi-entity rule called it met (§12.9.1).
      step(["bundle", "character_asset_binding", "costume_asset_binding",
           "location_asset_binding", "prop_asset_binding"], "required",
           "something to resolve", { satisfiedBy: ["bundle"] }),
      // The anchors Q13 lets contribute at the position (§12.8, §4.8):
      // verified (an unset status counts, a candidate pins nothing), of
      // the intent's anchor type, and a variant's only where it is in
      // force. The filter is the part that holds everywhere.
      step(["entity_anchor"], "recommended", "identity pinning",
           { filter: { field: "canonical_status", values: ["verified"] },
             resolvedBy: "Q13" }),
      // An override whose bundle has another intent is not in the answer.
      step(["character_shot_override", "location_shot_override",
           "prop_shot_override"], "optional", "shot-specific swaps",
           { resolvedBy: "Q13" }),
    ],
  },
};
