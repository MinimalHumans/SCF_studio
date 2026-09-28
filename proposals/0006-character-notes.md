<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0006 — `character.notes`

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `schema/entity_registry.py` (`character`); `registry.json`, `scf-schema.sql`, `entity-reference.md`; the conformance fixture |

## The problem

**`character` is the only core story entity with nowhere to write a
free note.**

Every tier-0 story entity carries a `notes` textarea: `project`,
`location`, `prop`, `act`, `sequence`, `scene`, `story_beat`, `theme`,
`shot`. `character` does not.

Checked, the other tier-0 entities without `notes` all have an evident
reason:

- `collaboration_note` and `creative_decision` are themselves notes.
- `scene_prop` carries `usage_note`, and `motif_appearance` carries
  `manifestation_notes`.
- `scene_sequence` is a shadow table (§5.4).

`character` has no such reason. Its textareas are all typed: `summary`,
`backstory`, `motivation`, `internal_goal` and so on. Each asks a
specific question, and none is the place for "cast older than written"
or "check with the director whether she knows about the letter".

**This has actually bitten.** Every Scriptyard card carries a free note.
Mapping them, every entity type had an obvious home for it except
Character. The choices were:

- **`summary`** — which Scriptyard also has, as a separate field, so the
  note would overwrite it or be concatenated into it.
- **`backstory`** — which it is not.
- **A `collaboration_note`** — whose attachment is by row id in a
  free-form column (see 0007).

The protagonist of any file is the row most likely to accumulate notes,
and it is the one row that cannot hold them.

## The proposal

**Add `notes` to `character`**, declared exactly as `location` declares
it:

```python
FieldDef("notes", "Notes", "textarea", tab="Notes"),
```

Optional, no default, appended after `skills_abilities`.

**Author one character note in the fixture** through the fixture's
dump/rebuild loop, so the field is visible in the published file. This
is the editor MVP rule: a capability the format claims should be
visible in the fixture.

## What it breaks

- **Schema version** moves. It is an additive optional field, the
  change §11.1 describes as the normal case.
- **Generated artifacts**: `registry.json`, `scf-schema.sql`,
  `entity-reference.md`, and their manifest entries.
- **Published results that project a character row**, if the note is
  authored on a character one of them projects. Eleanor and Marcus are
  both named selectors. Either choose a character no published result
  projects, or accept the re-blessing. The second is more honest,
  because it shows the field surviving projection (§12.1.2).
- **Readers written against 2.13** see an unknown column under §10.1 and
  preserve it. Nothing else changes.

## Alternatives

**Do nothing, and route free notes through `collaboration_note`.** This
works only as well as attachment works, and attachment is by row id in a
free-form field (0007). A note is also a different thing from a
collaboration note: the latter is addressed to someone
(`note_type = for cinematographer`, …), and a note to self is not.

**Use `summary`.** Conflates two fields every other tool keeps apart.

**Add `notes` to every entity that lacks one.** Most tier 1–6 entities
have none. They are typed profiles — `vocal_profile`, `lighting_design` —
and whether they want a free field is a different design question
about a different kind of entity. This proposal is deliberately
limited to the one tier-0 outlier.

## Unresolved

- **Should tiers 1–6 follow?** That is a separate proposal, if anyone
  wants it. It is noted here so the narrowness of this one reads as a
  choice rather than an oversight.
- **Which character carries the fixture note**, and is re-blessing a
  character-projecting result acceptable?
