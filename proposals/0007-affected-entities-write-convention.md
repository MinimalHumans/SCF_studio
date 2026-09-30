<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0007 — A write convention for `affected_entities`

| | |
|---|---|
| **Status** | **implemented** — spec 0.54 |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | Spec §12.14 (Q15); `scf-core` `mentionsRow`; `fixtures/expectations/Q15.result.json`; the conformance fixture |

## The problem

**`affected_entities` tells a reader four ways to read it, and a writer
no way to write it. All four ways identify a row by something a writer
is allowed to change.**

`collaboration_note.affected_entities` and
`creative_decision.affected_entities` are free-form `json` columns. They
are how a note or a decision is attached to the rows it concerns, and
Q15 (§12.14) is built on them.

§12.14 says a reader MUST accept `entity:id`, `entity#id`, a bare
`entity`, or an object with an entity kind and an optional id. It gives a
writer no instruction at all.

**The `id` in all of them is a row id.** `mentionsRow` in
`canonicalQueries.ts` compares against the integer `id` column. Yet row
ids are:

- **file-local** (§6.2);
- **"a writer may renumber them"** (§12.1.2);
- **the one thing §12.1.2 forbids a result to carry**, for exactly that
  reason.

So an attachment written today is silently re-pointed at a different
row by any rebuild that renumbers. The fixture's own build is such a
rebuild — screenplay line uuids are pure position and FKs are off
during it. A reference that survives renumbering exists: the uuid
(§6.1). Nothing accepts it here.

**No published artifact exercises any of this.** Checked: the fixture
has no `collaboration_note` rows, and all five `creative_decision` rows
have `affected_entities = NULL`. Q15's blessed result has
`"attached": {"decisions": [], "notes": []}`. An implementation that
ignores attachment entirely matches it byte for byte. It is the same
invisible-defect shape as `external_id` in 0.40 and `clip` in 0001.

**This has actually bitten.** Scriptyard's Thought cards become
`collaboration_note` rows. A Thought sits in a scene, and the natural
export attaches it there. Scriptyard would be the first writer of this
column that is not scf-app, and it cannot tell from the specification
what to write.

## The proposal

1. **Add a writer rule to §12.14:**

   > A writer SHOULD record `affected_entities` as a JSON array of
   > strings `"<entity>:<uuid>"`, one per attached row, where `<entity>`
   > is a registry entity name and `<uuid>` is the row's uuid (§6.1). A
   > writer MUST NOT write a row id: row ids are file-local and may be
   > renumbered (§6.2, §12.1.2).

2. **Extend the reader rule.** A reader MUST also accept `<entity>:<uuid>`,
   and an object whose id member is a uuid, matching by uuid. The row-id
   forms remain **readable**, in keeping with §12.14's permissiveness,
   but are no longer something a conforming writer produces.

   The two string forms are told apart by the value's shape: an integer
   is a row id, a canonical uuid is a uuid. They cannot collide.

3. **Author attachments in the fixture**, through the fixture's dump/rebuild
   loop (`fixtures/build/`):
   - one `creative_decision` and one `collaboration_note` attached to
     scene 12 in the new form, so Q15's `attached` member is non-empty
     in the published result;
   - one note in a legacy row-id form, so the permissive reading is
     exercised as well.

## What it breaks

- **Q15's published result moves**, from empty `attached` lists to
  populated ones. That is the purpose of the change, not a side effect.
- **`mentionsRow`'s signature.** It receives a row id today and would
  also need the row's uuid. This may move `api-surface.json`.
  `scf-app`'s `runnersComposed.ts` calls the core matcher, so it follows.
- **Files already carrying row-id attachments** still read. Nothing in
  the repository writes any.
- **Spec minor bump.** No schema change: the column type is unchanged.

## Alternatives

**A declared link entity instead of a free-form column.** A
`note_attachment` link, polymorphic on its target the way
`thematic_connection` is, declaring `polymorphicType`. It would give
attachments natural keys (§6.3), duplicate detection (§6.4) and uuid
resolution (§12.1.2) for free, and would retire the permissive matcher
altogether.

This is the more principled answer. It is the "declare it, don't match
it" direction §12.1.2 and 0002 both argue for. It is not proposed here
only because it is a new entity, retires a column, and changes Q15's
shape. That is a larger change than the gap that surfaced. **If the
maintainers prefer it, this proposal should be declined in its favour
rather than implemented first and replaced later.**

**An object form `{"entity": …, "uuid": …}`** instead of strings.
Self-describing and extensible. The string form is proposed because it
extends a convention readers already accept (`entity:id`) rather than
adding a fifth shape.

**Do nothing.** Attachments keep pointing at rows by a number the file
may reassign, and Q15 keeps a normative member that nothing tests.

## Unresolved

- **The link entity above.** Decide before implementing either.
- **The prose fallback in `mentionsRow` has matching defects**,
  independent of this proposal:
  - `text.includes("scene:1")` is true for `scene:12`.
  - `text.includes(entityType)` attaches any prose containing "prop" —
    including "appropriate" and "property" — to every prop.

  These are defects rather than design questions, and should be filed
  and fixed as such whatever happens here. They are recorded because
  this proposal's fixture rows are what would first expose them.
- **Should a bare `entity` remain a writer-permitted form** meaning
  "about this kind in general"? It is not a row reference, so the
  row-id objection does not apply to it.
