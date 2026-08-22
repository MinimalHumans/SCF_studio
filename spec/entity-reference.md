<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Entity reference

Schema **2.12** — **99 entities**.

**Generated from `registry.json`. Not normative, and not hand-edited.**
`spec/scf-spec.md` states the rules; the registry states the field set.
This document restates the second so a person can read it. Where it
disagrees with either, they are right and this is a bug — file an issue.

It does not explain what entities are *for*. Descriptions are the
registry's own, and are as good as what is written there.

## Every table carries these

| Column | Type | |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` |  |
| `uuid` | `TEXT` | cross-file row identity (schema 2.3); unique index; stamped on insert |
| `created_at` | `TEXT` |  |
| `updated_at` | `TEXT` |  |

`id`, `created_at` and `updated_at` never appear in a query result
(§12.1.2). `uuid` is the identity that travels between files (§6.1);
`id` is file-local and means nothing outside the file it is in (§6.2).

## Contents

- **Tier 0** (24) — Structural foundation
- **Tier 1** (9) — Project-level creative direction
- **Tier 2** (30) — Depth — character, prop and location
- **Tier 3** (7) — Scene detail
- **Tier 4** (8) — Thematic tracking
- **Tier 5** (4) — Emotional architecture
- **Tier 6** (17) — Production

---

## Tier 0

*Structural foundation*

### `act`

A major structural division of the story.

| | |
|---|---|
| Label | Act / Acts |
| Category | Story Structure |
| Subject | story |
| Scope | act |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (4) | `sequence.act_id`, `character_asset_binding.act_id`, `prop_asset_binding.act_id`, `location_asset_binding.act_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `act_number` | integer |  |  |
| `start_scene_id` | reference |  | → `scene` (resolves to `start_scene_uuid` in a result, §12.1.2). The scene this act begins at. The act runs until the next act begins, so no end is stored and acts cannot overlap or leave gaps. |
| `function` | textarea |  |  |
| `dramatic_question` | textarea |  |  |
| `shift` | textarea |  |  |
| `summary` | textarea |  |  |
| `status` | select |  | one of `outline`, `draft`, `revised`, `locked`, `cut`. default `outline`. Writing-process status. Distinct from lifecycle_status. |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `action_sequence_character`

Links characters to action sequences with their role.

| | |
|---|---|
| Label | Action Sequence-Character / Action Sequence-Characters |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `action_sequence_id` | reference | **yes** | → `action_sequence` (resolves to `action_sequence_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `role_in_action` | text |  |  |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `actor_character_role`

Junction: actor + character + role type.

| | |
|---|---|
| Label | Actor-Character Role / Actor-Character Roles |
| Category | Connections |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `actor_id` | reference | **yes** | → `actor` (resolves to `actor_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `role_type` | select | **yes** | one of `principal`, `body_double`, `stunt_double`, `voice_double`, `adr`, `motion_capture`, `reference_only`, `other` |
| `scope` | select |  | one of `whole_project`, `specific_scenes`, `specific_takes`. default `whole_project` |
| `scope_details` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `asset`

A REFERENCE to something outside the file — image, audio, 3D model, model weight, document. The atomic unit that bundles compose. Versionable — supports asset version chains.

| | |
|---|---|
| Label | Asset / Assets |
| Category | Metadata |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | yes |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (5) | `bundle_asset.asset_id`, `entity_anchor.asset_id`, `asset.parent_id`, `asset.superseded_by_id`, `asset_relationship.asset_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `identifier` | text |  | Rooted, portable address of the bytes. @project is the project folder. Resolution is derived and never stored. See spec §8.2. |
| `size_bytes` | integer |  | Cached hint for staleness detection. Not authoritative — the file may have changed. |
| `source_mtime` | timestamp |  | Cached hint for staleness detection. |
| `content_hash` | text |  | Optional and opportunistic. Never computed on open — hashing a project's assets would stall on unmaterialised cloud files. |
| `description` | textarea |  |  |
| `tags` | json |  | Freeform and user-controlled. There is deliberately no intrinsic-purpose field: what an asset is FOR is a property of the link that reaches it, not of the row. |
| `source` | text |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `parent_id` | reference |  | → `asset` (resolves to `parent_uuid` in a result, §12.1.2). auto-injected by the generator. Previous version in the chain. Null for root version. |
| `version_label` | text |  | auto-injected by the generator. Human-readable version identifier. Tool-managed. |
| `superseded_at` | timestamp |  | auto-injected by the generator. Set when a successor version becomes active. |
| `superseded_by_id` | reference |  | → `asset` (resolves to `superseded_by_uuid` in a result, §12.1.2). auto-injected by the generator. Forward pointer to successor. Auto-set on supersession. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `asset_relationship`

Links an asset to an entity it documents or references. Open polymorphism — entity_type is open-ended.

| | |
|---|---|
| Label | Asset Relationship / Asset Relationships |
| Category | Connections |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `asset_id` | reference | **yes** | → `asset` (resolves to `asset_uuid` in a result, §12.1.2) |
| `entity_type` | text | **yes** | Open-ended — any entity name. |
| `entity_id` | integer | **yes** |  |
| `relationship_type` | select |  | one of `reference`, `documentation`, `concept`, `inspiration`, `final`, `other` |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `bundle_asset`

Junction: assets that compose a bundle.

| | |
|---|---|
| Label | Bundle-Asset / Bundle-Assets |
| Category | Connections |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `bundle_id` | reference | **yes** | → `bundle` (resolves to `bundle_uuid` in a result, §12.1.2) |
| `asset_id` | reference | **yes** | → `asset` (resolves to `asset_uuid` in a result, §12.1.2) |
| `role_in_bundle` | text |  |  |
| `order` | integer |  |  |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `character`

A character in the story. Identity and narrative function only — physical/vocal/wardrobe details live in Tier 2 description entities.

| | |
|---|---|
| Label | Character / Characters |
| Category | Story Entities |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (27) | `prop.associated_character_id`, `story_beat.pov_character_id`, `scene_character.character_id`, `character_relationship.character_a_id`, `character_relationship.character_b_id`, `physical_character_profile.character_id`, `vocal_profile.character_id`, `character_appearance_profile.character_id`, `costume.character_id`, `costume_progression.character_id`, `makeup_hair_design.character_id`, `character_variant.character_id`, `physical_habit.character_id`, `prop_state.custody_character_id`, `character_asset_binding.character_id`, `actor_character_role.character_id`, `clip_character.character_id`, `character_shot_override.character_id`, `character_color_identity.character_id`, `identification_strategy.primary_character_id`, `identification_strategy.secondary_character_id`, `action_sequence_character.character_id`, `performance_state.character_id`, `performance_beat.character_id`, `character_environment_physicality.character_id`, `sound_perspective.pov_character_id`, `voiceover_design.character_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `role` | select |  | one of `protagonist`, `antagonist`, `supporting`, `minor`, `background`, `narrator` |
| `archetype` | text |  |  |
| `age` | text |  |  |
| `gender` | text |  |  |
| `pronouns` | text |  |  |
| `occupation` | text |  |  |
| `casting_status` | select |  | one of `tbd`, `cast`, `actor_as_character`, `digital_double`, `generated_only`. default `tbd`. Whether this character has a real-world actor anchor. Drives downstream tool expectations. |
| `summary` | textarea |  |  |
| `backstory` | textarea |  |  |
| `motivation` | textarea |  |  |
| `flaw` | text |  |  |
| `arc_description` | textarea |  |  |
| `internal_goal` | textarea |  |  |
| `external_goal` | textarea |  |  |
| `greatest_fear` | textarea |  |  |
| `core_belief` | textarea |  |  |
| `education_level` | text |  |  |
| `skills_abilities` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `clip_character`

Junction: characters present in a clip with their role.

| | |
|---|---|
| Label | Clip-Character / Clip-Characters |
| Category | Connections |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `clip_id` | reference | **yes** | → `clip` (resolves to `clip_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `role_in_clip` | select |  | one of `featured`, `supporting`, `background`. default `featured` |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `clip_prop`

Junction: props present in a clip with their role. Parallel to clip_character. Supports queries like 'every clip featuring the locket' — useful for production review and for assembling prop-identity training sets.

| | |
|---|---|
| Label | Clip-Prop / Clip-Props |
| Category | Connections |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `clip_id` | reference | **yes** | → `clip` (resolves to `clip_uuid` in a result, §12.1.2) |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `role_in_clip` | select |  | one of `featured`, `supporting`, `background`. default `featured` |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `collaboration_note`

Notes for or from collaborators.

| | |
|---|---|
| Label | Collaboration Note / Collaboration Notes |
| Category | Metadata |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `note_type` | select |  | one of `for cinematographer`, `for production designer`, `for costume designer`, `for sound designer`, `for composer`, `for editor`, `for actors`, `general` |
| `content` | textarea | **yes** |  |
| `priority` | select |  | one of `low`, `medium`, `high`, `critical` |
| `affected_entities` | json |  |  |
| `author` | text |  |  |
| `note_date` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `costume_scene`

Links a costume to the scenes where it appears.

| | |
|---|---|
| Label | Costume-Scene / Costume-Scenes |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Explicit — the row names the scene it applies to. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `costume_id` | reference | **yes** | → `costume` (resolves to `costume_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `condition_in_scene` | text |  |  |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `creative_decision`

A recorded creative decision with rationale.

| | |
|---|---|
| Label | Creative Decision / Creative Decisions |
| Category | Metadata |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `decision_type` | select |  | one of `casting`, `visual`, `narrative`, `technical`, `audio`, `design`, `structural`, `other` |
| `description` | textarea |  |  |
| `rationale` | textarea |  |  |
| `alternatives_considered` | textarea |  |  |
| `affected_entities` | json |  |  |
| `decision_date` | text |  |  |
| `decided_by` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location`

A location where story events take place. Identity and narrative function only — architectural/visual detail lives in location_design, color in location_color_scheme, sound in location_sound_profile, and state variation (time-of-day, weather, post-event) in location_variant.

| | |
|---|---|
| Label | Location / Locations |
| Category | Story Entities |
| Subject | location |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (9) | `scene.location_id`, `location_design.location_id`, `location_variant.location_id`, `location_color_scheme.location_id`, `location_sound_profile.location_id`, `location_asset_binding.location_id`, `location_shot_override.location_id`, `set_dressing.location_id`, `character_environment_physicality.location_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `location_type` | select |  | one of `interior`, `exterior`, `int/ext`, `virtual`, `abstract` |
| `setting` | textarea |  |  |
| `time_period` | text |  |  |
| `geography` | text |  |  |
| `realization_status` | select |  | one of `tbd`, `real_location`, `built`, `plate_captured`, `virtual_set`, `hybrid`, `generated_only`. default `tbd`. How this location is realized in production. real_location = found and shot in-camera; built = constructed set; plate_captured = photographic plate only; virtual_set = LED wall / volumetric; hybrid = combined methods (practical + extension etc.); generated_only = fully synthetic. |
| `key_features` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `motif_appearance`

Where a motif manifests in the story. Open polymorphism — entity_type is open-ended; domain records the sensory channel. Replaces visual_motif_appearance and motif_manifestation (2.0 consolidation).

| | |
|---|---|
| Label | Motif Appearance / Motif Appearances |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `motif_id` | reference | **yes** | → `motif` (resolves to `motif_uuid` in a result, §12.1.2) |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `entity_type` | select |  | one of `location`, `prop`, `costume`, `character`, `scene`, `shot`. Open polymorphism — names the table entity_id points into. Optional when the appearance is scoped by scene alone. |
| `entity_id` | integer |  |  |
| `domain` | select |  | one of `visual`, `sonic`, `dialogue`, `action`. The sensory/dramatic channel the motif manifests through. |
| `manifestation_notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `project`

The root container for an SCF story project.

| | |
|---|---|
| Label | Project / Projects |
| Category | Project |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `logline` | textarea |  |  |
| `genre` | select |  | one of `drama`, `comedy`, `thriller`, `sci-fi`, `fantasy`, `horror`, `action`, `romance`, `documentary`, `animation`, `western`, `other` |
| `tone` | text |  |  |
| `setting_period` | text |  |  |
| `target_runtime` | integer |  |  |
| `project_format` | select |  | one of `feature`, `series`, `short`, `commercial`, `other` |
| `production_status` | select |  | one of `development`, `pre_production`, `production`, `post_production`, `complete`. default `development`. Project-level production phase axis. |
| `workflow_mode` | select |  | one of `performance_first`, `generation_first`, `hybrid`. default `generation_first`. Dominant production workflow stance. |
| `numbering_policy` | select |  | one of `derived`, `fixed`. default `derived`. Governs ALL FOUR authored numbers — act, sequence, scene and shot. derived: recomputed from the script's order at every commit, which is what a writer still moving the story wants. fixed: never touched. Once a production is greenlit the numbers leave the building on schedules and call sheets and become identifiers, and a scene numbered 12 that plays after scene 45 is correct. See spec §4.3. |
| `notes` | textarea |  |  |
| `vision_statement` | textarea |  |  |
| `creative_philosophy` | textarea |  |  |
| `themes` | json |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `prop`

A significant object in the story. Identity, narrative function, and story moments — surface/material detail lives in prop_surface_profile, state variation (clean/damaged/symbolic) in prop_variant.

| | |
|---|---|
| Label | Prop / Props |
| Category | Story Entities |
| Subject | prop |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (7) | `scene_prop.prop_id`, `prop_surface_profile.prop_id`, `prop_variant.prop_id`, `prop_state.prop_id`, `prop_asset_binding.prop_id`, `clip_prop.prop_id`, `prop_shot_override.prop_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `prop_type` | select |  | one of `hand prop`, `set dressing`, `vehicle`, `weapon`, `document`, `technology`, `clothing item`, `food/drink`, `other` |
| `description` | textarea |  |  |
| `realization_status` | select |  | one of `tbd`, `sourced`, `built`, `scanned`, `hybrid`, `generated_only`. default `tbd`. How this prop is realized in production. sourced = found / purchased real object; built = fabricated; scanned = real object digitally captured; hybrid = combined methods (practical + VFX, sourced + CG damage, plate replacement, miniature, etc.); generated_only = fully synthetic. |
| `narrative_significance` | textarea |  |  |
| `story_function` | select |  | one of `macguffin`, `character extension`, `plot device`, `symbol`, `atmosphere`, `other` |
| `associated_character_id` | reference |  | → `character` (resolves to `associated_character_uuid` in a result, §12.1.2) |
| `first_appearance` | textarea |  |  |
| `key_moments` | textarea |  |  |
| `symbolism` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `scene`

A single scene in the story.

| | |
|---|---|
| Label | Scene / Scenes |
| Category | Story Structure |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (47) | `act.start_scene_id`, `sequence.start_scene_id`, `story_beat.scene_id`, `scene_character.scene_id`, `scene_prop.scene_id`, `scene_sequence.scene_id`, `relationship_state.scene_id`, `costume_scene.scene_id`, `makeup_hair_design.scene_id`, `prop_state.scene_id`, `character_asset_binding.scene_range_start_id`, `character_asset_binding.scene_range_end_id`, `prop_asset_binding.scene_range_start_id`, `prop_asset_binding.scene_range_end_id`, `location_asset_binding.scene_range_start_id`, `location_asset_binding.scene_range_end_id`, `take_scene.scene_id`, `clip.scene_id`, `scene_emotional_target.scene_id`, `scene_color_palette.scene_id`, `lighting_design.scene_id`, `scene_music_design.scene_id`, `tone_marker.scene_id`, `set_dressing.scene_id`, `dialogue_sound_design.scene_id`, `motif.first_appearance_scene_id`, `motif_state.scene_id`, `motif_appearance.scene_id`, `subtext.scene_id`, `color_script_entry.scene_id`, `emotional_beat.scene_id`, `information_strategy.scene_id`, `identification_strategy.scene_id`, `shot.scene_id`, `shot_language.scene_id`, `scene_blocking.scene_id`, `action_sequence.scene_id`, `performance_state.scene_id`, `performance_state.resolved_at_scene_id`, `performance_beat.scene_id`, `dialogue_rhythm.scene_id`, `movement_choreography.scene_id`, `sound_cue.scene_id`, `music_cue.scene_id`, `sound_perspective.scene_id`, `voiceover_design.scene_id`, `music_sound_relationship.scene_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_number` | text |  | A label, not the position: 12, 12A (inserted after 12), A12 (inserted before it). Ordering comes from the script. See spec/scf-spec.md §4.2. |
| `int_ext` | select |  | one of `interior`, `exterior`, `int/ext` |
| `location_id` | reference |  | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `time_of_day` | select |  | one of `dawn`, `morning`, `midday`, `afternoon`, `dusk`, `night`, `continuous` |
| `weather_conditions` | text |  |  |
| `season` | select |  | one of `spring`, `summer`, `autumn`, `winter`, `unspecified` |
| `summary` | textarea |  |  |
| `purpose` | textarea |  |  |
| `status` | select |  | one of `outline`, `draft`, `revised`, `locked`, `cut`. default `outline` |
| `character_dynamics` | textarea |  |  |
| `emotional_beat` | textarea |  |  |
| `tone` | text |  |  |
| `tension_level` | integer |  |  |
| `thematic_connection` | textarea |  |  |
| `visual_style` | textarea |  |  |
| `sound_design` | textarea |  |  |
| `music_notes` | textarea |  |  |
| `estimated_duration` | integer |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `scene_character`

Links a character to a scene with role information.

| | |
|---|---|
| Label | Scene-Character / Scene-Characters |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `role_in_scene` | select |  | one of `featured`, `supporting`, `background`, `mentioned`, `voiceover` |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `scene_prop`

Links a prop to a scene with usage details.

| | |
|---|---|
| Label | Scene-Prop / Scene-Props |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `usage_note` | text |  |  |
| `significance` | select |  | one of `key`, `present`, `background`, `mentioned` |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `scene_sequence`

Links a scene to a sequence with ordering.

| | |
|---|---|
| Label | Scene-Sequence / Scene-Sequences |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `sequence_id` | reference | **yes** | → `sequence` (resolves to `sequence_uuid` in a result, §12.1.2) |
| `order_in_sequence` | integer |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `sequence`

A group of related scenes forming a narrative unit.

| | |
|---|---|
| Label | Sequence / Sequences |
| Category | Story Structure |
| Subject | story |
| Scope | sequence |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (3) | `scene_sequence.sequence_id`, `tone_marker.sequence_id`, `emotional_beat.sequence_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `sequence_number` | integer |  |  |
| `act_id` | reference |  | → `act` (resolves to `act_uuid` in a result, §12.1.2) |
| `start_scene_id` | reference |  | → `scene` (resolves to `start_scene_uuid` in a result, §12.1.2). The scene this sequence begins at. It runs until the next sequence begins. |
| `summary` | textarea |  |  |
| `goal` | textarea |  |  |
| `conflict` | textarea |  |  |
| `outcome` | textarea |  |  |
| `purpose` | textarea |  |  |
| `turning_point` | textarea |  |  |
| `status` | select |  | one of `outline`, `draft`, `revised`, `locked`, `cut`. default `outline` |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `story_beat`

A discrete narrative unit within a scene — a moment of change.

| | |
|---|---|
| Label | Story Beat / Story Beats |
| Category | Story Structure |
| Subject | story |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `clip.beat_id`, `shot.story_beat_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `beat_order` | integer |  |  |
| `beat_type` | select |  | one of `setup`, `action`, `reaction`, `decision`, `discovery`, `revelation`, `reversal`, `payoff`, `other` |
| `description` | textarea |  |  |
| `purpose` | textarea |  |  |
| `value_shift` | text |  |  |
| `pov_character_id` | reference |  | → `character` (resolves to `pov_character_uuid` in a result, §12.1.2) |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `take_scene`

Junction: scenes covered by a take. Takes can cross scenes.

| | |
|---|---|
| Label | Take-Scene / Take-Scenes |
| Category | Connections |
| Subject | link |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | **no** — this entity cannot be marked cut |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `take_id` | reference | **yes** | → `take` (resolves to `take_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `order_in_take` | integer |  |  |
| `coverage_completeness` | select |  | one of `partial`, `complete`, `incidental`. default `complete` |
| `notes` | textarea |  |  |

*1 hidden field(s) omitted — present in the table, not offered for authoring.*

### `theme`

A thematic element that runs through the story.

| | |
|---|---|
| Label | Theme / Themes |
| Category | Vision |
| Subject | theme |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `thematic_connection.theme_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `description` | textarea |  |  |
| `motifs` | json |  |  |
| `character_connections` | textarea |  |  |
| `scene_connections` | textarea |  |  |
| `evolution` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 1

*Project-level creative direction*

### `cinematographic_philosophy`

Overall approach to camera, movement, visual storytelling, and coverage (absorbed coverage_philosophy in the 2.0 consolidation).

| | |
|---|---|
| Label | Cinematographic Philosophy / Cinematographic Philosophy |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Cinematographic Philosophy` |
| `camera_personality` | select |  | one of `objective observer`, `subjective participant`, `omniscient presence`, `character-aligned` |
| `movement_philosophy` | select |  | one of `static`, `fluid`, `motivated`, `expressive` |
| `framing_philosophy` | select |  | one of `classical`, `dynamic`, `intimate`, `epic` |
| `visual_consistency` | select |  | one of `unified`, `varied`, `evolving` |
| `coverage_style` | select |  | one of `master + coverage`, `single camera`, `multi-camera`, `oner/long take`, `run-and-gun`, `shot-list driven` |
| `editorial_approach` | select |  | one of `cut-friendly`, `in-camera editing`, `improvised` |
| `coverage_priorities` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `costume_design_philosophy`

Overall approach to wardrobe and costume design.

| | |
|---|---|
| Label | Costume Design Philosophy / Costume Design Philosophy |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Costume Design Philosophy` |
| `design_approach` | select |  | one of `period-accurate`, `period-inspired`, `contemporary`, `timeless`, `stylized`, `fantastical` |
| `silhouette_strategy` | textarea |  |  |
| `fabric_philosophy` | select |  | one of `natural`, `synthetic`, `mixed` |
| `formality_spectrum` | textarea |  |  |
| `condition_philosophy` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `look_development`

Target visual look for the final image — grading and post direction.

| | |
|---|---|
| Label | Look Development / Look Development |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Look Development` |
| `contrast` | select |  | one of `flat`, `normal`, `high` |
| `saturation` | select |  | one of `desaturated`, `normal`, `vivid` |
| `color_bias` | select |  | one of `warm`, `cool`, `neutral`, `tinted` |
| `highlight_handling` | select |  | one of `preserved`, `blown`, `rolled-off` |
| `shadow_handling` | select |  | one of `crushed`, `lifted`, `detailed` |
| `grain_texture` | select |  | one of `clean`, `subtle grain`, `heavy grain` |
| `on_set_lut` | text |  |  |
| `editorial_lut` | text |  |  |
| `final_grade_foundation` | textarea |  |  |
| `reference_images` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `project_color_palette`

Overall color scheme, color rules, and warm/cool temperature strategy for the entire project (absorbed color_temperature_strategy in the 2.0 consolidation).

| | |
|---|---|
| Label | Project Color Palette / Project Color Palette |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Project Color Palette` |
| `primary_colors` | json |  |  |
| `secondary_colors` | json |  |  |
| `accent_colors` | json |  |  |
| `restricted_colors` | json |  |  |
| `saturation_philosophy` | select |  | one of `highly saturated`, `desaturated`, `mixed`, `neutral-heavy` |
| `value_structure` | select |  | one of `high key`, `low key`, `full range`, `compressed` |
| `temperature_approach` | select |  | one of `warm`, `cool`, `balanced`, `journey` |
| `temperature_associations` | textarea |  | What warmth and coolness each mean in this story. |
| `temperature_contrast_points` | textarea |  |  |
| `day_scene_temperature` | text |  |  |
| `night_scene_temperature` | text |  |  |
| `color_evolution` | textarea |  |  |
| `color_relationships` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `project_tone`

Overall tonal identity and story-level rhythm — the emotional temperature and pacing of the film (absorbed pacing_strategy in the 2.0 consolidation).

| | |
|---|---|
| Label | Project Tone / Project Tone |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Project Tone` |
| `primary_tone` | text |  |  |
| `tone_blend` | json |  |  |
| `lightest_moment` | textarea |  |  |
| `darkest_moment` | textarea |  |  |
| `tonal_consistency` | select |  | one of `unified`, `varied`, `shifting` |
| `reference_touchstones` | textarea |  |  |
| `overall_pacing` | select |  | one of `slow/contemplative`, `moderate/balanced`, `fast/urgent`, `variable/dynamic` |
| `pacing_philosophy` | textarea |  |  |
| `breathing_room_strategy` | textarea |  |  |
| `pacing_inflection_points` | textarea |  | Key acceleration and deceleration points across the story. |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `project_vision`

Overarching creative intent and the director's approach to realizing it. Absorbed directorial_philosophy in the 2.0 consolidation.

| | |
|---|---|
| Label | Project Vision / Project Vision |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Project Vision` |
| `vision_statement` | textarea |  |  |
| `core_question` | textarea |  |  |
| `intended_audience_impact` | textarea |  |  |
| `unique_perspective` | textarea |  |  |
| `why_tell_this_story` | textarea |  |  |
| `what_makes_different` | textarea |  |  |
| `success_criteria` | textarea |  |  |
| `filmmaking_philosophy` | select |  | one of `auteur`, `collaborative`, `actor-focused`, `visual-first`, `story-first`, `experiential` |
| `technical_approach` | select |  | one of `naturalistic`, `stylized`, `mixed` |
| `aesthetic_priorities` | json |  |  |
| `risk_tolerance` | select |  | one of `safe/commercial`, `experimental`, `balanced` |
| `audience_relationship` | select |  | one of `accessible`, `challenging`, `hybrid` |
| `personal_resonance` | textarea |  |  |
| `emotional_stakes` | textarea |  |  |
| `artistic_growth_goals` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `sonic_identity`

Overall approach to the film's sound and music world (absorbed musical_identity in the 2.0 consolidation).

| | |
|---|---|
| Label | Sonic Identity / Sonic Identity |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Sonic Identity` |
| `sound_aesthetic` | select |  | one of `naturalistic`, `heightened`, `stylized`, `surreal` |
| `sonic_density` | select |  | one of `sparse`, `moderate`, `dense`, `overwhelming` |
| `silence_philosophy` | textarea |  |  |
| `subjective_sound_approach` | textarea |  |  |
| `sound_evolution` | textarea |  |  |
| `score_approach` | select |  | one of `traditional orchestral`, `electronic/synthesized`, `hybrid`, `acoustic/intimate`, `genre-specific` |
| `musical_tone` | select |  | one of `emotional support`, `counterpoint`, `commentary`, `neutral/ambient` |
| `instrumentation_palette` | textarea |  |  |
| `score_density` | select |  | one of `wall-to-wall`, `selective`, `sparse` |
| `source_music_approach` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `technical_specs`

Technical format specifications for the project.

| | |
|---|---|
| Label | Technical Specs / Technical Specs |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Technical Specs` |
| `aspect_ratio` | select |  | one of `1.33:1 (academy)`, `1.66:1`, `1.78:1 (16:9)`, `1.85:1 (flat)`, `2.00:1 (univisium)`, `2.20:1 (70mm)`, `2.35:1 (scope)`, `2.39:1 (anamorphic)`, `2.76:1 (ultra panavision)`, `variable`, `other` |
| `resolution` | select |  | one of `2K (2048x1080)`, `2.8K`, `3.4K`, `4K (4096x2160)`, `4.6K`, `5.7K`, `6K`, `6.5K`, `8K`, `other` |
| `frame_rate` | select |  | one of `23.976 fps`, `24 fps`, `25 fps`, `29.97 fps`, `30 fps`, `48 fps`, `60 fps`, `variable`, `other` |
| `color_space` | text |  |  |
| `recording_codec` | text |  |  |
| `delivery_format` | text |  |  |
| `audio_format` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `visual_identity`

Overarching aesthetic vision — the film's visual DNA. Single home for the project's material world, texture approach, and design constraints (absorbed material_palette, texture_philosophy, and design_constraints in the 2.0 consolidation).

| | |
|---|---|
| Label | Visual Identity / Visual Identity |
| Category | Creative Direction |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Visual Identity` |
| `visual_statement` | textarea |  |  |
| `aesthetic_genre` | select |  | one of `naturalistic`, `stylized`, `hyperreal`, `expressionistic`, `fantastical`, `hybrid` |
| `design_era` | text |  |  |
| `visual_density` | select |  | one of `minimalist`, `moderate`, `dense`, `maximalist` |
| `primary_materials` | json |  |  |
| `secondary_materials` | json |  |  |
| `accent_materials` | json |  |  |
| `forbidden_materials` | json |  |  |
| `material_storytelling` | textarea |  |  |
| `textural_philosophy` | select |  | one of `clean/pristine`, `lived-in`, `weathered`, `decayed` |
| `texture_contrast_strategy` | textarea |  |  |
| `surface_finish_preference` | textarea |  |  |
| `patina_aging_approach` | textarea |  |  |
| `technology_level` | text |  |  |
| `technology_aesthetic` | text |  |  |
| `architectural_styles` | text |  |  |
| `scale_rules` | select |  | one of `human scale`, `intimate`, `monumental`, `mixed` |
| `geometric_language` | select |  | one of `organic`, `angular`, `mixed` |
| `lighting_constraints` | textarea |  |  |
| `visual_influences` | json |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 2

*Depth — character, prop and location*

### `actor`

Minimal actor entity. SCF is story-first, not a casting tracker — this entity captures only what the story format needs.

| | |
|---|---|
| Label | Actor / Actors |
| Category | Performance Corpus |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (1) | `actor_character_role.actor_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `bundle`

Named, intent-typed collection of assets. Tool-agnostic media reference primitive used by the character cluster (and now by props and locations). Versionable — participates in linear version chains.

| | |
|---|---|
| Label | Bundle / Bundles |
| Category | Asset Reference |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | yes |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (9) | `bundle.parent_id`, `bundle.superseded_by_id`, `bundle_asset.bundle_id`, `character_asset_binding.bundle_id`, `prop_asset_binding.bundle_id`, `location_asset_binding.bundle_id`, `character_shot_override.bundle_override_id`, `prop_shot_override.bundle_override_id`, `location_shot_override.bundle_override_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `intent` | select | **yes** | one of `visual_identity`, `voice_identity`, `motion`, `behavior`, `performance`, `surface`, `environment`, `acoustic`, `other`. Hard enum. Tools switch on this to determine compatibility. acoustic added in Phase 1D for location ambience. |
| `description` | textarea |  |  |
| `coverage_summary` | textarea |  |  |
| `format_hints` | json |  |  |
| `intended_consumers` | json |  |  |
| `provenance` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `parent_id` | reference |  | → `bundle` (resolves to `parent_uuid` in a result, §12.1.2). auto-injected by the generator. Previous version in the chain. Null for root version. |
| `version_label` | text |  | auto-injected by the generator. Human-readable version identifier. Tool-managed. |
| `superseded_at` | timestamp |  | auto-injected by the generator. Set when a successor version becomes active. |
| `superseded_by_id` | reference |  | → `bundle` (resolves to `superseded_by_uuid` in a result, §12.1.2). auto-injected by the generator. Forward pointer to successor. Auto-set on supersession. |

### `character_appearance_profile`

Complete visual design — silhouette, distinction, evolution.

| | |
|---|---|
| Label | Character Appearance Profile / Character Appearance Profiles |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `body_type` | text |  |  |
| `height_proportions` | text |  |  |
| `age_appearance` | text |  |  |
| `hair` | text |  |  |
| `eyes` | text |  |  |
| `distinguishing_features` | textarea |  |  |
| `skin_tone` | text |  |  |
| `grooming_level` | text |  |  |
| `visual_distinction` | textarea |  |  |
| `silhouette_description` | textarea |  |  |
| `visual_shorthand` | textarea |  |  |
| `appearance_evolution` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `character_asset_binding`

Applies a bundle to a character under specific conditions.

| | |
|---|---|
| Label | Character Asset Binding / Character Asset Bindings |
| Category | Asset Reference |
| Subject | character |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `bundle_id` | reference | **yes** | → `bundle` (resolves to `bundle_uuid` in a result, §12.1.2) |
| `is_baseline` | boolean |  | default `false` |
| `precedence` | integer |  | default `0` |
| `variant_id` | reference |  | → `character_variant` (resolves to `variant_uuid` in a result, §12.1.2) |
| `physical_state_filter` | text |  |  |
| `vocal_state_filter` | text |  |  |
| `scene_range_start_id` | reference |  | → `scene` (resolves to `scene_range_start_uuid` in a result, §12.1.2) |
| `scene_range_end_id` | reference |  | → `scene` (resolves to `scene_range_end_uuid` in a result, §12.1.2) |
| `act_id` | reference |  | → `act` (resolves to `act_uuid` in a result, §12.1.2) |
| `conditions_json` | json |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `character_relationship`

Relationship between two characters with dynamics, evolution, and its physical dimension (absorbed physical_relationship and physical_relationship_evolution in the 2.0 consolidation).

| | |
|---|---|
| Label | Character Relationship / Character Relationships |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `relationship_state.character_relationship_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_a_id` | reference | **yes** | → `character` (resolves to `character_a_uuid` in a result, §12.1.2) |
| `character_b_id` | reference | **yes** | → `character` (resolves to `character_b_uuid` in a result, §12.1.2) |
| `relationship_type` | select |  | one of `family`, `friend`, `enemy`, `lover`, `colleague`, `mentor/mentee`, `rival`, `authority`, `other` |
| `directionality` | select |  | one of `mutual`, `a_to_b`. default `mutual`. Whether the order of the two characters carries meaning. 'mutual' — siblings, colleagues — reads the same either way, so the same pair entered twice is a duplicate. 'a_to_b' is directed and reads A -> B (A is B's mentor), so the reverse pair is a different fact, not a duplicate. Tooling cannot tell these apart without being told. |
| `specific_relationship` | text |  |  |
| `emotional_valence` | select |  | one of `positive`, `negative`, `complex`, `neutral` |
| `power_dynamic` | textarea |  |  |
| `relationship_arc` | textarea |  |  |
| `touch_comfort` | select |  | one of `touching`, `tactile`, `reserved`, `avoidant` |
| `distance_preference` | text |  |  |
| `eye_contact_pattern` | text |  |  |
| `body_orientation` | text |  |  |
| `mirroring_tendencies` | textarea |  |  |
| `physical_evolution` | textarea |  | Narrative summary of how the physical dimension changes across the story. The queryable stages live in relationship_state rows (pattern 3). |
| `history` | textarea |  |  |
| `current_status` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `character_shot_override`

Per-character deviation from the cascade for a specific shot. Versionable: only one active record per (shot, character). Multiple intents compose into a single record via override_types multiselect and the delta fields.

| | |
|---|---|
| Label | Character Shot Override / Character Shot Overrides |
| Category | Workflow State |
| Subject | character |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | yes |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `character_shot_override.parent_id`, `character_shot_override.superseded_by_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `shot_id` | reference | **yes** | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `override_types` | multiselect |  | one of `aging`, `de_aging`, `prosthetic`, `body_change`, `voice_change`, `motion_change`, `identity_swap`, `transformation`, `other` |
| `bundle_override_id` | reference |  | → `bundle` (resolves to `bundle_override_uuid` in a result, §12.1.2) |
| `variant_target_id` | reference |  | → `character_variant` (resolves to `variant_target_uuid` in a result, §12.1.2) |
| `visual_delta` | textarea |  |  |
| `vocal_delta` | textarea |  |  |
| `motion_delta` | textarea |  |  |
| `progression_axis` | text |  |  |
| `progression_value` | float |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `parent_id` | reference |  | → `character_shot_override` (resolves to `parent_uuid` in a result, §12.1.2). auto-injected by the generator. Previous version in the chain. Null for root version. |
| `version_label` | text |  | auto-injected by the generator. Human-readable version identifier. Tool-managed. |
| `superseded_at` | timestamp |  | auto-injected by the generator. Set when a successor version becomes active. |
| `superseded_by_id` | reference |  | → `character_shot_override` (resolves to `superseded_by_uuid` in a result, §12.1.2). auto-injected by the generator. Forward pointer to successor. Auto-set on supersession. |

### `character_variant`

Specific state or version of a character (e.g. Young Eleanor, Angry Marcus).

| | |
|---|---|
| Label | Character Variant / Character Variants |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `character_asset_binding.variant_id`, `character_shot_override.variant_target_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `physical_differences` | textarea |  |  |
| `emotional_state` | textarea |  |  |
| `context` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `clip`

A meaningful within-scene segment of a take. Plates are clips with clip_type=atmospheric.

| | |
|---|---|
| Label | Clip / Clips |
| Category | Performance Corpus |
| Subject | meta |
| Scope | moment |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (3) | `clip_character.clip_id`, `clip_prop.clip_id`, `shot_coverage.source_clip_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `take_id` | reference | **yes** | → `take` (resolves to `take_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `clip_in_timecode` | text |  |  |
| `clip_out_timecode` | text |  |  |
| `duration_seconds` | integer |  |  |
| `clip_type` | select |  | one of `dialogue`, `action`, `reaction`, `transition`, `insert`, `atmospheric` |
| `screenplay_line_start_id` | integer |  |  |
| `screenplay_line_end_id` | integer |  |  |
| `beat_id` | reference |  | → `story_beat` (resolves to `beat_uuid` in a result, §12.1.2) |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `costume`

A specific wardrobe look for a character.

| | |
|---|---|
| Label | Costume / Costumes |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `costume_scene.costume_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `description` | textarea |  |  |
| `silhouette` | text |  |  |
| `key_garments` | json |  |  |
| `layers` | textarea |  |  |
| `accessories` | json |  |  |
| `primary_color_hex` | text |  |  |
| `primary_color_name` | text |  |  |
| `secondary_colors` | json |  |  |
| `fabrics` | textarea |  |  |
| `texture_qualities` | textarea |  |  |
| `condition` | select |  | one of `new`, `worn`, `distressed` |
| `what_reveals` | textarea |  |  |
| `emotional_state_reflected` | textarea |  |  |
| `social_signals` | textarea |  |  |
| `continuity_notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `costume_progression`

How wardrobe evolves through the story arc.

| | |
|---|---|
| Label | Costume Progression / Costume Progressions |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `starting_wardrobe` | textarea |  |  |
| `starting_meaning` | textarea |  |  |
| `progression_stages` | json |  |  |
| `color_evolution` | textarea |  |  |
| `formality_evolution` | textarea |  |  |
| `condition_evolution` | textarea |  |  |
| `symbolic_meaning` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `entity_anchor`

Known-good single frame, audio segment, or motion sample marked as canonical reference for a character, prop, or location. Used for both ID-locking inputs and output verification. Points into source assets without modifying them. Uses constrained polymorphism — subject_type is a hard closed enum (character / prop / location).

| | |
|---|---|
| Label | Entity Anchor / Entity Anchors |
| Category | Asset Reference |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `subject_type` | select | **yes** | one of `character`, `prop`, `location`. Hard closed enum. Tools switch on this exhaustively. Distinct from the open-polymorphism entity_type used elsewhere. |
| `subject_id` | integer | **yes** | Polymorphic reference into the table named by subject_type. |
| `subject_variant_id` | integer |  | Optional. Polymorphic reference into the matching variant table (character_variant / prop_variant / location_variant). |
| `anchor_type` | select | **yes** | one of `visual`, `audio`, `motion` |
| `asset_id` | reference | **yes** | → `asset` (resolves to `asset_uuid` in a result, §12.1.2) |
| `frame_number` | integer |  |  |
| `timecode` | text |  |  |
| `region_box` | json |  |  |
| `region_label` | text |  |  |
| `audio_offset_start_sec` | float |  |  |
| `audio_offset_end_sec` | float |  |  |
| `condition_description` | textarea |  |  |
| `physical_state` | text |  | Applies for character and prop subjects. |
| `vocal_state` | text |  | Applies for character subjects. |
| `environmental_state` | text |  | Applies for location subjects. |
| `canonical_status` | select |  | one of `verified`, `candidate`, `rejected`. default `candidate`. Verification axis distinct from lifecycle_status. |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location_asset_binding`

Applies a bundle to a location under specific conditions (variant, scene range, act, time-of-day). Tools walk the location resolution cascade and use bindings to find the right media for a location.

| | |
|---|---|
| Label | Location Asset Binding / Location Asset Bindings |
| Category | Asset Reference |
| Subject | location |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `bundle_id` | reference | **yes** | → `bundle` (resolves to `bundle_uuid` in a result, §12.1.2) |
| `is_baseline` | boolean |  | default `false` |
| `precedence` | integer |  | default `0` |
| `variant_id` | reference |  | → `location_variant` (resolves to `variant_uuid` in a result, §12.1.2) |
| `scene_range_start_id` | reference |  | → `scene` (resolves to `scene_range_start_uuid` in a result, §12.1.2) |
| `scene_range_end_id` | reference |  | → `scene` (resolves to `scene_range_end_uuid` in a result, §12.1.2) |
| `act_id` | reference |  | → `act` (resolves to `act_uuid` in a result, §12.1.2) |
| `time_of_day_filter` | text |  | Matches scene.time_of_day for bindings scoped to specific times. |
| `conditions_json` | json |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location_color_scheme`

Color palette and atmosphere for a specific location.

| | |
|---|---|
| Label | Location Color Scheme / Location Color Schemes |
| Category | Location Depth |
| Subject | location |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `location` via `location_id` — deleting the parent deletes this row (§2.3) |
| Refines | `project_color_palette` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `dominant_colors` | json |  |  |
| `color_motivation` | select |  | one of `period`, `character`, `symbolic`, `practical` |
| `color_atmosphere` | select |  | one of `warm`, `cool`, `neutral`, `colorful` |
| `color_intensity` | select |  | one of `saturated`, `desaturated`, `mixed` |
| `character_location_interaction` | select |  | one of `match`, `contrast`, `transform` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location_design`

Detailed visual design — architecture, materials, spatial layout.

| | |
|---|---|
| Label | Location Design / Location Designs |
| Category | Location Depth |
| Subject | location |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `location` via `location_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `design_concept` | textarea |  |  |
| `visual_metaphor` | textarea |  |  |
| `emotional_target` | textarea |  |  |
| `period_style` | text |  |  |
| `condition` | select |  | one of `pristine`, `maintained`, `neglected`, `ruined` |
| `scale` | select |  | one of `intimate`, `domestic`, `commercial`, `monumental` |
| `geometry` | select |  | one of `organic`, `angular`, `chaotic`, `ordered` |
| `dominant_materials` | textarea |  |  |
| `secondary_materials` | textarea |  |  |
| `texture_quality` | textarea |  |  |
| `surface_finish` | textarea |  |  |
| `spatial_description` | textarea |  |  |
| `sight_lines` | textarea |  |  |
| `key_focal_points` | textarea |  |  |
| `natural_light_sources` | textarea |  |  |
| `practical_light_sources` | textarea |  |  |
| `light_quality` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location_shot_override`

Per-location deviation from the cascade for a specific shot. Versionable: only one active record per (shot, location). Most location deviations belong at scene level (location_variant); this entity is for genuinely shot-specific cases (VFX additions, shot reveals beyond standard coverage).

| | |
|---|---|
| Label | Location Shot Override / Location Shot Overrides |
| Category | Workflow State |
| Subject | location |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | yes |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `location_shot_override.parent_id`, `location_shot_override.superseded_by_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `shot_id` | reference | **yes** | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `override_types` | multiselect |  | one of `extension_change`, `lighting_change`, `weather_change`, `vfx_addition`, `other` |
| `bundle_override_id` | reference |  | → `bundle` (resolves to `bundle_override_uuid` in a result, §12.1.2) |
| `variant_target_id` | reference |  | → `location_variant` (resolves to `variant_target_uuid` in a result, §12.1.2) |
| `visual_delta` | textarea |  |  |
| `acoustic_delta` | textarea |  | Ambience / acoustic deviation for this shot. |
| `lighting_delta` | textarea |  | Lighting deviation specific to this shot. |
| `progression_axis` | text |  |  |
| `progression_value` | float |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `parent_id` | reference |  | → `location_shot_override` (resolves to `parent_uuid` in a result, §12.1.2). auto-injected by the generator. Previous version in the chain. Null for root version. |
| `version_label` | text |  | auto-injected by the generator. Human-readable version identifier. Tool-managed. |
| `superseded_at` | timestamp |  | auto-injected by the generator. Set when a successor version becomes active. |
| `superseded_by_id` | reference |  | → `location_shot_override` (resolves to `superseded_by_uuid` in a result, §12.1.2). auto-injected by the generator. Forward pointer to successor. Auto-set on supersession. |

### `location_sound_profile`

Acoustic identity of a place — room tone, ambience, character.

| | |
|---|---|
| Label | Location Sound Profile / Location Sound Profiles |
| Category | Location Depth |
| Subject | location |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `location` via `location_id` — deleting the parent deletes this row (§2.3) |
| Refines | `sonic_identity` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `room_tone` | textarea |  |  |
| `reverb_quality` | textarea |  |  |
| `resonance` | textarea |  |  |
| `constant_sounds` | json |  |  |
| `variable_sounds` | textarea |  |  |
| `characteristic_sounds` | textarea |  |  |
| `sonic_perspective` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `location_variant`

Modified state of a location (e.g. Night version, After fire). Includes structured state axes (time-of-day, weather, season, post-event state) that previously lived on the location base entity. Exactly one variant per location should be marked is_baseline = true.

| | |
|---|---|
| Label | Location Variant / Location Variants |
| Category | Location Depth |
| Subject | location |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `location` via `location_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `location_asset_binding.variant_id`, `location_shot_override.variant_target_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `is_baseline` | boolean |  | default `false`. True for the unconditional default variant for this location. |
| `time_of_day` | select |  | one of `dawn`, `morning`, `midday`, `afternoon`, `dusk`, `night`, `varies` |
| `weather` | text |  |  |
| `season` | select |  | one of `spring`, `summer`, `autumn`, `winter`, `unspecified` |
| `post_event_state` | text |  |  |
| `physical_differences` | textarea |  |  |
| `lighting_differences` | textarea |  |  |
| `emotional_shift` | textarea |  |  |
| `time_context` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `makeup_hair_design`

Non-costume appearance: makeup, hair, prosthetics.

| | |
|---|---|
| Label | Makeup & Hair Design / Makeup & Hair Designs |
| Category | Character Depth |
| Subject | character |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `makeup_approach` | select |  | one of `naturalistic`, `beauty`, `character`, `special effects` |
| `makeup_details` | textarea |  |  |
| `hair_style` | text |  |  |
| `hair_condition` | text |  |  |
| `hair_notes` | textarea |  |  |
| `prosthetics` | textarea |  |  |
| `aging_effects` | textarea |  |  |
| `injury_effects` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `performance_corpus`

Project-level index of captured footage.

| | |
|---|---|
| Label | Performance Corpus / Performance Corpora |
| Category | Performance Corpus |
| Subject | meta |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `take.corpus_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Performance Corpus` |
| `shoot_dates_start` | text |  |  |
| `shoot_dates_end` | text |  |  |
| `shoot_locations` | textarea |  |  |
| `coverage_completeness` | select |  | one of `planned`, `in_production`, `principal_complete`, `pickups_complete`, `complete`. default `planned` |
| `camera_metadata` | textarea |  |  |
| `audio_metadata` | textarea |  |  |
| `corpus_notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `physical_character_profile`

Baseline physical existence — posture, movement, tension, energy, and the face as performance instrument (absorbed facial_expression_profile and emotional_physicality in the 2.0 consolidation). Maps to the motion bundle modality. Static appearance (height, build, features) lives in character_appearance_profile.

| | |
|---|---|
| Label | Physical Character Profile / Physical Character Profiles |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `posture` | select |  | one of `upright`, `slouched`, `rigid`, `relaxed`, `asymmetric` |
| `center_of_gravity` | select |  | one of `high`, `low`, `forward`, `back` |
| `tension_level` | select |  | one of `tense`, `relaxed`, `variable` |
| `energy_quality` | select |  | one of `kinetic`, `still`, `restless`, `contained` |
| `movement_style` | textarea |  |  |
| `movement_speed` | select |  | one of `quick`, `slow`, `deliberate`, `erratic` |
| `movement_fluidity` | select |  | one of `smooth`, `jerky`, `graceful`, `awkward` |
| `movement_economy` | select |  | one of `efficient`, `wasteful`, `precise`, `sloppy` |
| `movement_weight` | select |  | one of `light`, `heavy`, `grounded`, `floating` |
| `resting_face` | textarea |  |  |
| `expressiveness_level` | select |  | one of `mobile`, `controlled`, `flat` |
| `facial_asymmetries` | text |  |  |
| `eye_contact_patterns` | textarea |  |  |
| `gaze_direction_tendencies` | textarea |  |  |
| `mouth_tension_patterns` | textarea |  |  |
| `smile_authenticity` | textarea |  |  |
| `spatial_presence` | select |  | one of `takes up space`, `minimizes self` |
| `physical_comfort` | select |  | one of `at home in body`, `disconnected` |
| `coordination_level` | text |  |  |
| `emotional_manifestations` | json |  | Map of emotion → how it shows in body / face / voice / breathing, e.g. {"fear": {"body": "...", "face": "..."}}. Replaces the former emotional_physicality entity. |
| `physical_training_visible` | textarea |  |  |
| `physical_neglect_visible` | textarea |  |  |
| `injuries_visible_in_movement` | textarea |  |  |
| `physical_notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `physical_habit`

Recurring physical behavior — gesture, tic, comfort behavior.

| | |
|---|---|
| Label | Physical Habit / Physical Habits |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `description` | textarea |  |  |
| `body_parts_involved` | text |  |  |
| `habit_trigger` | textarea |  |  |
| `frequency` | select |  | one of `constant`, `frequent`, `occasional`, `rare/situational` |
| `meaning` | textarea |  |  |
| `character_awareness` | select |  | one of `aware`, `unaware`, `sometimes aware` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `prop_asset_binding`

Applies a bundle to a prop under specific conditions (variant, scene range, act). Tools walk the prop resolution cascade and use bindings to find the right media for a prop in a given scene/state.

| | |
|---|---|
| Label | Prop Asset Binding / Prop Asset Bindings |
| Category | Asset Reference |
| Subject | prop |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `bundle_id` | reference | **yes** | → `bundle` (resolves to `bundle_uuid` in a result, §12.1.2) |
| `is_baseline` | boolean |  | default `false` |
| `precedence` | integer |  | default `0` |
| `variant_id` | reference |  | → `prop_variant` (resolves to `variant_uuid` in a result, §12.1.2) |
| `scene_range_start_id` | reference |  | → `scene` (resolves to `scene_range_start_uuid` in a result, §12.1.2) |
| `scene_range_end_id` | reference |  | → `scene` (resolves to `scene_range_end_uuid` in a result, §12.1.2) |
| `act_id` | reference |  | → `act` (resolves to `act_uuid` in a result, §12.1.2) |
| `conditions_json` | json |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `prop_shot_override`

Per-prop deviation from the cascade for a specific shot. Versionable: only one active record per (shot, prop). Earns its keep for mid-shot state transitions (gun firing, locket falling open) and shot-specific VFX enhancement.

| | |
|---|---|
| Label | Prop Shot Override / Prop Shot Overrides |
| Category | Workflow State |
| Subject | prop |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | yes |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `prop_shot_override.parent_id`, `prop_shot_override.superseded_by_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `shot_id` | reference | **yes** | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `override_types` | multiselect |  | one of `state_change`, `damage`, `transformation`, `vfx_enhancement`, `other` |
| `bundle_override_id` | reference |  | → `bundle` (resolves to `bundle_override_uuid` in a result, §12.1.2) |
| `variant_target_id` | reference |  | → `prop_variant` (resolves to `variant_target_uuid` in a result, §12.1.2) |
| `visual_delta` | textarea |  |  |
| `surface_delta` | textarea |  | Material / finish deviation for this shot. |
| `motion_delta` | textarea |  | How the prop moves / breaks / behaves in this shot. |
| `progression_axis` | text |  |  |
| `progression_value` | float |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `parent_id` | reference |  | → `prop_shot_override` (resolves to `parent_uuid` in a result, §12.1.2). auto-injected by the generator. Previous version in the chain. Null for root version. |
| `version_label` | text |  | auto-injected by the generator. Human-readable version identifier. Tool-managed. |
| `superseded_at` | timestamp |  | auto-injected by the generator. Set when a successor version becomes active. |
| `superseded_by_id` | reference |  | → `prop_shot_override` (resolves to `superseded_by_uuid` in a result, §12.1.2). auto-injected by the generator. Forward pointer to successor. Auto-set on supersession. |

### `prop_state`

Custody, condition, and whereabouts of a prop as of a story position. Latest-wins position keying (pattern 3, spec §4.5). G1, schema 2.2.

| | |
|---|---|
| Label | Prop State / Prop States |
| Category | Prop Depth |
| Subject | prop |
| Scope | scene |
| Position | Latest-wins (pattern 3) — the most recent row at or before a position is in force. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `custody_character_id` | reference |  | → `character` (resolves to `custody_character_uuid` in a result, §12.1.2) |
| `condition` | text |  |  |
| `whereabouts` | text |  | Where the prop is, e.g. "saddlebag", "coat pocket", "revealed on the table". |
| `significance_note` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `prop_surface_profile`

Surface, material, and physical-presence detail for a prop. Holds the descriptive baseline that surface and visual bundles reference. State variation (clean vs damaged) belongs in prop_variant.

| | |
|---|---|
| Label | Prop Surface Profile / Prop Surface Profiles |
| Category | Prop Depth |
| Subject | prop |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `prop` via `prop_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `material` | text |  |  |
| `secondary_materials` | text |  |  |
| `size` | text |  |  |
| `weight_impression` | text |  |  |
| `primary_color_hex` | text |  |  |
| `primary_color_name` | text |  |  |
| `secondary_colors` | json |  |  |
| `surface_finish` | select |  | one of `matte`, `satin`, `gloss`, `worn`, `polished`, `pitted` |
| `texture_quality` | textarea |  |  |
| `baseline_condition` | text |  | The prop's default state. State changes belong in prop_variant. |
| `wear_pattern` | textarea |  |  |
| `aging_notes` | textarea |  |  |
| `visual_distinction` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `prop_variant`

Specific state or version of a prop (e.g. Locket open, Gun blood-spattered, Letter torn). Tools bind state-specific bundles to a prop variant; the cascade resolves the right bundle for the right state.

| | |
|---|---|
| Label | Prop Variant / Prop Variants |
| Category | Prop Depth |
| Subject | prop |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `prop` via `prop_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `prop_asset_binding.variant_id`, `prop_shot_override.variant_target_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `prop_id` | reference | **yes** | → `prop` (resolves to `prop_uuid` in a result, §12.1.2) |
| `physical_differences` | textarea |  |  |
| `state_trigger` | textarea |  |  |
| `context` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `relationship_state`

The stage a relationship is in as of a story position. Latest-wins position keying (pattern 3, spec §4.5): the state in force at position P is the latest row keyed at-or-before P. The prose relationship_arc / physical_evolution fields remain as narrative summaries; this table is the queryable truth (G1, schema 2.2).

| | |
|---|---|
| Label | Relationship State / Relationship States |
| Category | Character Depth |
| Subject | character |
| Scope | scene |
| Position | Latest-wins (pattern 3) — the most recent row at or before a position is in force. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_relationship_id` | reference | **yes** | → `character_relationship` (resolves to `character_relationship_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2). The position this stage begins. In force until a later row supersedes it. |
| `stage_label` | text |  | Short handle, e.g. "arm's length", "post-accident thaw". |
| `description` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `shot_coverage`

Production state of each shot. Multiple records per shot, ordered by status_date, give a production timeline. Most recent is canonical.

| | |
|---|---|
| Label | Shot Coverage / Shot Coverages |
| Category | Workflow State |
| Subject | shot |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `shot_id` | reference | **yes** | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `coverage_state` | select | **yes** | one of `planned`, `captured_live`, `generated`, `hybrid_live_plate`, `hybrid_generated_extension`, `reshoot_needed`, `pickup_scheduled`, `final` |
| `source_take_id` | reference |  | → `take` (resolves to `source_take_uuid` in a result, §12.1.2) |
| `source_clip_id` | reference |  | → `clip` (resolves to `source_clip_uuid` in a result, §12.1.2) |
| `generation_required` | textarea |  |  |
| `override_summary` | textarea |  |  |
| `status_date` | text |  | For ordering history. Most recent record is canonical. |
| `decided_by` | text |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `take`

A single recorded take. May cross scenes (via take_scene junction).

| | |
|---|---|
| Label | Take / Takes |
| Category | Performance Corpus |
| Subject | meta |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (3) | `take_scene.take_id`, `clip.take_id`, `shot_coverage.source_take_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `corpus_id` | reference | **yes** | → `performance_corpus` (resolves to `corpus_uuid` in a result, §12.1.2) |
| `shot_id` | reference |  | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `take_number` | integer |  |  |
| `date_recorded` | text |  |  |
| `duration_seconds` | integer |  |  |
| `timecode_start` | text |  |  |
| `timecode_end` | text |  |  |
| `preferred` | boolean |  | default `false` |
| `camera_designation` | text |  |  |
| `lens_info` | text |  |  |
| `recording_format` | text |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `vocal_profile`

Baseline vocal identity — how a character sounds and how they deliver lines (absorbed delivery_profile in the 2.0 consolidation). Maps to the voice_identity bundle modality.

| | |
|---|---|
| Label | Vocal Profile / Vocal Profiles |
| Category | Character Depth |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `voice_quality` | text |  |  |
| `pitch_range` | select |  | one of `high`, `low`, `middle`, `variable` |
| `timbre` | select |  | one of `warm`, `nasal`, `resonant`, `thin`, `gravelly` |
| `volume_tendency` | select |  | one of `loud`, `soft`, `variable` |
| `breathiness_level` | select |  | one of `none`, `slight`, `moderate`, `heavy` |
| `speech_pattern` | textarea |  |  |
| `pace` | select |  | one of `fast`, `slow`, `measured`, `variable` |
| `rhythm` | select |  | one of `regular`, `syncopated`, `halting` |
| `articulation` | select |  | one of `precise`, `mumbled`, `clipped`, `drawled` |
| `fluency` | select |  | one of `smooth`, `stuttered`, `filled pauses` |
| `accent` | text |  |  |
| `regional_markers` | text |  |  |
| `class_markers` | text |  |  |
| `educational_markers` | text |  |  |
| `accent_authenticity` | select |  | one of `native`, `acquired`, `affected` |
| `delivery_style` | select |  | one of `naturalistic`, `theatrical`, `minimalist`, `mannered` |
| `emotional_access` | select |  | one of `available`, `controlled`, `variable` |
| `subtext_playing` | select |  | one of `plays clearly`, `hides`, `unaware` |
| `listening_behavior` | textarea |  |  |
| `interruption_tendencies` | textarea |  |  |
| `vocal_habits` | textarea |  |  |
| `filler_words` | json |  |  |
| `catch_phrases` | json |  |  |
| `verbal_tics` | json |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 3

*Scene detail*

### `dialogue_sound_design`

How dialogue sounds in the world — recording aesthetic, processing.

| | |
|---|---|
| Label | Dialogue Sound Design / Dialogue Sound Designs |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Refines | `sonic_identity` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `recording_aesthetic` | select |  | one of `clean/studio`, `production audio`, `stylized` |
| `acoustic_environment` | textarea |  |  |
| `dialogue_clarity` | select |  | one of `always clear`, `sometimes obscured`, `deliberately muddy` |
| `dialogue_layering` | textarea |  |  |
| `processing_notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `lighting_design`

Illumination approach for a scene.

| | |
|---|---|
| Label | Lighting Design / Lighting Designs |
| Category | Scene Detail |
| Subject | scene |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `scene` via `scene_id` — deleting the parent deletes this row (§2.3) |
| Refines | `look_development` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `shot_id` | reference |  | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `lighting_style` | select |  | one of `naturalistic`, `stylized`, `high key`, `low key`, `chiaroscuro` |
| `contrast_ratio` | text |  |  |
| `overall_mood` | text |  |  |
| `light_quality` | select |  | one of `hard`, `soft`, `mixed` |
| `key_source` | text |  |  |
| `key_direction` | text |  |  |
| `key_quality` | select |  | one of `hard`, `soft` |
| `key_color_temperature` | integer |  |  |
| `fill_ratio` | text |  |  |
| `fill_quality` | text |  |  |
| `fill_color_temperature` | integer |  |  |
| `backlight_notes` | textarea |  |  |
| `practical_lights` | textarea |  |  |
| `ambient_light` | textarea |  |  |
| `lighting_evolution` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `scene_color_palette`

Specific color design for a scene.

| | |
|---|---|
| Label | Scene Color Palette / Scene Color Palettes |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `scene` via `scene_id` — deleting the parent deletes this row (§2.3) |
| Refines | `color_script_entry` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `dominant_colors` | json |  |  |
| `color_harmony_type` | select |  | one of `monochromatic`, `analogous`, `complementary`, `triadic`, `split-complementary` |
| `color_source_distribution` | textarea |  |  |
| `color_contrast_level` | select |  | one of `low`, `medium`, `high` |
| `focal_color` | text |  |  |
| `grading_notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `scene_emotional_target`

Specific emotional goal and function for a scene.

| | |
|---|---|
| Label | Scene Emotional Target / Scene Emotional Targets |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `scene` via `scene_id` — deleting the parent deletes this row (§2.3) |
| Refines | `project_tone` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `primary_emotion` | text | **yes** |  |
| `primary_intensity` | integer |  |  |
| `secondary_emotions` | json |  |  |
| `emotional_function` | select |  | one of `setup`, `build`, `release`, `shift`, `sustain` |
| `audience_character_relationship` | select |  | one of `empathy`, `sympathy`, `antipathy`, `observation` |
| `contrast_with_previous` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `scene_music_design`

Music approach for a specific scene.

| | |
|---|---|
| Label | Scene Music Design / Scene Music Designs |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `scene` via `scene_id` — deleting the parent deletes this row (§2.3) |
| Refines | `sonic_identity` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `music_presence` | select |  | one of `score`, `source`, `none`, `mixed` |
| `emotional_function` | select |  | one of `support`, `anticipate`, `counterpoint`, `neutral` |
| `entry_point` | text |  |  |
| `build_evolution` | textarea |  |  |
| `peak` | text |  |  |
| `exit_point` | text |  |  |
| `themes_used` | json |  |  |
| `source_music_description` | textarea |  |  |
| `lyrics_relevance` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `set_dressing`

Objects and arrangement populating a scene's location.

| | |
|---|---|
| Label | Set Dressing / Set Dressings |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `location_id` | reference |  | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `hero_objects` | json |  |  |
| `atmospheric_objects` | textarea |  |  |
| `practical_objects` | textarea |  |  |
| `background_fill` | textarea |  |  |
| `sightline_management` | textarea |  |  |
| `continuity_requirements` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `tone_marker`

Scene-specific tonal quality and atmosphere.

| | |
|---|---|
| Label | Tone Marker / Tone Markers |
| Category | Scene Detail |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Refines | `project_tone` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `sequence_id` | reference |  | → `sequence` (resolves to `sequence_uuid` in a result, §12.1.2) |
| `tone_descriptor` | text |  |  |
| `intensity` | select |  | one of `light`, `moderate`, `heavy` |
| `genre_elements` | text |  |  |
| `mood_atmosphere` | textarea |  |  |
| `pacing_expectation` | textarea |  |  |
| `tonal_shift` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 4

*Thematic tracking*

### `character_color_identity`

Signature color language for a character. A directorial choice about how the character manifests visually — thematic, not fundamental.

| | |
|---|---|
| Label | Character Color Identity / Character Color Identities |
| Category | Thematic Tracking |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Owned by | `character` via `character_id` — deleting the parent deletes this row (§2.3) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `primary_color_hex` | text |  |  |
| `primary_color_name` | text |  |  |
| `secondary_colors` | json |  |  |
| `how_manifests` | select |  | one of `wardrobe`, `accessories`, `environment`, `lighting`, `multiple` |
| `why_these_colors` | textarea |  |  |
| `consistency_level` | select |  | one of `always`, `usually`, `accent only`, `metaphor only` |
| `starting_colors` | text |  |  |
| `midpoint_shift` | text |  |  |
| `final_colors` | text |  |  |
| `color_isolation` | select |  | one of `unique to character`, `shared`, `contrasting with another` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `color_script`

Visual map of color progression through the story.

| | |
|---|---|
| Label | Color Script / Color Scripts |
| Category | Thematic Tracking |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Refines | `project_color_palette` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Color Script` |
| `format` | select |  | one of `strip`, `grid`, `timeline` |
| `granularity` | select |  | one of `per scene`, `per sequence`, `per act` |
| `progression_description` | textarea |  |  |
| `key_color_moments` | textarea |  |  |
| `arc_shape` | select |  | one of `linear`, `cyclical`, `transformative`, `oscillating` |
| `emotional_mapping` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `color_script_entry`

Position-keyed color intent — the row form of the color script (Phase B found color_script itself is prose). Latest-wins position keying (pattern 3, spec §4.5): the intent in force at P is the latest entry at-or-before P. Act-level intent is keyed to the act's first scene by convention. Sits in the visual direction cascade between the project palette and scene palettes. G1, schema 2.2.

| | |
|---|---|
| Label | Color Script Entry / Color Script Entries |
| Category | Thematic Tracking |
| Subject | project |
| Scope | scene |
| Position | Latest-wins (pattern 3) — the most recent row at or before a position is in force. |
| Name field | `name` |
| Refines | `color_script` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `temperature` | select |  | one of `warm`, `cool`, `neutral`, `transitional` |
| `key_colors` | json |  |  |
| `palette_shift` | textarea |  | What changes about the palette from this position, and why. |
| `emotional_intent` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `color_symbolism`

Thematic meanings assigned to specific colors in this story.

| | |
|---|---|
| Label | Color Symbolism / Color Symbolism |
| Category | Thematic Tracking |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `color_hex` | text |  |  |
| `primary_symbolism` | textarea |  |  |
| `secondary_symbolism` | textarea |  |  |
| `emotional_positive` | textarea |  |  |
| `emotional_negative` | textarea |  |  |
| `evolution_through_story` | textarea |  |  |
| `cultural_context` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `motif`

A meaning-carrying element in any modality — visual, sonic, verbal, behavioral, conceptual, or situational. Recurring motifs and standalone charged symbols share this table, distinguished by the recurrence field. Replaces visual_motif, sonic_motif, conceptual_motif, and symbol (2.0 consolidation).

| | |
|---|---|
| Label | Motif / Motifs |
| Category | Thematic Tracking |
| Subject | theme |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (3) | `motif.related_motif_id`, `motif_state.motif_id`, `motif_appearance.motif_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `modality` | select | **yes** | one of `visual`, `sonic`, `verbal`, `behavioral`, `conceptual`, `situational` |
| `recurrence` | select |  | one of `recurring`, `standalone`. Recurring = classic motif. Standalone = a single charged element (what the pre-2.0 schema called a symbol). |
| `description` | textarea |  | What the element literally is — the shape, sound, phrase, or behavior. |
| `literal_function` | textarea |  |  |
| `symbolic_meaning` | textarea |  |  |
| `secondary_meaning` | textarea |  |  |
| `emotional_associations` | textarea |  |  |
| `first_appearance_scene_id` | reference |  | → `scene` (resolves to `first_appearance_scene_uuid` in a result, §12.1.2) |
| `recurrence_pattern` | textarea |  |  |
| `placement_strategy` | textarea |  |  |
| `subtlety_level` | select |  | one of `obvious`, `noticeable`, `subtle`, `hidden` |
| `evolution_description` | textarea |  | Narrative summary. The queryable stages live in motif_state rows (pattern 3). |
| `related_motif_id` | reference |  | → `motif` (resolves to `related_motif_uuid` in a result, §12.1.2). A motif in another modality this one echoes — e.g. a sonic motif tied to a visual one. |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `motif_state`

A motif's evolution stage as of a story position — how its meaning or loudness has shifted. Latest-wins position keying (pattern 3, spec §4.5). The motif's evolution_description remains the narrative summary. G1, schema 2.2.

| | |
|---|---|
| Label | Motif State / Motif States |
| Category | Thematic Tracking |
| Subject | theme |
| Scope | scene |
| Position | Latest-wins (pattern 3) — the most recent row at or before a position is in force. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `motif_id` | reference | **yes** | → `motif` (resolves to `motif_uuid` in a result, §12.1.2) |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `stage_description` | textarea |  |  |
| `subtlety_level` | select |  | one of `obvious`, `noticeable`, `subtle`, `hidden`. Overrides the motif's base subtlety from this position onward. |
| `meaning_shift` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `subtext`

Underlying meaning beneath surface action or dialogue.

| | |
|---|---|
| Label | Subtext / Subtext Layers |
| Category | Thematic Tracking |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `surface_level` | textarea | **yes** |  |
| `subtext_level` | textarea | **yes** |  |
| `gap_size` | select |  | one of `small`, `moderate`, `large` |
| `character_awareness` | select |  | one of `aware`, `unaware`, `mixed` |
| `audience_access` | select |  | one of `first viewing`, `repeat viewing`, `analysis` |
| `purpose` | select |  | one of `dramatic irony`, `character revelation`, `thematic depth`, `foreshadowing`, `emotional complexity` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `thematic_connection`

How a specific element connects to a theme. Open polymorphism — entity_type is open-ended.

| | |
|---|---|
| Label | Thematic Connection / Thematic Connections |
| Category | Thematic Tracking |
| Subject | link |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `theme_id` | reference | **yes** | → `theme` (resolves to `theme_uuid` in a result, §12.1.2) |
| `entity_type` | select |  | one of `character`, `scene`, `location`, `prop`, `costume`, `motif` |
| `entity_id` | integer | **yes** |  |
| `nature_of_connection` | select |  | one of `embodies`, `explores`, `represents`, `challenges`, `resolves` |
| `subtlety_level` | select |  | one of `on-the-nose`, `clear`, `subtle`, `hidden` |
| `intended_perception` | select |  | one of `must recognize`, `enhances if recognized`, `reward for careful viewing` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 5

*Emotional architecture*

### `emotional_arc`

Overall emotional trajectory for the audience across the project.

| | |
|---|---|
| Label | Emotional Arc / Emotional Arcs |
| Category | Thematic Tracking |
| Subject | story |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `emotional_beat.emotional_arc_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  | default `Audience Emotional Arc` |
| `opening_emotional_state` | textarea |  |  |
| `closing_emotional_state` | textarea |  |  |
| `emotional_shape` | select |  | one of `rising action`, `oscillating`, `descent`, `transformation` |
| `lingering_feelings` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `emotional_beat`

Specific point on the audience emotional journey.

| | |
|---|---|
| Label | Emotional Beat / Emotional Beats |
| Category | Thematic Tracking |
| Subject | story |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `emotional_arc_id` | reference |  | → `emotional_arc` (resolves to `emotional_arc_uuid` in a result, §12.1.2) |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `sequence_id` | reference |  | → `sequence` (resolves to `sequence_uuid` in a result, §12.1.2) |
| `beat_order` | integer | **yes** |  |
| `target_emotion` | text | **yes** |  |
| `intensity` | integer |  |  |
| `beat_trigger` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `identification_strategy`

How the audience aligns with characters in a scene.

| | |
|---|---|
| Label | Identification Strategy / Identification Strategies |
| Category | Thematic Tracking |
| Subject | story |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `primary_character_id` | reference |  | → `character` (resolves to `primary_character_uuid` in a result, §12.1.2) |
| `secondary_character_id` | reference |  | → `character` (resolves to `secondary_character_uuid` in a result, §12.1.2) |
| `audience_position` | select |  | one of `with character`, `observing character`, `above character` |
| `identification_technique` | textarea |  |  |
| `emotional_alignment` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `information_strategy`

What the audience knows vs what characters know.

| | |
|---|---|
| Label | Information Strategy / Information Strategies |
| Category | Thematic Tracking |
| Subject | story |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `knowledge_asymmetry` | select |  | one of `dramatic irony`, `mystery`, `parallel knowledge`, `shifting` |
| `information_withheld` | textarea |  |  |
| `reveal_timing` | textarea |  |  |
| `audience_position` | select |  | one of `ahead of characters`, `behind characters`, `with characters` |
| `information_layers` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

## Tier 6

*Production*

### `action_sequence`

Choreographed action sequence — fight, chase, stunt.

| | |
|---|---|
| Label | Action Sequence / Action Sequences |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (2) | `staging_beat.action_sequence_id`, `action_sequence_character.action_sequence_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `sequence_type` | select |  | one of `fight`, `chase`, `stunt`, `combat`, `athletic`, `physical comedy` |
| `description` | textarea |  |  |
| `style` | text |  |  |
| `difficulty_level` | select |  | one of `simple`, `moderate`, `complex`, `extreme` |
| `safety_concerns` | textarea |  |  |
| `stunt_requirements` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `character_environment_physicality`

How a character physically interacts with their environment.

| | |
|---|---|
| Label | Character-Environment Physicality / Character-Environment Physicalities |
| Category | Production |
| Subject | character |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `location_id` | reference | **yes** | → `location` (resolves to `location_uuid` in a result, §12.1.2) |
| `comfort_level` | select |  | one of `at home`, `comfortable`, `alert`, `uncomfortable`, `alien` |
| `interaction_pattern` | textarea |  |  |
| `spatial_use` | textarea |  |  |
| `object_interaction` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `dialogue_rhythm`

Conversational pacing and interaction patterns in a scene.

| | |
|---|---|
| Label | Dialogue Rhythm / Dialogue Rhythms |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `overall_rhythm` | select |  | one of `staccato`, `legato`, `varying` |
| `pause_pattern` | textarea |  |  |
| `overlap_pattern` | textarea |  |  |
| `silence_pattern` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `movement_choreography`

Choreographed movement design for a scene or sequence.

| | |
|---|---|
| Label | Movement Choreography / Movement Choreographies |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `movement_concept` | textarea |  |  |
| `rhythm_pattern` | textarea |  |  |
| `spatial_pattern` | textarea |  |  |
| `ensemble_coordination` | textarea |  |  |
| `style_reference` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `music_cue`

A specific music placement and its function.

| | |
|---|---|
| Label | Music Cue / Music Cues |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `cue_type` | select |  | one of `score`, `source` |
| `entry_timing` | text |  |  |
| `exit_timing` | text |  |  |
| `duration_seconds` | integer |  |  |
| `musical_theme_id` | reference |  | → `musical_theme` (resolves to `musical_theme_uuid` in a result, §12.1.2) |
| `emotional_function` | textarea |  |  |
| `dynamics` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `music_sound_relationship`

How music and sound design interact in a scene.

| | |
|---|---|
| Label | Music-Sound Relationship / Music-Sound Relationships |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `relationship_type` | select |  | one of `music dominant`, `sound dominant`, `integrated`, `alternating` |
| `integration_approach` | textarea |  |  |
| `dynamic_balance` | textarea |  |  |
| `frequency_separation` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `musical_theme`

Recurring musical phrase associated with a character, place, or idea.

| | |
|---|---|
| Label | Musical Theme / Musical Themes |
| Category | Production |
| Subject | project |
| Scope | global |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `music_cue.musical_theme_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `theme_type` | select |  | one of `character theme`, `place theme`, `idea theme`, `relationship theme`, `emotional theme` |
| `associated_entity` | text |  |  |
| `description` | textarea |  |  |
| `instrumentation` | text |  |  |
| `variations` | textarea |  |  |
| `evolution_description` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `performance_beat`

A specific performance moment for a character within a scene, in one modality — a physical action, a delivered line, or a facial beat. Replaces physical_performance_beat, vocal_beat, line_delivery, and microexpression (2.0 consolidation).

| | |
|---|---|
| Label | Performance Beat / Performance Beats |
| Category | Production |
| Subject | character |
| Scope | moment |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `beat_order` | integer |  |  |
| `modality` | select | **yes** | one of `physical`, `vocal`, `facial` |
| `description` | textarea |  |  |
| `trigger` | textarea |  |  |
| `emotional_subtext` | textarea |  |  |
| `line_text` | textarea |  | For vocal beats tied to a specific line. Interim matching contract — superseded by line_ref where a screenplay is present. |
| `line_ref` | text |  | uuid of the anchored screenplay line (G5). Authored from the script editor; re-anchors deterministically through split/merge. |
| `emphasis_words` | json |  |  |
| `pace` | select |  | one of `fast`, `slow`, `measured`, `varying` |
| `volume` | select |  | one of `whisper`, `soft`, `normal`, `loud`, `shout` |
| `delivery_notes` | textarea |  |  |
| `physical_action` | textarea |  |  |
| `body_part_focus` | text |  |  |
| `visibility` | select |  | one of `clearly seen`, `subtle`, `blink and miss`. Chiefly for facial beats — how legible the moment is. |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `performance_state`

Modulation of a character's baseline profile, in one performance modality. Replaces physical_state and vocal_state (2.0 consolidation). The modality enum mirrors bundle intents so per-modality tools can filter states the same way they filter bundles. Temporal reach is governed by the persistence field — see spec §4.5, pattern 2 — the state is in force from its keyed scene onward.

| | |
|---|---|
| Label | Performance State / Performance States |
| Category | Production |
| Subject | character |
| Scope | shot |
| Position | Sparse persistence (pattern 2) — in force from its keyed scene onward, per its persistence field. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `character_id` | reference | **yes** | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `shot_id` | reference |  | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `modality` | select | **yes** | one of `physical`, `vocal` |
| `persistence` | select |  | one of `scene_only`, `until_resolved`. scene_only (default): in force only for the keyed scene. until_resolved: in force from the keyed scene onward, until resolved_at_scene. See spec §4.5, pattern 2. |
| `resolved_at_scene_id` | reference |  | → `scene` (resolves to `resolved_at_scene_uuid` in a result, §12.1.2). For until_resolved states: the scene at which this state stops being in force (exclusive). Empty = still open. |
| `state_description` | textarea |  |  |
| `modulations` | json |  | Keyed modulation of baseline profile attributes. Physical: tension / energy / posture / movement. Vocal: pitch / volume / pace / articulation. When multiple states are in force, modulations merge key-wise, newest state wins per key. |
| `emotional_coloring` | textarea |  |  |
| `trigger` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `scene_blocking`

Physical staging of characters and movement within the scene, including the use of distance as meaning (absorbed proxemic_design in the 2.0 consolidation).

| | |
|---|---|
| Label | Scene Blocking / Scene Blockings |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |
| Referenced by (1) | `staging_beat.scene_blocking_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `staging_concept` | textarea |  |  |
| `character_geography` | textarea |  |  |
| `blocking_evolution` | textarea |  |  |
| `proxemics` | textarea |  | How physical distance between characters carries meaning in this scene — opening distances, evolution, violations. |
| `camera_relationship` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `shot`

A single camera setup within a scene.

| | |
|---|---|
| Label | Shot / Shots |
| Category | Production |
| Subject | shot |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | yes (§6.3) |
| Referenced by (9) | `take.shot_id`, `shot_coverage.shot_id`, `character_shot_override.shot_id`, `prop_shot_override.shot_id`, `location_shot_override.shot_id`, `lighting_design.shot_id`, `shot_design.shot_id`, `performance_state.shot_id`, `sound_cue.shot_id` |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `shot_number` | text |  |  |
| `shot_order` | integer |  |  |
| `story_beat_id` | reference |  | → `story_beat` (resolves to `story_beat_uuid` in a result, §12.1.2). Optional: the beat within the scene this shot covers. Shots without a beat sit directly under the scene. |
| `shot_size` | select |  | one of `extreme wide`, `wide`, `medium wide`, `medium`, `medium close-up`, `close-up`, `extreme close-up` |
| `camera_angle` | select |  | one of `eye level`, `high angle`, `low angle`, `overhead`, `dutch`, `POV` |
| `camera_movement` | select |  | one of `static`, `pan`, `tilt`, `dolly`, `tracking`, `crane`, `handheld`, `steadicam`, `drone`, `zoom` |
| `lens_choice` | text |  |  |
| `duration_seconds` | float |  |  |
| `description` | textarea |  |  |
| `notes` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |
| `external_id` | text |  | auto-injected by the generator. Optional. Identifier in an external system (OMC, EIDR, production DB, etc.). See spec §6.3. |
| `external_id_namespace` | text |  | auto-injected by the generator. Which external system the identifier belongs to. |

### `shot_design`

Detailed visual composition for a shot.

| | |
|---|---|
| Label | Shot Design / Shot Designs |
| Category | Production |
| Subject | shot |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Refines | `scene_color_palette`, `lighting_design` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `shot_id` | reference | **yes** | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `composition_type` | select |  | one of `rule of thirds`, `centered`, `symmetrical`, `asymmetric`, `dynamic` |
| `frame_division` | textarea |  |  |
| `subject_placement` | textarea |  |  |
| `negative_space` | textarea |  |  |
| `depth_of_field` | select |  | one of `shallow`, `medium`, `deep` |
| `focus_strategy` | textarea |  |  |
| `color_emphasis` | textarea |  |  |
| `textural_emphasis` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `shot_language`

How shots communicate meaning — visual vocabulary for a scene.

| | |
|---|---|
| Label | Shot Language / Shot Language |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Refines | `cinematographic_philosophy` — direction cascade, root first (§7) |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `visual_strategy` | textarea |  |  |
| `shot_relationships` | textarea |  |  |
| `cutting_pattern` | textarea |  |  |
| `rhythm` | select |  | one of `fast`, `slow`, `varying`, `deliberate` |
| `transitions` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `sound_cue`

A specific sound element placement.

| | |
|---|---|
| Label | Sound Cue / Sound Cues |
| Category | Production |
| Subject | scene |
| Scope | shot |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text | **yes** |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `shot_id` | reference |  | → `shot` (resolves to `shot_uuid` in a result, §12.1.2) |
| `sound_type` | select |  | one of `ambient`, `effect`, `foley`, `design`, `stinger`, `dialogue`, `voiceover` |
| `description` | textarea |  |  |
| `timing` | text |  |  |
| `duration` | text |  |  |
| `emotional_function` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `sound_perspective`

POV approach to sound — whose ears are we using?

| | |
|---|---|
| Label | Sound Perspective / Sound Perspectives |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference | **yes** | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `perspective_type` | select |  | one of `objective`, `subjective`, `shifting` |
| `pov_character_id` | reference |  | → `character` (resolves to `pov_character_uuid` in a result, §12.1.2) |
| `spatial_logic` | textarea |  |  |
| `psychological_logic` | textarea |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `staging_beat`

Ordered physical staging moment within a scene container — either a scene_blocking or an action_sequence. Exactly one of scene_blocking_id or action_sequence_id must be set. Replaces blocking_beat and action_beat (2.0 consolidation).

| | |
|---|---|
| Label | Staging Beat / Staging Beats |
| Category | Production |
| Subject | scene |
| Scope | moment |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_blocking_id` | reference |  | → `scene_blocking` (resolves to `scene_blocking_uuid` in a result, §12.1.2). Parent for general blocking beats. Mutually exclusive with action_sequence_id. |
| `action_sequence_id` | reference |  | → `action_sequence` (resolves to `action_sequence_uuid` in a result, §12.1.2). Parent for choreographed action beats. Mutually exclusive with scene_blocking_id. |
| `beat_order` | integer | **yes** |  |
| `description` | textarea |  |  |
| `characters_involved` | json |  |  |
| `character_positions` | json |  |  |
| `movement_description` | textarea |  |  |
| `camera_note` | text |  |  |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

### `voiceover_design`

Narration / inner-voice approach for the project or scene.

| | |
|---|---|
| Label | Voiceover Design / Voiceover Designs |
| Category | Production |
| Subject | scene |
| Scope | scene |
| Position | Not positioned — one row, not keyed to a scene. |
| Name field | `name` |
| Versionable | no |
| `lifecycle_status` | yes — a `cut` row appears in no result (§6.6.1) |
| `external_id` | no |

| Field | Type | Req | |
|---|---|---|---|
| `name` | text |  |  |
| `scene_id` | reference |  | → `scene` (resolves to `scene_uuid` in a result, §12.1.2) |
| `character_id` | reference |  | → `character` (resolves to `character_uuid` in a result, §12.1.2) |
| `voiceover_type` | select |  | one of `narrator`, `inner monologue`, `letter/diary`, `retrospective`, `future self` |
| `voiceover_function` | textarea |  |  |
| `temporal_position` | select |  | one of `concurrent`, `retrospective`, `prospective` |
| `knowledge_position` | select |  | one of `omniscient`, `limited`, `unreliable` |
| `relationship_to_image` | select |  | one of `matches`, `counterpoint`, `expands` |
| `lifecycle_status` | select |  | one of `active`, `draft`, `superseded`, `deprecated`, `cut`, `archived`. default `active`. auto-injected by the generator. Cross-cutting record state. See spec §6.6. |

---

Generated by `scf-core/scripts/emit_entity_reference.mjs`.
