<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0021 — `scene.characters_present` is a stored derivation

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `scene.characters_present` (removed); Q04 and Q15 results; fixture |

## The problem

**`scene.characters_present` stores, as a JSON list of names, what
`scene_character` already records as links.**

It is declared `json`, `hidden=True`. In the fixture it holds values like
`["Eleanor","Marcus"]`. Three things are wrong with it:

- **It is §3.1's case exactly**: a value computable from other stored
  values, stored. Nothing reads it — checked, the only references are the
  registry and the fixture's build history.
- **It is keyed by name, not identity.** The fixture's own selector notes
  say surnames have changed in its history. These values hold given names
  that happen to still match.
- **It is already stale.** Three of the fourteen scenes have none,
  including the most recently added. No one maintains it, because nothing notices when
  it is wrong.

Q15's published result projects it for scene 12. So the normative
artifact currently teaches a reader that this field is part of what a
scene says.

**This has actually bitten.** Mapping Scriptyard raised the question of
whether a writer should fill it in. The answer should be that it does not
exist.

## The proposal

**Remove `scene.characters_present`.** The cast of a scene is its
`scene_character` rows.

## What it breaks

- **A field removal.** §11.1 forbids this after 1.0 and §11.0 permits it
  now, which is the argument for doing it now.
- **Q04's and Q15's published results** lose the member. Re-blessing is
  the point.
- Generated artifacts regenerate.

## Alternatives

**Keep it, and derive it at write time.** Still §3.1, and still a second
truth.

**Keep it as authored prose** — "the whole town, in the background".
That is `character_dynamics`, or a `scene_character` for a group
character.

**Do nothing.**

## Unresolved

- **The rest of the class.** Several prose fields shadow link entities,
  and two share an entity's name:
  - `scene.thematic_connection` (a textarea, named like the entity);
  - `scene.emotional_beat` (likewise);
  - `theme.character_connections` and `theme.scene_connections`;
  - `theme.motifs` (json).

  They are authored narrative rather than copies, so they do not fall
  under §3.1 the way this field does. Are the name collisions worth fixing
  pre-1.0 anyway?
