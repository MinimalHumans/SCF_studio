<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0020 — Notes on link entities

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `thematic_connection` (one field) if accepted; nothing else |

## The problem

**The per-placement note is named four ways across the thirteen link
entities, and one claim-bearing link has none.**

| Link | Free-text columns |
|---|---|
| `scene_character`, `costume_scene`, `clip_character`, `clip_prop`, `action_sequence_character`, `take_scene`, `bundle_asset`, `asset_relationship`, `actor_character_role` | `notes` |
| `scene_prop` | `usage_note`, `significance` |
| `motif_appearance` | `manifestation_notes` |
| `thematic_connection` | none |
| `scene_sequence` | none (a shadow table, §5.4) |

Scriptyard's per-placement note (`instanceNote`) maps to
`scene_character.notes` and `scene_prop.usage_note` cleanly. The naming
difference is a writer's inconvenience, not a gap.

`thematic_connection` is different. §6.6 says it is one of the two links
that is a **claim** rather than a connection, which is why it carries its
own `lifecycle_status`. A claim is exactly what an author annotates: *why*
does this prop embody forgiveness? It has typed fields for the kind of
connection and none for the reasoning.

## The proposal

1. **Add `notes` to `thematic_connection`.**
2. **Do not rename** `scene_prop.usage_note` or
   `motif_appearance.manifestation_notes`. Both are typed notes — how the
   prop is used, how the motif manifests — and the names say more than
   `notes` would.

## What it breaks

A field on one entity; additive. Q10 projects connections, so its result
moves only if the fixture authors a note.

## Alternatives

**Rename everything to `notes`.** Uniform, loses meaning, and breaks every
writer for cosmetics.

**Do nothing.**

## Unresolved

- Should `actor_character_role`, the other claim, be checked for the same
  need? It already has `notes` and `scope_details`.
