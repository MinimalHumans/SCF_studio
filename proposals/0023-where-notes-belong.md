<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0023 — Where a `notes` field belongs

| | |
|---|---|
| **Status** | **implemented** — schema 2.14. See Resolution |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | 22 entities gain one field each; `schema/entity_registry.py`, generated artifacts; supersedes 0006, which asked the same question for `character` alone |

## The problem

**Which entities carry a free note was decided one entity at a time, and
it shows.**

The audit behind 0006:

- **38 note-bearing columns** exist, spelled `notes`, `usage_note`,
  `continuity_notes`, `manifestation_notes`, `camera_note`,
  `delivery_notes`, `aging_notes`, `significance_note` and more.
- **24 of the 38 are empty in the fixture**, including `scene.notes`
  (0 of 14), `story_beat.notes` (0 of 23), `act.notes` (0 of 3) and
  `asset.notes` (0 of 46).
- **51 non-link entities have no note field at all.**
- Among tier 0 story entities, `character` is the only one missing it
  (0006). Among tier 1, **all nine** Creative Direction documents are
  missing it — `project_vision`, `visual_identity`, `sonic_identity`,
  `technical_specs` and the rest. These are the most prose-heavy rows in
  any file, and they are the ones an author most wants to annotate.

One thing the audit corrected: **a note is not hidden from consumers.**
§12.1.2 projects every non-empty field, so a note surfaces in any
dossier or provenance result. The only place notes hide is the form UI.

## The proposal

**A rule, applied once:**

> An entity carries exactly one `notes` field when a person opens and
> authors it **as a unit** — tier 0 principals, tier 1 vision documents,
> tier 2 design and profile documents. Tier 3–6 scene, shot and
> performance detail does not: its typed fields are its notes, and a
> remark about a lighting setup belongs on the scene or the shot that
> owns it.
>
> A **typed** note field (`continuity_notes`, `camera_note`,
> `usage_note`) is a different thing and stays where it is. It answers a
> specific question; `notes` answers none.
>
> A link entity carries a note only where a person annotates the
> **placement** itself.

**Applied, this adds `notes` to 22 entities:**

| Tier | Entities |
|---|---|
| 0 | `character` |
| 1 | `cinematographic_philosophy`, `costume_design_philosophy`, `look_development`, `project_color_palette`, `project_tone`, `project_vision`, `sonic_identity`, `technical_specs`, `visual_identity` |
| 2 | `character_appearance_profile`, `character_relationship`, `character_variant`, `costume_progression`, `physical_habit`, `relationship_state`, `vocal_profile`, `location_color_scheme`, `location_design`, `location_sound_profile`, `location_variant`, `prop_variant` |

**Two tier-0 entities are deliberately excluded:** `scene_sequence`, a
shadow table (§5.4) nobody authors, and `creative_decision`, whose
`rationale` and `alternatives_considered` are already the note.

**Nothing is removed.** The audit's other half — eight note columns on
rows a person rarely touches, such as `bundle_asset.notes` (0 of 44) —
stays. They cost nothing and someone working in that area may want them.

## What it breaks

- Schema version moves. 22 additive optional fields, §11.1's normal case.
- Generated artifacts regenerate: `registry.json`, `scf-schema.sql`,
  `entity-reference.md`.
- No published result changes unless the fixture authors a note, which it
  should do for `character` at least.

## Alternatives

**`character` only** (0006 as filed). Fixes the one case that bit and
leaves the tier-1 documents, which are the worse gap.

**Every entity.** 51 columns, most on rows where the note would never be
read, and the form for a tier-6 entity grows a field that duplicates the
scene's.

**One polymorphic note entity** instead of columns — `collaboration_note`
already nearly is one. It costs a join for every note and an attachment
convention (0007) for every read. A column is the right shape for "a
remark about this row".

## Unresolved

- **`relationship_state` and `location_variant` are state rows**, authored
  but positional. In or out?
- Should the rule be recorded in `docs/conventions.md` so the next
  entity added does not need a proposal?

---

## Resolution

**Implemented in schema 2.14**: `notes` on 22 entities under the rule
proposed — an entity a person authors as a unit gets one, tiers 0 to 2.
Supersedes 0006.

Recorded retrospectively, 2026-10-08 (release checklist §B3): the change
landed in schema 2.14 and `docs/schema-changelog.md` records it, but
this file was never updated, so it read `draft` for six revisions.
