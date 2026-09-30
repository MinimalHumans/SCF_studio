<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0026 — Two JSON fields that are really rows

| | |
|---|---|
| **Status** | **implemented** — schema 2.15 |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | 2 fields removed, 2 entities added; `junction-keys.json` gains an entry; the fixture |

## The problem

**Two `json` columns hold what the rest of the schema would hold as
rows.**

`costume_progression.progression_stages` is a wardrobe's stages across
the story. SCF has a pattern for exactly this, used by
`relationship_state` and `motif_state` and proposed again in 0008: a
state row anchored at the scene where the stage begins, resolved
`latest_wins` (§4.5). As a JSON blob the stages cannot be positioned,
cannot be queried at a scene, and cannot be cut individually.

`staging_beat.character_positions` maps a character to where they stand.
It is keyed by **name**, beside `characters_involved` which is also
names (0025), in a schema where a character is a row with a uuid. A
rename breaks both.

## The proposal

**`costume_progression_state`** — tier 2, `positionPattern: latest_wins`:

| Field | |
|---|---|
| `costume_progression_id` | reference, required |
| `scene_id` | reference — where this stage begins |
| `stage_label` | text |
| `wardrobe` | textarea |
| `meaning` | textarea |

**`staging_beat_character`** — a link entity, natural key
(`staging_beat_id`, `character_id`):

| Field | |
|---|---|
| `staging_beat_id` | reference, required |
| `character_id` | reference, required |
| `position` | text |
| `movement` | textarea |

Both JSON columns are removed. `junction-keys.json` grows from thirteen
link entities to fourteen, and §6.6's "eleven of the thirteen carry no
`lifecycle_status`" becomes twelve of fourteen: the new link is a
connection, not a claim.

## What it breaks

- Two field removals and two entities; entity count 99 → 101, plus
  whatever 0008 and 0023 move.
- §6.6 and any text quoting the thirteen.
- **The fixture has no rows in either** — `costume_progression` is empty
  and both `staging_beat` JSON columns are unset — so the new entities
  need fixture rows, or they ship unexercised, which is the failure mode
  0001 and 0007 both describe.

## Alternatives

**Leave them as JSON and document the shape**, as 0025 does for the
three that stay. Cheaper, and it leaves a positional concept
(`progression_stages`) outside the mechanism the format uses for every
other positional concept.

**Fold `costume_progression` into `costume` plus states**, dropping the
middle entity. Tidier, and a bigger change than this one.

## Unresolved

- **Does `staging_beat` need `movement` per character**, when
  `movement_description` already sits on the beat? Perhaps the link
  needs only `position`.
- **Fixture content:** which scene gets a costume progression with
  stages? The obvious candidate is Eleanor's, over her three-act change.
