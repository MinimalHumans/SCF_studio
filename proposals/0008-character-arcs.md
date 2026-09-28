<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0008 — Character arcs as positional state

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `schema/entity_registry.py` (two new entities); `registry.json`, `scf-schema.sql`, `entity-reference.md`, `junction-keys.json` if either is a link; the conformance fixture; possibly Q01/Q02/Q12 |

## The problem

**SCF can say how a relationship changes across the story, and how a
motif does, but not how a character does.**

What exists today:

| Where | What it is | Queryable over story time? |
|---|---|---|
| `character.arc_description` | One textarea. | No — prose. |
| `emotional_arc` + `emotional_beat` | The **audience's** emotional journey (tier 5). | Yes, but it is not a character's arc. |
| `character_relationship.relationship_arc` + `relationship_state` | A relationship's arc, with stages that begin at a scene (`latest_wins`). | Yes. |
| `motif.evolution_description` + `motif_state` | A motif's arc. The registry's own help text: *"Narrative summary. The queryable stages live in motif_state rows."* | Yes. |
| `costume_progression` | Wardrobe change. | No — prose. |

The format already has a proven pattern for "a thing that changes over
the story": a narrative summary on the subject plus a `*_state` entity
keyed to the scene where each stage begins, resolved by `latest_wins`
(§4.5). It is used twice. The one arc every screenwriting method names
first — the protagonist's — is the one it is not used for.

**This has actually bitten.** Scriptyard has an Arc card type with three
fields: `subject` (who or what changes), `axis` (e.g. trust → betrayal)
and `direction` (positive, negative, flat, cyclical). An Arc placed in a
scene is a stage of that arc at that position. None of it has an SCF home:
`arc_description` would take the prose and lose the axis, the direction
and every placement.

## The proposal

Two entities, following `relationship_state` exactly.

**`character_arc`** — tier 2, one row per arc (a character may have
several, e.g. an outer and an inner arc):

| Field | Type | |
|---|---|---|
| `character_id` | reference → character, required | Whose arc. Named `<subject>_id` so §2.3 ownership applies: the arc is deleted with the character. |
| `axis` | text | The dimension of change, e.g. "trust → betrayal". |
| `direction` | select: `positive`, `negative`, `flat`, `cyclical` | |
| `description` | textarea | Narrative summary. |
| `notes` | textarea | |

**`character_arc_state`** — tier 2, `positionPattern: latest_wins`:

| Field | Type | |
|---|---|---|
| `character_arc_id` | reference → character_arc, required | |
| `scene_id` | reference → scene | The position this stage begins; in force until a later row supersedes it. |
| `stage_label` | text | Short handle, e.g. "walls up". |
| `description` | textarea | |

`character.arc_description` stays, as the narrative summary — the same
division `motif.evolution_description` and `motif_state` already make.

**Fixture:** one arc for Eleanor with three states, so the pattern is
visible in the published file.

## What it breaks

- Schema version moves; two entities is additive under §11.1.
- Generated artifacts regenerate. The entity count goes from 99 to 101.
- **No canonical query reads them** until one is told to. Whether Q02 or
  Q12 should is a separate decision (Unresolved), and adding them to a
  query moves that query's published result.

## Alternatives

**A polymorphic `arc`** whose subject is any entity (character,
relationship, location, the town). More general, and it would match
Scriptyard's free-text `subject`. But relationships already have their
own arc, and a polymorphic subject costs a `polymorphicType` declaration
and resolution everywhere. The character case is the overwhelming one.

**Reuse `emotional_arc`.** Wrong subject: it is the audience's arc, and
Q11 reads it as such.

**Structured fields on `character`** (`arc_axis`, `arc_direction`).
Cheap, but one arc per character and no positions. That loses exactly
what a placed Arc card says.

**Do nothing.** Arc material lands in `arc_description` or a
`collaboration_note`, and nothing can ask "where is Eleanor on her arc in
scene 12?" — which is the kind of question §12 exists to answer.

## Unresolved

- **Character only, or polymorphic?** And if character-only, should a
  Scriptyard Arc whose subject is not a character map anywhere?
- **Should Q02 (subject in context) or Q12 (continuity) report the arc
  state in force?** The pattern makes it cheap; it moves published results.
- **`direction` as a closed vocabulary**, or text? Scriptyard treats it as
  text with four suggested values.
- **Scriptyard's side:** its Arc card names its subject in free text.
  Mapping to `character_id` needs a reference on the card, not name
  matching.
