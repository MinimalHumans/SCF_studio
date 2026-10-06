// SPDX-License-Identifier: Apache-2.0
/**
 * characterLayout.ts — what the Characters workspace shows, and where.
 *
 * Data, not views, so tests can check it against the registry without
 * importing a component (a view import starts the SQL worker). Every
 * field and entity named here must exist; `characterLayout.test.ts`
 * fails when the schema moves under it, rather than the page quietly
 * dropping a field.
 */

import type { SqlValue } from "@scf-core/db.ts";

/** The character workspace's subtabs, in the order they are shown. */
export const CHARACTER_TABS = [
  "Profile", "Look", "Wardrobe", "Voice", "Physicality",
  "Relationships", "Arc", "Scenes & Lines",
] as const;
export type CharacterTab = typeof CHARACTER_TABS[number];

/**
 * The fields of `character`, grouped the way a writer develops them
 * rather than by the schema's General / Backstory / Notes tabs.
 */
export const PROFILE_SECTIONS: Array<{
  title: string; note?: string; fields: string[]; grid?: boolean;
}> = [
  { title: "Identity", grid: true,
    fields: ["role", "archetype", "age", "gender", "pronouns", "occupation"] },
  { title: "Summary", fields: ["summary"] },
  { title: "Drives",
    note: "What they want, what is in the way, and what they believe.",
    fields: ["motivation", "external_goal", "internal_goal", "flaw",
             "greatest_fear", "core_belief"] },
  { title: "History",
    fields: ["backstory", "education_level", "skills_abilities"] },
];

/** Character fields the workspace shows somewhere other than the sections. */
export const PROFILE_ELSEWHERE: Record<string, string> = {
  name: "the header",
  casting_status: "Profile, Casting",
  notes: "Profile, Notes",
  arc_description: "the Arc tab, where it reads as the arc's summary",
};

/** One kind of record a tab will edit, and how to find this character's. */
export interface RecordSource {
  entity: string;
  /** SQL condition with `?` for the character id, each occurrence. */
  where: string;
  /** Values pre-filled when "New" is used from here. */
  prefill: (characterId: number) => Record<string, SqlValue>;
  label: string;
}

const own = (entity: string, label: string): RecordSource => ({
  entity, where: "character_id = ?", label,
  prefill: (id) => ({ character_id: id }),
});

/**
 * What each tab will cover, as records. Until a tab is built it lists
 * these, so the character's material is reachable from the workspace
 * from the start, just not yet in its friendly form.
 */
export const PENDING_SOURCES: Partial<Record<CharacterTab, RecordSource[]>> = {
  Look: [
    own("character_appearance_profile", "Appearance"),
    own("character_color_identity", "Color identity"),
    { entity: "entity_anchor", label: "Identity references",
      where: "subject_type = 'character' AND subject_id = ?",
      prefill: (id) => ({ subject_type: "character", subject_id: id,
                          anchor_type: "visual" }) },
    own("character_asset_binding", "Reference sets"),
  ],
  Wardrobe: [
    own("costume", "Costumes"),
    own("costume_progression", "Wardrobe through the story"),
    own("makeup_hair_design", "Makeup & hair"),
  ],
  Voice: [
    own("vocal_profile", "Voice"),
    { entity: "performance_state", label: "Vocal shifts",
      where: "character_id = ? AND modality = 'vocal'",
      prefill: (id) => ({ character_id: id, modality: "vocal" }) },
    own("voiceover_design", "Voiceover"),
  ],
  Physicality: [
    own("physical_character_profile", "Physicality"),
    own("physical_habit", "Habits"),
    { entity: "performance_state", label: "Physical shifts",
      where: "character_id = ? AND modality = 'physical'",
      prefill: (id) => ({ character_id: id, modality: "physical" }) },
    own("character_environment_physicality", "In the environment"),
  ],
  Relationships: [
    { entity: "character_relationship", label: "Relationships",
      where: "character_a_id = ? OR character_b_id = ?",
      prefill: (id) => ({ character_a_id: id }) },
  ],
  Arc: [own("character_arc", "Arcs")],
  "Scenes & Lines": [
    { entity: "scene_character", label: "Scenes",
      where: "character_id = ?", prefill: (id) => ({ character_id: id }) },
  ],
};
