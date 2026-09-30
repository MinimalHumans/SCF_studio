<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0005 — `required` means incomplete, and says so

| | |
|---|---|
| **Status** | **implemented** — spec 0.54 |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Spec §9.1, §9.4; `finding-catalog.json` (two new codes); `scf-core` report; the conformance fixture (one new row); possibly §4.4 |

## The problem

**The registry marks 132 fields on 84 entities `required`, and the
specification never says what that means.**

§9.1 says:

> The schema constrains almost nothing beyond required fields and
> reference columns.

— which reads as though `required` constrains something. Checked, it
constrains nothing:

- **The DDL does not enforce it.** `shot.scene_id` is `required` in the
  registry and a plain nullable `INTEGER` in `scf-schema.sql`. So is
  every other required column.
- **No finding exists for it.** The catalog's 36 codes include nothing
  for an absent required value.
- **Nothing in `scf-core` reads it.** `registry.ts` declares the property;
  the only consumer anywhere is scf-app's entity form, which draws an
  asterisk.

So two conforming implementations can disagree about whether a row with
a null required field is valid, and both are right. One refuses to
write it, which violates §9.1's "never rejected on write". The other
accepts it silently, which leaves a half-entered row nobody is told
about. §9.2 asks for the opposite of silence: "MUST report the problem
separately".

**This has actually bitten.** Scriptyard lets a writer put a Shot card
anywhere on the canvas, including outside any scene — a shot idea not
yet placed. `shot.scene_id` is `required`. The exporter could not tell
from the specification whether writing that shot is conforming or
corrupting. §5.5 says half-placed structure is valid and MUST produce a
finding. The `required` flag seems to say the opposite, and nothing
settles which one governs.

**The fixture cannot show either reading.** Checked: no row in
`hollow_creek.scf` has an absent value in any of the 132 required
fields. A strict implementation and a permissive one agree on every
published artifact.

## The proposal

**Give the flag a meaning consistent with §5.5 and §9.1: a required
field is one a row is incomplete without.** Keep the flag everywhere it
is today, including `shot.scene_id`.

1. **Replace §9.1's opening sentence** with:

   > The schema constrains almost nothing. A field the registry marks
   > `required` is one a row is **incomplete** without: a writer MUST NOT
   > refuse a row for lacking it, and a reader MUST report the absence
   > (§9.4). A value is absent when it is null, or text that is empty
   > after trimming. Duplicates, contradictions and gaps are likewise
   > **findings** — reported, never rejected on write.

2. **Add two catalog codes.** §9.4 requires a code's severity to come
   from the catalog, so the two cases need two codes, not one code with
   a variable severity:

   | Code | Severity | Raised when |
   |---|---|---|
   | `field.required_absent` | `info` | A row of a non-link entity lacks a required value. The row is unfinished; nothing is wrong. |
   | `junction.endpoint_absent` | `warning` | A row of one of the thirteen link entities (`junction-keys.json`) lacks a required reference. A connection with a missing end connects nothing. |

   **Where a more specific finding already covers the same column, it is
   raised instead, not as well.** `character_relationship`'s endpoints
   are the case in point: `relationship.endpoint_absent` already exists
   and is an error. The report must not double-count.

   The required set is **read from the registry**, never listed by hand.
   The link-entity set is read from `junction-keys.json`.

3. **Add one unplaced shot to the fixture** — a shot with no `scene_id`,
   authored through the fixture's dump/rebuild loop (`fixtures/build/`). Without it the new
   finding fires on nothing, and a report that never raises it is
   indistinguishable from one that has no such code. This is the same
   argument the fixture's scene 17 made for §4.1's fallback.

## What it breaks

- **The finding catalog** grows from 36 to 38 codes and introduces a new
  area, `field.`. The catalog, its manifest entry and the report tests
  regenerate.
- **The fixture's report** gains one `info` finding from the unplaced
  shot. `scf-check` still exits 0. The fixture already carries one
  deliberate `info` finding (`structure.scene_not_in_script`) for
  exactly this reason, so the precedent exists.
- **Any published result that enumerates every shot** would gain a row.
  Checked in the sense of "known to be possible", not "known to happen":
  most shot queries take a scene or a shot as a parameter, but this has
  to be verified at implementation rather than assumed.
- **Every existing file with blank required fields** starts reporting
  them. Under §11.0 that is the point, not a cost.

## Alternatives

**Drop `required` from `shot.scene_id` alone.** This was the first
suggestion when the Scriptyard case surfaced. It fixes one instance and
leaves 131 flags still meaning nothing. Worse, it makes the unplaced
shot silent rather than reported, which is the opposite of what §5.5
asks for.

**Make `required` enforce: `NOT NULL` in the DDL, refusal on write.**
This contradicts §9.1, §5.5 and §9.2 outright, and makes every
half-entered row unwritable. SCF describes; it does not enforce.

**Remove `required` from the registry entirely.** Honest about the
current state, but it throws away the one bit of authorial intent the
flag carries — which fields a row is not finished without — and an
editor loses its only hint about which fields to prompt for.

**Do nothing.** Leaves §9.1 implying a constraint that no artifact
carries, and every independent implementation guessing. A reader run
would find this.

## Unresolved

- **What is an unplaced shot's code?** §4.4.1 covers a shot in a scene
  with no `scene_number` (the letter run alone). It says nothing about a
  shot with no scene. The natural answer is that §4.4.3's allocation
  does not apply and any restamp MUST leave it unchanged. Does §4.4 need
  a sentence saying so, or does "relative to the scene" (§4.4.2) already
  imply it?
- **Is `info` right for a missing `name`?** 27 of the 132 required
  fields are `name`. A nameless character is unfinished, but it is also
  unlabelled everywhere it appears. Should `name` be `warning`, and if
  so, is that a third code or a reason to make severity a registry
  property?
- **Dangling references are a different question.** A required
  reference that is present but points at no row is not "absent". Only
  `relationship.endpoint_absent` and the structure codes cover dangling
  references today. Out of scope here, but the two codes above should
  not be read as covering it.
- **Is `field.` the right area name**, or should the non-link case sit
  under an existing area?
