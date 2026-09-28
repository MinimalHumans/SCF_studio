<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0012 — `time_of_day`: one axis, and `day`

| | |
|---|---|
| **Status** | draft |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `scene.time_of_day`, `location_variant.time_of_day`, `location_asset_binding.time_of_day_filter`; spec §12.17; scf-app's two heading-time maps; the fixture |

## The problem

**The vocabulary mixes two different things, lacks the commonest word in
a scene heading, and differs between the two columns §12.17 compares.**

```
scene.time_of_day            dawn morning midday afternoon dusk night continuous
location_variant.time_of_day dawn morning midday afternoon dusk night varies
location_asset_binding.time_of_day_filter   free text, "matches scene.time_of_day"
```

Four things wrong:

1. **Two axes in one column.** Six values are **light** — what the camera
   sees. `continuous` is a **continuity relation** to the previous scene:
   it says "the same time as before", not a time. It belongs to the
   heading's grammar, alongside LATER and MOMENTS LATER, which the column
   does not carry.
2. **No `day`.** DAY is the commonest time word in screenplay headings.
   scf-app's heading parser recognises it. Then **both** of its maps
   (`importPipeline.ts` and `features.ts`, two copies of one rule) map
   it to null. So a script imported from Fountain gets no `time_of_day`
   on most of its day scenes.
3. **The two compared columns disagree.** §12.17 scores a location
   variant by whether its `time_of_day` equals the scene's:
   - a scene can say `continuous`, which no variant can;
   - a variant can say `varies`, which no scene can.

   Neither value can ever score, and nothing says whether `varies` was
   meant to match every time.
4. **`time_of_day_filter` is free text** that "matches"
   `scene.time_of_day`, with no statement of how.

**The fixture already shows the tension:** every heading reading DAY is
stored as `morning` or `midday`. That is an authored refinement. The
heading is not the record, and a record that could only say what the
heading says would lose it.

**This has actually bitten.** Scriptyard's scene time offers Day, Later
and Moments Later alongside the six light values. Three of its nine
values have no mapping.

## The proposal

**`time_of_day` is a light axis.**

1. **Add `day`** to both `scene` and `location_variant`: daylight,
   unrefined. It is the value a heading-only import writes.
2. **Remove `continuous` from `scene`.** Continuity words stay in the
   heading text, which is where the screenplay puts them. The record is
   left empty.
3. **`varies` stays on `location_variant` only**, and §12.17 states that
   a variant saying `varies` agrees with any scene value on that axis.
4. **`time_of_day_filter` becomes a select** over the scene vocabulary,
   matched by equality.
5. **Matching is exact**: `day` does not match `morning`. §12.17's
   scoring stays a count of equal axes.

**Implementation, not format:** the two heading maps in scf-app become one
function in scf-core, mapping DAY → `day`.

## What it breaks

- Files with `time_of_day = 'continuous'` (none in the repository).
- §12.17's variant choice changes wherever a variant says `varies`. None
  in the fixture does.
- Schema version and spec minor bump.
- Import output: day scenes gain `day` where they had null.

## Alternatives

**Add `day`, `later` and `moments later` and keep `continuous`** — make
it a slugline axis. Then §12.17 compares a continuity relation against a
lighting state, and a location variant has to answer "is this variant
for 'later'?".

**Hierarchical matching** (`day` agrees with `morning`, `midday` and
`afternoon`). Better answers, at the cost of a vocabulary with structure
that every reader must implement. Worth it only if `day` turns out to be
common in files that also carry variants.

**Derive time from the heading.** The fixture shows the record is a
refinement of the heading, not a copy of it.

**Do nothing.**

## Unresolved

- **Exact or hierarchical matching** for `day`?
- **Should `evening` exist?** The parser recognises EVENING, SUNSET,
  SUNRISE and MAGIC HOUR, and maps all of them to null.
- **`continuous` resolved by derivation**: should a reader that needs a
  time for a CONTINUOUS scene take the previous scene's? That is a rule,
  and a derived value, and it might belong in §4.
