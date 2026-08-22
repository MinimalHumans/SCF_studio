// SPDX-License-Identifier: Apache-2.0
/**
 * queryPaths.ts — machine-readable canonical query paths (G6, part 2).
 * Canonical query paths; see docs/conventions.md.
 *
 * Each walkable query declares its parameters and the entities on its
 * resolution path with a requirement level. readiness.ts walks these to
 * produce Q14 reports; the definitions are also the documentation-of-record
 * for what each query needs.
 *
 * Requirement levels:
 *   required     — absence blocks the query's consumer (Q14: blocker)
 *   recommended  — the query runs but the answer is impoverished (warning)
 *   optional     — enriches the answer (suggestion when absent)
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
   * This was a single free-text `entity` until 0.38, and several steps
   * used it for things the registry could not resolve: `costume +
   * costume_scene` (two entities), `bundle + *_asset_binding` (a
   * pattern), `performance_state (vocal)` (a filtered subset),
   * `media: voice_identity` (an asset intent, not an entity at all).
   * A third party could reproduce Q14's severities but had to read the
   * labels as a person would, which is not a specification.
   *
   * `emit_normative_data.mjs` now checks every name here against the
   * registry and refuses to publish an unknown one.
   */
  entities: string[];
  requirement: Requirement;
  purpose: string;
  /**
   * Narrows the step to a subset of those entities' rows — the
   * parenthetical the old label carried in prose. `values` is a
   * disjunction: any one of them satisfies the step.
   */
  filter?: { field: string; values: string[] };
  /**
   * For a media step: the asset intent whose bundle must resolve. The
   * entity is `bundle` either way; this says which one.
   */
  intent?: string;
  /**
   * Human-readable, DERIVED from the fields above. Present so a
   * renderer has something to print; never the machine-readable part.
   */
  label: string;
}

export interface QueryPath {
  name: string;
  params: string[];
  description: string;
  steps: QueryStep[];
}

/** The display label, composed rather than authored. */
function labelFor(entities: string[], filter?: QueryStep["filter"],
                  intent?: string): string {
  if (intent !== undefined) return `media: ${intent}`;
  const base = entities.join(" + ");
  return filter === undefined
    ? base : `${base} (${filter.values.join("/")})`;
}

const step = (entities: string[], requirement: Requirement, purpose: string,
              extra: { filter?: QueryStep["filter"]; intent?: string } = {},
             ): QueryStep => ({
  entities,
  requirement,
  purpose,
  ...(extra.filter === undefined ? {} : { filter: extra.filter }),
  ...(extra.intent === undefined ? {} : { intent: extra.intent }),
  label: labelFor(entities, extra.filter, extra.intent),
});

export const QUERY_PATHS: Record<string, QueryPath> = {
  Q02: {
    name: "Subject in context",
    params: ["character_id", "scene_id"],
    description: "Everything needed to realize a character in a scene.",
    steps: [
      step(["character_appearance_profile"], "recommended",
           "static appearance baseline"),
      step(["physical_character_profile"], "recommended",
           "movement/face baseline"),
      step(["vocal_profile"], "optional", "voice baseline"),
      step(["costume", "costume_scene"], "recommended", "what they wear here"),
      step(["relationship_state"], "optional",
           "where their relationships stand"),
      step(["performance_state"], "optional",
           "scene-scoped modulation (absence = baseline holds)"),
      step(["bundle"], "required", "assets to condition on",
           { intent: "visual_identity" }),
    ],
  },
  Q05: {
    name: "Voice direction",
    params: ["character_id", "scene_id"],
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
    params: ["character_id", "scene_id"],
    description: "How this character moves/behaves in a scene.",
    steps: [
      step(["physical_character_profile"], "required", "movement baseline"),
      step(["scene_blocking", "action_sequence"], "recommended",
           "staging container"),
      step(["performance_state"], "optional",
           "modulation; absence = baseline holds",
           { filter: { field: "modality", values: ["physical"] } }),
      step(["performance_beat"], "optional", "moment direction",
           { filter: { field: "modality",
                       values: ["physical", "facial"] } }),
      step(["character_environment_physicality"], "optional",
           "how they relate to this place"),
      step(["bundle"], "optional", "motion reference",
           { intent: "motion" }),
    ],
  },
  Q07: {
    name: "Look resolution",
    params: ["scene_id", "shot_id?"],
    description: "What a frame in this scene/shot should look like.",
    steps: [
      step(["project_color_palette"], "required",
           "the direction cascade's color root"),
      step(["visual_identity"], "required", "material/aesthetic root"),
      step(["color_script_entry"], "recommended",
           "position-keyed color intent (latest-wins)"),
      step(["scene_color_palette"], "recommended", "scene color opinion"),
      step(["lighting_design"], "recommended", "scene/shot lighting"),
      step(["shot_design"], "optional", "shot-level composition"),
      step(["character_appearance_profile"], "recommended", "who's in frame"),
    ],
  },
  Q08: {
    name: "Soundscape",
    params: ["scene_id"],
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
    params: ["subject", "subject_id", "intent", "scene_id?", "shot_id?"],
    description: "Assets in force for a subject and intent.",
    steps: [
      step(["bundle", "character_asset_binding", "location_asset_binding",
           "prop_asset_binding"], "required", "something to resolve"),
      step(["entity_anchor"], "recommended", "identity pinning"),
      step(["character_shot_override", "location_shot_override",
           "prop_shot_override"], "optional", "shot-specific swaps"),
    ],
  },
};
