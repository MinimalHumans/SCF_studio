<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0002 — Ownership should be declared, not matched by column name

| | |
|---|---|
| **Status** | draft — still open |
| **Author** | Found by the fifth independent reader run (G-28); written up by the maintainers |
| **Opened** | 2026-08-25 |
| **Affects** | Spec §2.3, `schema/entity_registry.py`, `registry.json`, Editor conformance (`conformance.md` §2.3) |

## The problem

**§2.3 decides who deletes what by matching a column name.**

> **Ownership.** A field named `scene_id` means the row BELONGS to that
> scene and MUST be deleted with it. Any other reference to `scene`
> means the row POINTS AT the scene and MUST retain its identity with
> the reference cleared.

**Thirty-seven entities declare `scene_id`.** For most the rule is
right: `set_dressing`, `lighting_design` and `scene_color_palette` are
about a scene and should not outlive it.

`clip.scene_id` is the one worth arguing about. A clip is recorded
footage. Deleting a scene from a script and thereby deleting the footage
of it is a different policy from deleting the scene's set dressing, and
§2.3 currently makes that decision by noticing that a column is spelled
a particular way.

**This is the construction §12.1.2 spent four revisions removing.** That
section said "any column ending `_id` MUST be dropped", which was true of
the four polymorphic references it was written for and also true of
`external_id` on ten entities. It deleted twelve legitimate columns from
every projected row, survived four revisions and three reader runs, and
was fixed in 0.40 by making the registry declare which columns are
polymorphic. §12.1.2 now closes with:

> A rule that pattern-matches on a name will eventually match something
> the name did not mean; a rule that reads a declaration will not.

§2.3's ownership rule is the same shape, in a rule whose failure mode is
data loss rather than a missing field.

**And the declaration already exists.** The registry has `parentEntity`
and `parentField`, and §2.3's own bullet list is introduced by "stated in
terms of registry metadata rather than enumerated lists". But **only four
of the thirty-seven** `scene_id` entities declare a parent. The other
thirty-three are owned by name-matching alone, so the declaration and the
rule disagree about what the mechanism is.

This affects the Editor role rather than the Reader, so the reader run
that found it did not have to resolve it and did not.

## The proposal

**Make `parentEntity`/`parentField` the sole statement of ownership.**

1. Populate `parentEntity` and `parentField` on every entity that
   genuinely belongs to another — the thirty-three that currently rely
   on the name match, plus any elsewhere in the schema.
2. Rewrite §2.3's bullet:

   > **Ownership.** An entity that declares `parentEntity` BELONGS to
   > that entity and MUST be deleted with it, through the column named
   > by `parentField`. Every other reference means the row POINTS AT its
   > target and MUST retain its identity with the reference cleared.
   > `act.start_scene_id` and `sequence.start_scene_id` declare no
   > parent and MUST be re-anchored (§5.4).

3. Add a check to `schema/lint_registry.py`: **any column named
   `<entity>_id` on an entity that declares no parent must be
   deliberate.** Either it is a parent and should say so, or it points
   at something and the linter records that it was considered. The point
   is that the thirty-three get looked at once, and that a
   thirty-eighth cannot be added without a decision.

Populating step 1 is where the argument happens, and it should happen
entity by entity rather than by translating the existing rule wholesale
— otherwise this changes the mechanism and preserves every judgement the
mechanism made by accident.

## What it breaks

**Nothing, if step 1 reproduces the current behaviour exactly.** The
value is that each of the thirty-three becomes a decision somebody made
rather than a consequence of spelling.

**Something, wherever it does not** — and `clip.scene_id` is the
candidate. If clips stop being deleted with their scene, an Editor
implementation that deletes a scene now leaves rows behind that it
previously removed, which is a change to Editor conformance and to what
`canonicalDump` produces after a delete.

That is a real break and it should be argued on its own, not smuggled
in. It may be that footage of a cut scene should be cut too, and that
the current rule is right by luck.

## Alternatives

**Do nothing.** The rule is right for at least thirty-six of thirty-seven
today. The risk is entirely in the thirty-eighth entity, added by someone
who names a column `scene_id` for a row that should outlive the scene, and
finds out when data disappears.

**Fix only `clip`**, by renaming its column or excluding it in prose. The
smallest change, and it leaves the mechanism intact — so the next case
arrives the same way.

**Keep the name match and add an explicit opt-out** (`ownedByName:
false`). Less disruptive, and it makes the default silent and the
exception loud, which is backwards for a rule that deletes rows.

**Derive ownership from the DDL's `ON DELETE CASCADE`.** Attractive —
the database already states this — but it moves the decision into the
generated artifact and gives an entity no way to say it points at
something it happens to cascade with.

## Unresolved

- **Should a clip be deleted with its scene?** The concrete question
  behind all of this, and it is a production question rather than a
  schema one. Somebody who has lost footage this way should answer it.
- How many of the thirty-three are genuinely arguable? If the answer is
  one, the smaller alternative above may be the right call and this
  proposal is over-engineered.
- Does anything else in §2.3's derived list match on a name rather than
  a declaration? The asset-usage rule reads `referenceEntity`, which is
  a declaration; the link-label rule reads `hidden`, likewise. Ownership
  may be the only one, which would make this narrow and finishable.

---

## Resolution

*Still open.* 0.47 implemented 0001 and a defect adjacent to this one —
§2.3's asset-usage rule could not see a polymorphic reference — but
neither touches ownership.

The adjacent fix is worth noting here because it is evidence for this
proposal rather than against it: §2.3's asset rule already read a
declaration and still had a gap, which suggests the problem with the
ownership bullet is not that declarations are unreliable but that
ownership is the one bullet in that list still matching on a name.

**The question this waits on is unchanged and is not a schema question:
should a clip be deleted with its scene?** As of 2.13 the fixture has
clips, so somebody can now try it and see what they lose.
