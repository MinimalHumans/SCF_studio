// SPDX-License-Identifier: Apache-2.0
/**
 * subjectKinds.ts — the three narrative-element workspaces, as data.
 *
 * Characters, Locations and Props share one shell (list, header, "as of
 * scene", subtabs). What differs per kind is named here and nowhere
 * else, so the shell and rail stay one component each.
 */

export type SubjectKind = "character" | "location" | "prop";

export const LOCATION_TABS = [
  "Profile", "Look", "Sound", "Variants", "Scenes",
] as const;
export type LocationTab = typeof LOCATION_TABS[number];

export const PROP_TABS = [
  "Profile", "Look", "Variants", "Through the story", "Scenes",
] as const;
export type PropTab = typeof PROP_TABS[number];

export interface KindSpec {
  entity: SubjectKind;
  /** "character" — used in "New character", "No characters yet". */
  noun: string;
  plural: string;
  /** The column shown under each name in the list: role, type. */
  metaField: string;
  /** The variant table, and its column naming the owner. */
  variantEntity: string;
  /** SQL giving the scene ids this subject is present in, `?` = its id.
   *  Characters and props are linked per scene; a location is where a
   *  scene is set. */
  presenceSql: string;
}

export const KINDS: Record<SubjectKind, KindSpec> = {
  character: {
    entity: "character", noun: "character", plural: "characters",
    metaField: "role", variantEntity: "character_variant",
    presenceSql: "SELECT scene_id FROM scene_character WHERE character_id = ?",
  },
  location: {
    entity: "location", noun: "location", plural: "locations",
    metaField: "location_type", variantEntity: "location_variant",
    presenceSql: "SELECT id AS scene_id FROM scene WHERE location_id = ?",
  },
  prop: {
    entity: "prop", noun: "prop", plural: "props",
    metaField: "prop_type", variantEntity: "prop_variant",
    presenceSql: "SELECT scene_id FROM scene_prop WHERE prop_id = ?",
  },
};
