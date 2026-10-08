<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0019 — Location mood lives in `location_design`

| | |
|---|---|
| **Status** | **declined** — mood stays in `location_design.emotional_target`; see Resolution |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Nothing if declined. |

## The problem

**Scriptyard's Location carries "Mood / Atmosphere". SCF's `location` has
no such field.**

This was deliberate. The registry's own comment on `location` (Phase 1D,
"aggressively slimmed") records it:

> Removed (now lives in existing Tier 2 entities):
> - mood, lighting, color_palette → location_design + location_color_scheme

`location_design.emotional_target` is the field: the emotional effect the
place is designed to have.

## The proposal

**Decline adding `mood` back to `location`.** A writer mapping a location
mood creates or updates the location's `location_design` row and writes
`emotional_target`.

The reasoning from Phase 1D still holds:

- `location` is identity and narrative function;
- how a place *feels* is design;
- design is tier 2, where it can be refined by `location_variant` rather
  than fixed on the identity row.

## What it breaks

Nothing. Scriptyard's exporter creates a tier-2 row from a one-line field.
That is heavier than a column, and correct.

## Alternatives

**Restore `location.mood`.** Convenient for writing tools, and it creates
two places for one fact the moment a designer fills in
`emotional_target`.

## Unresolved

- Is `emotional_target` really the same thing as a writer's "mood"? Or
  is a writer's mood closer to `location_variant.emotional_shift`, or to
  scene `tone`?

---

## Resolution

**Declined, 2026-10-08.** Settled in the 1.0 decision pass
(`docs/release-checklist.md` §A).

`location` does not regain `mood`. How a place feels is design, design
is tier 2, and `location_design.emotional_target` is where it lives —
where `location_variant` can refine it instead of a single value fixed
on the identity row. A writing tool that has a one-line mood writes
`emotional_target` on the location's `location_design` row.

The Unresolved question — whether a writer's mood is nearer
`location_variant.emotional_shift` or scene `tone` — is an authoring-
guide matter for exporters, not a schema change.
