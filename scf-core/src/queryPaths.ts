/**
 * queryPaths.ts — machine-readable canonical query paths (G6, part 2).
 * Port of scf-editor/query_paths.py.
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
  entity: string;
  requirement: Requirement;
  purpose: string;
}

export interface QueryPath {
  name: string;
  params: string[];
  description: string;
  steps: QueryStep[];
}

const step = (entity: string, requirement: Requirement,
              purpose: string): QueryStep => ({ entity, requirement, purpose });

export const QUERY_PATHS: Record<string, QueryPath> = {
  Q02: {
    name: "Subject in context",
    params: ["character_id", "scene_id"],
    description: "Everything needed to realize a character in a scene.",
    steps: [
      step("character_appearance_profile", "recommended",
           "static appearance baseline"),
      step("physical_character_profile", "recommended",
           "movement/face baseline"),
      step("vocal_profile", "optional", "voice baseline"),
      step("costume + costume_scene", "recommended", "what they wear here"),
      step("relationship_state", "optional",
           "where their relationships stand"),
      step("performance_state", "optional",
           "scene-scoped modulation (absence = baseline holds)"),
      step("media: visual_identity", "required", "assets to condition on"),
    ],
  },
  Q05: {
    name: "Voice direction",
    params: ["character_id", "scene_id"],
    description: "How this character's lines should sound in a scene.",
    steps: [
      step("vocal_profile", "required", "the voice baseline"),
      step("media: voice_identity", "required",
           "reference audio to condition on"),
      step("performance_state (vocal)", "optional",
           "modulation; absence = baseline holds"),
      step("performance_beat (vocal)", "recommended", "per-line direction"),
      step("dialogue_rhythm", "recommended", "scene speech rhythm"),
      step("sound_perspective", "optional", "whose ears we use"),
    ],
  },
  Q06: {
    name: "Physical direction",
    params: ["character_id", "scene_id"],
    description: "How this character moves/behaves in a scene.",
    steps: [
      step("physical_character_profile", "required", "movement baseline"),
      step("scene_blocking / action_sequence", "recommended",
           "staging container"),
      step("performance_state (physical)", "optional",
           "modulation; absence = baseline holds"),
      step("performance_beat (physical/facial)", "optional",
           "moment direction"),
      step("character_environment_physicality", "optional",
           "how they relate to this place"),
      step("media: motion", "optional", "motion reference"),
    ],
  },
  Q07: {
    name: "Look resolution",
    params: ["scene_id", "shot_id?"],
    description: "What a frame in this scene/shot should look like.",
    steps: [
      step("project_color_palette", "required",
           "the direction cascade's color root"),
      step("visual_identity", "required", "material/aesthetic root"),
      step("color_script_entry", "recommended",
           "position-keyed color intent (latest-wins)"),
      step("scene_color_palette", "recommended", "scene color opinion"),
      step("lighting_design", "recommended", "scene/shot lighting"),
      step("shot_design", "optional", "shot-level composition"),
      step("character_appearance_profile (per cast)", "recommended",
           "who's in frame"),
    ],
  },
  Q08: {
    name: "Soundscape",
    params: ["scene_id"],
    description: "What this scene sounds like.",
    steps: [
      step("sonic_identity", "required", "the sound world's root"),
      step("scene_music_design", "recommended",
           "authored silence beats accidental silence"),
      step("location_sound_profile", "recommended", "the room itself"),
      step("dialogue_sound_design", "optional", "speech treatment"),
      step("sound_cue / music_cue", "optional", "specific cues"),
    ],
  },
  Q13: {
    name: "Media resolution",
    params: ["subject", "subject_id", "intent", "scene_id?", "shot_id?"],
    description: "Assets in force for a subject and intent.",
    steps: [
      step("bundle + *_asset_binding", "required", "something to resolve"),
      step("entity_anchor", "recommended", "identity pinning"),
      step("*_shot_override", "optional", "shot-specific swaps"),
    ],
  },
};
