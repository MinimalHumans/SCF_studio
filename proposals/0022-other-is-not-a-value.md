<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0022 — `other` records that the vocabulary failed, and nothing else

| | |
|---|---|
| **Status** | **implemented** — spec 0.53 |
| **Author** | Raised from 0018's discussion; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | 16 `select` and `multiselect` fields across 14 entities; `schema/entity_registry.py`; possibly the finding catalog; the editor's select control |

## The problem

**Sixteen closed vocabularies end in `other`, and `other` is where the
information goes to die.**

An author picks `other` precisely when they know what the value is and
the list does not contain it. The file then records that the list
failed, and loses the answer. A consumer reading `other` has nowhere to
look.

The sixteen:

| Entity | Field |
|---|---|
| `project` | `genre`, `project_format` |
| `prop` | `prop_type`, `story_function` |
| `story_beat` | `beat_type` |
| `technical_specs` | `aspect_ratio`, `resolution`, `frame_rate` |
| `character_relationship` | `relationship_type` |
| `bundle` | `intent` |
| `actor_character_role` | `role_type` |
| `creative_decision` | `decision_type` |
| `asset_relationship` | `relationship_type` |
| `character_shot_override`, `prop_shot_override`, `location_shot_override` | `override_types` (multiselect) |

Some of these lose more than others. `technical_specs.resolution` lists
nine resolutions and `other`; a production shooting 12K records
`other` and the number is gone. `prop_type = other` for a live animal
loses the one fact anyone would query. `override_types` is a
multiselect, so `other` can sit *alongside* real values with no way to
say what it was.

A closed vocabulary is worth having: it makes grouping, filtering and
UI reliable. The problem is not that the lists are closed. It is that
the escape hatch discards the escapee.

## The proposal

**Make these vocabularies open, and retire `other`.**

1. The registry gains a per-field flag, `open: true`, on those sixteen
   fields. Its meaning: the listed options are the **known** values; a
   writer MAY store any other string, and it is the value, not an error.
2. **`other` is removed** from all sixteen vocabularies. There is
   nothing for it to mean once any string is allowed.
3. **A reader MUST accept an unlisted value** on an open field and treat
   it as a literal label — never map it to a listed value, never blank
   it.
4. **A finding**, `vocabulary.unlisted_value` (info), reports each
   unlisted value once per field, so a maintainer can see the tail and
   decide whether to promote a value into the list.
5. **Fields not marked `open` stay strictly closed**, and that
   distinction is the important half of this proposal. The closed ones
   are the matching axes and the state vocabularies: `time_of_day`,
   `season`, `int_ext`, `lifecycle_status`, `status`, `nature_of_connection`,
   `severity`, and everything §12 defines. §12.17's variant scoring and
   §6.6.1's cut rule only work because those sets are finite.

6. **The editor gives an open field a typeahead**, not a text box.
   Clicking in it shows the known values; typing narrows them; an arrow
   key takes a listed one; pressing Enter on unmatched text commits that
   text as the value. This is the behaviour the screenplay editor's
   character autocomplete already has, and `ui/fields/Field.tsx` already
   falls back to a datalist combobox for long option lists — so the
   control exists and is being extended, not invented. **Without it this
   proposal makes data worse**, because a bare text box invites "Animal",
   "animal" and "live animal" where a list would have offered one of
   them.

## What it breaks

- Files carrying `other` on those fields (the fixture carries none —
  checked: no row uses `other` in any of the sixteen).
- `registry.schema.json` gains the flag; `entity-reference.md`
  regenerates and should render the list as "known values" rather than
  "one of".
- Any consumer that switches exhaustively on one of these vocabularies
  now needs a default branch. That is true of well-written consumers
  already, since §10.1 requires unknown content to survive.
- Schema version moves.

## Alternatives

**A companion column per field** — `prop_type_other`, and so on,
written only when the value is `other`. Sixteen new columns; two fields
to keep in step; a legal state (`other` with an empty companion) that
means "we lost it again"; and the real value still is not queryable
next to the listed ones. This is the conventional answer and it is
worse than the vocabulary being open.

**One JSON overflow column per entity**, keyed by field name. Fewer
columns, and it buries the value in a blob — the same complaint the
existing `json` fields already attract.

**Free text everywhere** — drop the vocabularies. Loses the grouping and
the UI, and the matching axes cannot afford it.

**Do nothing.** `other` keeps costing exactly one fact per use, and the
facts it costs are the unusual ones, which are the ones worth recording.

## Unresolved

- **Is the open/closed split right as drawn above?** `story_beat.beat_type`
  is the interesting case: it is not a matching axis, but a queryable beat
  taxonomy has some value. Open it, or keep it closed and extend the list?
- **`variable`** in `aspect_ratio` and `frame_rate` is a real production
  answer, not an escape hatch. It stays. Should `varies` on
  `location_variant.time_of_day` be read the same way (see 0012)?
- **Value hygiene.** Open fields will accumulate "animal", "Animal" and
  "live animal". Should the finding report near-duplicates, or is
  case-insensitive comparison enough?
- **Multiselect.** Does an open multiselect store unlisted values in the
  same list as listed ones? It should, but the editor's chip control has
  to make the distinction visible.
