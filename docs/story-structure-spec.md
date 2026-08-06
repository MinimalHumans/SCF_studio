# Story structure and the shoot surface — spec

Status: phases 1-4 built and shipped. This document is kept as the
design record — how the model was arrived at and what was rejected. The
rules as they now stand are in `docs/conventions.md` §4, which is the
one to read for current behaviour.

Original status note: phases 1-4 built (rounds 20, 21, 22). Decisions marked
**[open]** below were resolved as follows: section text is read before
depth; act and sequence numbers renumber from the boundaries at every
commit; the structure panel is a top-level tab; the shoot outline shows
story beats only; `scene_sequence` rows no boundary explains are counted
and reported, never deleted.

## 1. The problem

Defining an act currently requires inventing a sequence, because a scene
reaches an act only through `scene_sequence → sequence.act_id`. There is
no way to say "scenes 32 to 54 are Act II". Separately, shots have
nowhere to be authored, and the script tab is a narrative document that
should not become a shooting script.

## 2. What already exists in 2.3

The hierarchy is mostly there. It is the *reachability* and the
*surfaces* that are missing, not the entities.

| Entity | Key fields | Notes |
|---|---|---|
| `act` | `act_number`, `function`, `dramatic_question`, `shift` | tier 0, scope act |
| `sequence` | `sequence_number`, `act_id`, `goal`, `conflict`, `outcome`, `turning_point` | tier 0, scope sequence |
| `scene` | `scene_number`, `location_id` | tier 0 |
| `scene_sequence` | `scene_id`, `sequence_id`, `order_in_sequence` | junction, hidden name |
| `story_beat` | `scene_id`, `beat_order`, `beat_type`, `description`, `pov_character_id` | tier 0, scope scene |
| `shot` | `scene_id`, `shot_number`, `shot_order`, `shot_size`, `camera_angle`, `camera_movement`, `lens_choice` | tier 6, scope shot |

Two things that already work and this spec leans on:

- Fountain **sections** (`# ACT II`, `## SEQUENCE 6`) tokenize with depth
  and text, survive the row model in line meta, and round-trip
  byte-stable. They simply never become entities.
- **Commit-time linking** (`linkAndCreateAtCommit`) already turns typed
  headings into scenes and locations, with a review modal, conflict
  resolution, and re-threading. Structure reuses that machinery rather
  than inventing a second one.

## 3. Model: contiguous spans, anchored at their start

An act **begins** at a scene and runs until the next act begins. A
sequence likewise. Nothing stores an end.

    act.start_scene_id       → scene
    sequence.start_scene_id  → scene

Membership is **derived**, not enumerated:

> `actOf(scene)` = the act whose start scene has the greatest story
> position ≤ this scene's position. `sequenceOf(scene)` likewise.

Why the start anchor rather than a start/end pair or per-scene rows:

- Overlaps and gaps become impossible by construction. Nothing to
  validate, nothing to repair.
- A scene inserted at 45 joins Act II automatically, which is what the
  writer means.
- No end anchor to drift out of sync when scenes move.
- "Scenes 32–54 are Act II" is two placements (Act II starts at 32,
  Act III starts at 55), not 23 junction rows.

The cost: acts and sequences must be contiguous. Confirmed acceptable —
a cross-cut sequence interleaved with another cannot be expressed, and
if that changes, enumerated membership is the only model that supports
it and this decision has to be revisited rather than patched.

**Story position** is the ordering used everywhere else in the app:
`(scene_number IS NULL), scene_number, id`. A boundary anchored to an
unnumbered scene therefore sits after every numbered one. Deterministic,
but worth surfacing in validation (§8).

### Derived vs stored, and what the file carries

The boundary IS the stored fact; membership is a view over it. A reader
that has `act.start_scene_id` plus scene ordering can reconstruct every
membership, so nothing is lost when the file is opened by Python v1 or
any other consumer. No `scene.act_id` is added — that would be a second
copy of a derivable truth, the failure mode already avoided with scene
labels and prop names.

`scene_sequence` rows are the one exception, materialized at commit
(§7), because they already exist and queries already read them.

### Numbering

`act_number` and `sequence_number` become **labels**, not order. Order
is derived from the boundary. **[open]** Should the app renumber them to
match on commit, or leave them authored and flag disagreement? Renumber
is tidier; leaving them authored respects a writer who calls something
"Act 2A".

## 4. Schema delta

Three additive, optional reference fields. No table changes, no
migration of existing rows, no query breakage.

    act.start_scene_id       reference → scene   (optional)
    sequence.start_scene_id  reference → scene   (optional)
    shot.story_beat_id       reference → story_beat (optional)

`shot.scene_id` stays required, so a shot is valid with or without a
beat, and existing shots are untouched.

Route: edit `schema/entity_registry.py`, regenerate, lint, bump the
version — `docs/conventions.md` §8. (This spec was written while the
schema still lived in the v1 editor's directory.)

Note on beats: 2.3 has four beat entities. This spec means `story_beat`
throughout. `performance_beat` is the editor's ＋beat button (a dialogue
moment), `emotional_beat` is audience-journey, `staging_beat` is
blocking. The shoot outline shows `story_beat` only.

## 5. Authoring surfaces

Both, as decided: sections author structure, the panel edits it.

### 5a. Script tab — sections become entities

`# ACT II` and `## SEQUENCE 6 — The Siege` are authored in the
screenplay like any other line. At commit, a section line whose depth is
1 proposes an act, depth 2 a sequence, anchored to **the next scene
heading below it**. This mirrors heading → scene exactly:

- auto-save links to existing acts/sequences, never creates
- explicit Commit proposes new ones in the review modal, with
  similar-name hints and the same conflict resolution
- an unlink affordance for a section whose anchor went wrong

**[open]** Depth mapping. `#` = act and `##` = sequence is the common
convention, but some writers use `#` for sequences and never write acts.
Options: fixed mapping, or infer from the section text (`ACT`/`SEQUENCE`
keywords) with the depth as a fallback.

### 5b. Structure panel

Edits what sections declare: rename, drag a boundary to another scene,
insert an act/sequence at a scene, delete a boundary (the span merges
into the one above — no orphans possible). Reads as the spine of the
script with scene counts per span.

Where it lives: **[open]** a new top-level Structure tab, or a mode
inside Subjects. Subjects is already the "all things X" surface and acts
are a subject type; a separate tab is more discoverable.

### 5c. Shoot tab — outline tree

A separate tab, expandable, exactly the sketch:

    ACT II
      SEQUENCE 6 · "The Siege"
        sc 42 — EXT. RANCH – SUNSET
          BEAT A · The family realizes they're trapped
            42A  WIDE
            42B  CU – Sarah
            42C  INSERT – Empty rifle
          BEAT B · The werewolves emerge
            42D  LOW ANGLE
            42E  POV

Rules:

- **Scenes are read-only here.** One truth: scenes come from the script.
  The shoot tab never creates, renames, or reorders them. This is the
  whole point of the split — the narrative document owns structure, the
  shoot surface owns coverage.
- Acts, sequences, and the scene spine render derived from §3.
- **Beats and shots are authored here**: add, rename, reorder, delete,
  edit shot fields inline (size, angle, movement, lens).
- Shots with no beat sit directly under the scene, so coverage can be
  listed before beats exist. Beats are not a prerequisite.
- A scene with no shots still appears, so the outline doubles as a
  coverage checklist.

**[open]** Does the shoot tab also show `performance_beat` and
`staging_beat`, or `story_beat` only? Only story beats matches the
sketch; the others are richer but the tree gets noisy fast.

## 6. Shot numbering

`shot_number` is **authored and stored**, with a derived default on
create (`42A`, `42B` … from the scene number and `shot_order`).

This deliberately contradicts the rule applied to scene labels and prop
names, and the reason is that a shot number is not a display label — it
is an identifier issued to a crew. Once a shot list goes out, 42A stays
42A even if the scene renumbers. Deriving it would silently rewrite
paperwork that exists on paper.

Consequence: renumbering a scene leaves shot numbers stale by design.
The outline shows the derived code beside an authored one when they
disagree, so a shot list can be reissued deliberately.

## 7. Materializing `scene_sequence`

At commit, `scene_sequence` rows are written to match derived
membership: create missing, delete rows that contradict the boundaries,
set `order_in_sequence` from story position. Existing queries keep
working unchanged.

The rows can be stale between commits — the same staleness the script
tab already has, reported the same way.

**[open]** Should hand-made `scene_sequence` rows that contradict a
boundary be deleted silently, or surfaced in the review modal first? A
project that predates boundaries will have rows that no boundary
explains. Safer default: surface them once, delete on confirmation.

## 8. Validation

New readiness findings, none of them blocking:

- `sequence.act_id` disagrees with the act derived from its boundary
  (two truths; the authored field wins, the finding reports it)
- a sequence's start scene precedes its act's start scene
- two acts anchored to the same scene
- an act or sequence with no boundary at all (invisible in the outline)
- a boundary anchored to an unnumbered scene (sorts after everything)
- scenes before the first act boundary (legal — a cold open — but worth
  naming)

## 9. Phasing

All four phases are implemented. Original plan:

1. **Schema + derivation.** The three fields, `structure.ts` deriving
   membership, unit tests against the fixture. Nothing user-visible.
2. **Structure panel, read-then-write.** Render the spine; then boundary
   placement and editing.
3. **Sections at commit.** `#`/`##` propose acts and sequences through
   the existing review modal; `scene_sequence` materialization.
4. **Shoot tab.** Outline tree, beat and shot authoring, shot numbering.

Phase 1 is a prerequisite for everything. Phases 2 and 3 are
independent of each other. Phase 4 depends on 1 only.

## 10. Explicitly out of scope

- Non-contiguous acts or sequences (§3)
- Shot lists as a printable/exportable document
- Any second screenplay document — the shoot tab is a view over the same
  scenes, never a parallel text
- Reordering scenes from the shoot tab
