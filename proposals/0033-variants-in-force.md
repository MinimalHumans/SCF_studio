<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0033 — Which character or prop variant is in force

| | |
|---|---|
| **Status** | **implemented** — spec 0.60, schema 2.20 |
| **Author** | Found designing the character workspace in scf-app (the Look tab's "Young Eleanor" case); drafted with Claude |
| **Opened** | 2026-10-02 |
| **Affects** | New §4.8; §6.3 (qualifiers); §12.8 and §12.8.1 (bindings and anchors); §12.16 Q02; new columns `scene_character.variant_id`, `scene_prop.variant_id`, `character_asset_binding.variant_id`, `prop_asset_binding.variant_id`; `entity_anchor.subject_variant_id` gains a meaning; a new finding `presence.variant_foreign`; `stability.md`'s media row; the fixture |

## The problem

**`character_variant` and `prop_variant` can be authored, and nothing in
the format says where either one applies.** A variant is a standing fact
about a subject — Young Eleanor, the locket with its chain broken — with
no positional pattern and no junction that names it at a scene. So no
query can ever say "this is the variant in force here".

[0027](0027-binding-filters-that-nothing-reads.md) found the consequence
and removed `variant_id` from `character_asset_binding` and
`prop_asset_binding`, because a filter nothing can evaluate is a trap
that looks like a feature. It left the door open on purpose: *"If a rule
arrives — a `scene_prop.variant_id`, say — the filter comes back with
it."* This proposal is that rule.

Two things are wrong today, and only the first was known:

1. **Variant media cannot be scoped.** An author with a reference sheet
   for Young Eleanor can bind it to the character, where it applies in
   every scene, or attach it as an anchor (below). Neither says "use
   this where she appears as her younger self". The location equivalent
   works, because §12.17 defines the location variant in force.

2. **`entity_anchor.subject_variant_id` is declared and read by
   nothing.** §12.8 collects every verified anchor whose subject and
   anchor type match, at every position — and with no position asked
   about at all. An anchor recorded as Young Eleanor's face is returned
   as Eleanor's face in every scene of the film. It is the same class of
   defect 0027 was about, on the one table 0027 did not cover, and the
   fixture cannot show it: it has no variants and no variant anchors, so
   a reader that honours the column and one that ignores it produce
   byte-identical artifacts.

This bit while designing the Look tab of the character workspace. The
workspace lets a writer drop a reference image and say what it is for;
"this is what she looks like as a girl" had nowhere to go that Q13 would
honour, and the only row that seemed to hold it is the one that is
silently ignored.

**A variant is not a performance state.** `performance_state` modulates a
performance and persists (§4.5 pattern 2): wounded from scene 9 until
resolved. `physical_state_filter` and `vocal_state_filter` already scope
media to those. A variant is a different *design* of the subject — age,
disguise, transformation, a damaged prop — that the production builds,
dresses or casts separately, and it is on or off per appearance rather
than persisting. The two compose: Young Eleanor can be wounded.

## The proposal

### 1. The presence link names the variant

Add a nullable `variant_id` to the two presence junctions:

| Column | References | Null means |
|---|---|---|
| `scene_character.variant_id` | `character_variant` | the character as defined, no variant |
| `scene_prop.variant_id` | `prop_variant` | the prop as defined, no variant |

The presence link is where an author already says "she is in this
scene", and so it is where "she is in it as her younger self" belongs.
Flashback scenes are rarely contiguous, which is why neither a scene
range nor a pattern 3 state row fits (see Alternatives).

A `variant_id` naming a variant of **another** subject is a finding,
`presence.variant_foreign` (warning), and that link puts **no** variant
in force.

### 2. New §4.8 — The variant in force

Proposed wording:

> **A subject's variant in force at a position is determined by its kind.**
>
> - **Location** — the variant §12.17 selects for the scene.
> - **Character or prop** — the variant named by the subject's
>   `scene_character` or `scene_prop` link at that scene. With no link,
>   or a link whose `variant_id` is null or names another subject's
>   variant, **no variant is in force**.
> - **At a shot**, the variant in force is the scene's. No shot-level
>   column exists.
> - **With no position**, no variant is in force for any kind.
>
> A presence link's `role_in_scene` or `significance` does not affect
> this: a mentioned character may carry a variant, and it is in force
> for whatever reads it.

### 3. Bindings regain the filter

Restore `variant_id` on `character_asset_binding` and
`prop_asset_binding`. §12.8.1's filter table changes one row:

| Filter | On | Satisfied where |
|---|---|---|
| `variant_id` | `character_asset_binding`, `prop_asset_binding`, `location_asset_binding` | §4.8 puts that variant in force at the position |

The trail line is the one the location filter already writes — `variant
filter vs "<name>" in force`, or `variant filter, no variant in force
here` — so no new trail vocabulary is needed.

### 4. Anchors honour `subject_variant_id`

Add to §12.8, after "An anchor contributes the asset it anchors":

> **An anchor naming a variant contributes only where that variant is in
> force (§4.8).** An anchor naming none is the subject's own.
>
> **Where a variant is in force and has at least one anchor of the
> requested anchor type, the subject's own anchors of that type do not
> contribute.** An anchor is identity — "this is her face" — and two
> faces at one position contradict rather than combine. Where the
> variant has no anchor of that type, the subject's own still apply.
>
> **With no position, only the subject's own anchors contribute.**
>
> Every anchor that does not contribute MUST appear in `trail` with the
> reason, as §12.8.1 requires of an excluded binding.

This applies to all three subject kinds, so a location anchor naming a
`location_variant` now follows §12.17 as well.

### 5. Q02 reports the variant

§12.16 gains `characterVariant` and `propVariant` beside
`locationVariant`: the variant in force for a character or prop subject,
projected, or null. Per §12.16 they are null, never omitted, for the
other kinds.

## What it breaks

- **Schema bump** (2.19 → 2.20). Four columns and one registry field marker added; `initDatabase`
  ALTER-adds them on open, so existing files read unchanged (§11.0).
- **Any file with variant anchors changes meaning** — from "everywhere"
  to "where the variant is in force". No fixture row is affected; a user
  file might be.
- **Published Q02 moves** — two new members, null on the fixture today.
- **Every published result is otherwise unchanged, which is the
  problem.** The fixture has no variants. A rule it does not exercise is
  the invisible defect one revision later, so implementation is not
  done until the fixture carries one (see Unresolved).
- **`selectLocationVariant` gains callers** — anchors now depend on it,
  so a change to §12.17 changes anchor resolution too.
- Regenerated: `registry.json`, `scf-schema.sql`, `junction-keys.json`,
  `entity-reference.md`, `finding-catalog.json`, Q02's result. The keys
  do not move, but only because of a marker this proposal had to add —
  see the Resolution.

## Alternatives

**Do nothing.** Variants stay prose. The character workspace either
hides variant media or stores it in `subject_variant_id`, which looks
like it works and is ignored by every query. That is the state 0027
called the worst option, on a different column.

**A positional pattern on the variant** — a `character_variant_state`,
latest wins (§4.5 pattern 3). Flashbacks interleave with the present: a
variant in scenes 3, 9 and 17 needs a "back to the character" row after
each, and forgetting one leaves the variant in force for the rest of the
film. Presence is authored per scene anyway; this puts the fact beside
it.

**A scene range on the variant.** Same problem, worse: one contiguous
range cannot describe non-contiguous appearances.

**Score variants against the scene, as §12.17 does for locations.**
Location variants have axes a scene also carries — time of day, weather,
season. Character and prop variants have none; `context` and
`emotional_state` are free text.

**Use the performance-state filters.** They exist and they evaluate.
But they scope by a *state* that persists, and a variant is a *design*
switched per appearance; overloading one for the other loses the
distinction the format draws between `performance_state` and
`character_variant`.

**Put the variant on `shot_character` / `shot_prop` instead.** Finer,
and it would allow present and past in one scene. Most variants hold
for a whole scene, though, and shot rows exist only once a scene is
broken down, which is long after a writer knows who appears as whom.
Scene-level first, shot-level later if needed — below.

## Settled before implementation

| Question | Settled |
|---|---|
| Both versions of one character in one scene? | Not at scene level. If it matters, `shot_character.variant_id` later — additive, and the shot decides. |
| The anchor rule | Displacement, as proposed: a variant's anchor of a type replaces the subject's own of that type. |
| The fixture case | A new flashback, scene 25: Marcus as a boy at the creek, with a variant for him. |
| Q03, Q12, Q04 carrying the variant on each cast entry | Not in this proposal. Done in [0035](0035-variants-in-the-cast.md). |
| `entity_anchor`'s three state columns, also unread | Out of scope; removed by [0034](0034-anchor-state-columns.md). |

---

<!-- A maintainer fills this in when the proposal is resolved. -->

## Resolution

**Accepted and implemented, 2026-10-02.** Spec 0.60, schema 2.20.

**The natural key was the thing this draft got wrong.** It said
`junction-keys.json` would not move because `variant_id` is an attribute
of the link. The derivation disagreed: a natural key was EVERY reference
a link declares, so `variant_id` joined the key the moment it was added,
and Eleanor-in-scene-9 as herself and as a variant became two links
rather than one written twice. `junctions.test.ts` caught it. Fixed by
declaration rather than by a list: a `qualifier` marker in the registry
(and `registry.schema.json`), read by `junctionKeyFields`, and stated in
§6.3. A second pair written for one link is now
`junction.duplicate_key_conflicting`, which `variants.test.ts` pins.

**The fixture.** Scene 25, `EXT. CREEK CROSSING - DAY (FLASHBACK)`, is a
wordless coda after scene 24: Marcus at nine building a dam across the
shallows and letting it go. Appended rather than inserted, because line
uuids are pure position and an insert re-points every line anchor after
it. Creative decision 2 said "No flashbacks"; it now rules out a
flashback to the drowning and allows this one image of before. The creek
gained a summer baseline variant, without which the flashback resolved
"Creek — winter flood".

**What moved.** Q02 by its two null members; Q10's spine by scene 25.
No other published result changed — which is the reader-run lesson
again: every normative result sits where no variant is in force, so all
sixteen read the same whether an implementation honours §4.8 or not. The
non-normative `Q13-scene25` and `variants.test.ts` are what see it.

**One test learned something.** `bindingFilters.test.ts`'s guard probes
each filter with the ids of the table it references, and `prop_variant`
is empty in the fixture, so it had nothing to probe with and reported
the column unread. A filter naming a row that does not exist must still
exclude, so the guard now probes with one.
