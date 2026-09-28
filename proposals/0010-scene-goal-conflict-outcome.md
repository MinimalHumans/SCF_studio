<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0010 — Scene goal, conflict and outcome

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `schema/entity_registry.py` (`scene`); `registry.json`, `scf-schema.sql`, `entity-reference.md`; the conformance fixture; Q04 and Q15 results |

## The problem

**`sequence` carries goal, conflict and outcome. `scene` does not.**

Goal / conflict / outcome is the standard dramatic unit of scene
analysis: what the point-of-view character wants here, what stands in the
way, and how it turns. SCF records it for a sequence (`goal`, `conflict`,
`outcome`, `turning_point`) and for an act (`function`,
`dramatic_question`, `shift`). A scene has:

- `summary` — what happens;
- `purpose` — labelled "Dramatic Purpose", i.e. why the scene is in the
  film;
- `emotional_beat`, `character_dynamics`, `tension_level`.

None of them is the want, the obstacle or the turn. `purpose` is closest,
but it is the scene's job in the story, not what a character is trying to
do in it. The two differ in almost every scene worth writing.

`story_beat.value_shift` records a turn, but inside the scene, beat by
beat, not the scene's outcome.

**This has actually bitten.** Scriptyard's Scene carries goal, conflict and
outcome, copied from the shape SCF gives a sequence. They are the three
fields a Scriptyard writer fills first. Mapping them meant folding three
typed values into `summary` or `purpose`, where no query can tell them
apart.

## The proposal

**Add three optional textareas to `scene`**, matching `sequence`'s names
and types exactly:

```python
FieldDef("goal", "Goal", "textarea"),
FieldDef("conflict", "Conflict", "textarea"),
FieldDef("outcome", "Outcome", "textarea"),
```

The fixture authors all three on scene 12, the scene most expectations
key on.

## What it breaks

- Schema version moves; additive under §11.1.
- **Q04's and Q15's published results move**, because both project scene
  12 and §12.1.2 projects every non-empty field. That is the change being
  visible, not an accident.
- `scene` is already the widest tier-0 entity. Three more fields add to a
  form that is already long.

## Alternatives

**Fold them into `purpose` and `summary`.** No schema change, and the
three values become unrecoverable.

**Put them on `story_beat`.** Beats are finer than scenes. A scene's
goal is not the goal of its first beat.

**`x_` columns written by Scriptyard alone** (§10.3). Legal, and it keeps
the data, but it makes the fields private to one writer. That is the
wrong answer for the most widely used scene-analysis model there is.

**Do nothing.**

## Unresolved

- **Should `turning_point` come too**, for full parity with `sequence`?
  Or is `outcome` the scene-scale turning point?
- **`goal` whose?** It is usually the point-of-view character's.
  `story_beat` has a `pov_character_id`; `scene` does not. Is that a gap
  of its own?
