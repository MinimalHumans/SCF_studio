<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0027 — Binding filters that nothing reads

| | |
|---|---|
| **Status** | **implemented** — spec 0.56, schema 2.16 |
| **Author** | Found by the first `scf-mcp` session, writing a prompt for shot 3B; written up by the maintainers |
| **Opened** | 2026-09-28 |
| **Affects** | Spec §12.8; six columns on the three `*_asset_binding` entities; `stability.md`'s media row; the fixture. Overlaps [0012](0012-time-of-day.md) (`time_of_day_filter`'s vocabulary) and [0025](0025-json-that-duplicates-or-means-nothing.md) (`conditions_json`) |

## The problem

**The three binding entities declare six columns that narrow when a
binding applies. The media cascade reads one of them.**

| Column | On | Read by §12.8? |
|---|---|---|
| `scene_range_start_id` / `scene_range_end_id` | all three | **yes** |
| `variant_id` | all three | no |
| `act_id` | all three | no |
| `time_of_day_filter` | `location_asset_binding` | no |
| `physical_state_filter` / `vocal_state_filter` | `character_asset_binding` | no |
| `conditions_json` | all three | no |

`bindingApplies` (spec §12.8, `resolution.ts`) tests the scene range and
nothing else. So a binding scoped to a variant, an act, a time of day or
a physical state **applies everywhere** — the opposite of what its
author wrote, and silently: the resolution `trail` shows the binding
firing, with no note that four of its five conditions were never
evaluated.

Nothing in the repository catches this. The fixture authors none of the
six columns, so every artifact is byte-identical whether an
implementation honours them or ignores them — the same invisible class
as `external_id` before 0.40 and the empty `asset_relationship` table
before 2.13. A second implementation reading the registry would honour
them, diverge from the published results on a file that used them, and
be right.

This bit in practice. Asked for the wind chime's media at scene 3, the
file returned its scene 24 state, because the way to express "only after
scene 24" that the resolver reads is the scene range, and the columns
that look like they mean that do not. The fixture now uses the range —
which is the workaround, not the answer.

## The proposal

**Every declared filter is either read by §12.8 or removed.** The
recommendation, per column:

1. **`variant_id` — specify.** §12.17 already scores
   `location_variant` against a scene on three axes and reports
   `mismatches`. A binding naming a variant applies where that variant
   is the one in force at the position being asked about, and nowhere
   else. This is the column with a definition already written; it only
   has to be pointed at.
2. **`time_of_day_filter` — specify**, on 0012's vocabulary: the
   binding applies where the scene's `time_of_day` equals it, compared
   trimmed and case-insensitively. Without 0012 it is free text matched
   against free text, which is why the two proposals should land
   together.
3. **`physical_state_filter` / `vocal_state_filter` — specify.** A state
   filter applies where a `performance_state` of that modality is in
   force at the position (§4.5) and its value matches. This is the
   "Eleanor guards her left side after scene 9" case, which today lives
   in prose inside a field value.
4. **`act_id` — remove.** Act membership is derived from boundaries
   (§5.1), so an act-scoped binding is a scene range written in a way
   that goes stale when a boundary moves. Anything it can say, the range
   says better.
5. **`conditions_json` — remove**, as [0025](0025-json-that-duplicates-or-means-nothing.md)
   already proposes.

And, whatever is decided per column: **§12.8 MUST state that a binding
applies only where every filter it declares is satisfied**, and the
`trail` MUST say which filter excluded a binding that did not fire. A
cascade that cannot explain an absence is the failure the first MCP
session actually hit.

## What it breaks

- **Any file already using these columns changes meaning** — from "in
  force everywhere" to "in force where the filter matches". No fixture
  does; a user file might.
- **Removing two columns is a schema bump** and drops whatever was
  written in them.
- **Two published results move if the fixture exercises the new rules**,
  which it should: a rule this proposal adds and the fixture does not
  use is the same invisible defect one revision later.
- **§12.17's variant scoring gains a second caller**, so a change to it
  now changes media resolution as well.

## Alternatives

**Do nothing.** The columns stay, and every one of them is a trap that
looks like a feature. An author uses `time_of_day_filter` because it is
there, gets a night reference in a day scene, and finds out why by
reading the resolver. That is the worst of the options and it is the
current state.

**Remove all six and keep only the scene range.** Honest, smaller, and
defensible: the range can express every case above, awkwardly. It loses
the ability to say *why* a binding is scoped — "because she is injured"
rather than "because scenes 9 to 24" — which is exactly the kind of
authorial intent the rest of the format keeps.

**Specify all six, including `conditions_json`.** Rejected with 0025:
nobody can say what a condition is, and a filter nothing can evaluate is
the problem this proposal is about.

## Unresolved

- Does a filter that cannot be evaluated — a variant that does not
  exist, a state modality the file never authors — exclude the binding
  or leave it in force? Excluding is safer and loses media silently;
  leaving it in force is the current behaviour and is wrong. A finding
  either way is probably the answer.
- Whether the filters compose as AND (recommended) or whether a binding
  with several filters means "any of these".
