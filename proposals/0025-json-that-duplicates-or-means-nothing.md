<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0025 — JSON fields that duplicate links, and three that mean nothing

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | 7 fields removed across 6 entities; §2 documentation for the 3 structured maps that stay |

## The problem

**Once the string lists are separated out (0024) and the attachment
columns are dealt with (0007), what remains under `json` is either a
stored derivation, a structured value with a documented shape, or
nothing at all.**

**Stored derivations** — the same defect 0021 describes for
`scene.characters_present`:

| Field | Duplicates | Fixture |
|---|---|---|
| `project.themes` | the `theme` table; a file is one project, so every theme is the project's | empty |
| `theme.motifs` | `motif` plus `thematic_connection` with `entity_type = motif` | empty |
| `staging_beat.characters_involved` | names, where `character_positions` beside it is keyed by character | empty |
| `scene_music_design.themes_used` | `music_cue.musical_theme_id` for cues in that scene | empty |

All four store **names**, not references, so they break silently on a
rename — the fixture's own history records surnames changing.

**Nothing at all:** `character_asset_binding.conditions_json`,
`prop_asset_binding.conditions_json` and
`location_asset_binding.conditions_json` are labelled "Additional
Conditions" and have no help text, no specification text, no reader, no
writer and no rows. Checked: the only occurrences anywhere are the three
`FieldDef` lines and their generated echoes. Three columns whose meaning
nobody can state.

**Structured values worth keeping**, none of which the specification
describes:

| Field | Shape |
|---|---|
| `physical_character_profile.emotional_manifestations` | `{emotion: {body, face, voice, breathing}}` — the help text says so |
| `performance_state.modulations` | `{attribute: value}` over the baseline profile |
| `entity_anchor.region_box` | `{x, y, w, h}` in pixels |

## The proposal

1. **Remove the four stored derivations.** A consumer wanting a project's
   themes reads the `theme` table; a scene's musical themes are the
   themes of its `music_cue` rows; a staging beat's characters are the
   keys of `character_positions` — and after 0026, its
   `staging_beat_character` rows.
2. **Remove the three `conditions_json` columns.** If binding conditions
   are needed later, they come back as declared fields or a declared
   table, with a stated shape.
3. **Document the three that stay**, in the registry help text and in §2:
   each names its shape, and a reader MUST preserve an unrecognised shape
   rather than discarding it (§10.1).

## What it breaks

- Seven field removals. §11.1 forbids this after 1.0, §11.0 allows it
  now. Every one of the seven is empty in the fixture, so no published
  result moves.
- Schema version moves.

## Alternatives

**Keep the derivations as denormalised caches.** They are unmaintained
today and would need a rule about who refreshes them and when.

**Keep `conditions_json` and define it.** Worth doing only if someone can
say what a binding condition is beyond the four filter columns already
next to it (`physical_state_filter`, `vocal_state_filter`, the scene
range and `act_id`).

**Do nothing.**

## Unresolved

- **Should `theme.character_connections` and `theme.scene_connections` go
  the same way?** They are prose rather than lists, so they are not the
  same defect — but they cover the same ground as `thematic_connection`
  rows. Raised in 0011 and still open.
- **Is a scene's musical-theme association really derivable from
  `music_cue`?** If a theme can be present in a scene without a cue, the
  removal needs a `scene_musical_theme` link instead.
