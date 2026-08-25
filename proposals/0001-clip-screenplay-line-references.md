<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0001 — Declare `clip`'s screenplay line columns as references

| | |
|---|---|
| **Status** | draft |
| **Author** | Found by the fifth independent reader run (G-04); written up by the maintainers |
| **Opened** | 2026-08-25 |
| **Affects** | `schema/entity_registry.py`, `registry.json`, spec §12.1.2 (no wording change), `Q13`/`Q15` results for any file with `clip` rows |

## The problem

**Two bare row ids can appear in a projected row, in the section that
spends a paragraph forbidding exactly that.**

`clip.screenplay_line_start_id` and `clip.screenplay_line_end_id` are
declared in the registry as plain integers:

```
clip  screenplay_line_start_id  INTEGER  referenceEntity: (none)
clip  screenplay_line_end_id    INTEGER  referenceEntity: (none)
```

They index `screenplay_lines.id`. Because they carry no
`referenceEntity`, §12.1.2's "reference columns MUST be resolved to
uuids … derived from the registry" does not reach them. Because they are
not declared polymorphic, 0.40's drop rule does not reach them either.

So they survive projection unchanged, as integers, four paragraphs after
§12.1.2 says:

> **Row ids MUST NOT appear.** They are local to a file (§6.2) and a
> writer may renumber them. A result carrying one describes the file
> rather than the story.

This was created by 0.40. Before it, §12.1.2 dropped every column ending
`_id`, which caught these two by accident while destroying `external_id`
on ten entities. Fixing the larger defect uncovered a smaller one that
the broken rule had been concealing.

**No published artifact can catch it.** The conformance fixture's `clip`
table is empty, and §12.1.2 omits empty fields, so a correct
implementation and one leaking row ids produce byte-identical output on
all sixteen results. That is the same argument 0.40 made about
`external_id`, and it applies here unchanged.

`clip` is reachable: the registry lists it among Q13's entities, and Q15
projects whatever entity the caller names.

## The proposal

Declare both columns as references in `schema/entity_registry.py`:

```python
FieldDef("screenplay_line_start_id", "First line", "reference",
         reference_entity="screenplay_lines"),
FieldDef("screenplay_line_end_id", "Last line", "reference",
         reference_entity="screenplay_lines"),
```

§12.1.2 then projects them as `screenplay_line_start_uuid` and
`screenplay_line_end_uuid` through the derivation it already has. **No
prose changes.**

This is possible because `screenplay_lines` is in `uuidExtraTables`
(§1.3.1): it is not a registry entity, but it carries uuid row identity
on §6.1's terms, so there is a uuid to resolve to.

**The shape of the fix is the point.** §12.1.2's closing sentence is
that a rule which pattern-matches a name will eventually match something
the name did not mean, and a rule that reads a declaration will not.
This adds the missing declaration rather than adding a second rule about
these two columns.

## What it breaks

**Any file with `clip` rows changes shape in Q13 and Q15.** Two integer
members become two uuid members with different names. Nothing in the
repository is affected, because the fixture has no clips — which is the
whole problem.

Under §11.0 this is free today. After 1.0 it would be a breaking change
to a result shape and would need §11's process, which is an argument for
doing it now rather than an argument about whether it is right.

`uuidLookupForAll` must be able to index `screenplay_lines`, and this
would be the **first reference anywhere in the schema pointing at a
`uuidExtraTable`**. Checked rather than assumed: `uuidLookupFor` issues
`SELECT id, uuid FROM <table>` and is indifferent to whether the table
is a registry entity, and `uuidLookupForAll` adds every reference target
to its set. So it works, and the implementation risk is smaller than it
first appeared.

## Alternatives

**Do nothing.** Defensible only if you accept row ids in results for
these two columns, which contradicts §12.1.2 and §6.2. The practical
consequence is small today and grows the moment anyone imports footage.

**Drop them from projection**, as the pre-0.40 rule did by accident.
This loses real information — where in the script a clip starts and ends
— and §12.1.2 already argues against dropping a column merely because it
is inconvenient.

**Declare them polymorphic.** Wrong: their target is fixed, not chosen
per row, and `polymorphicType` means something specific.

**Widen §12.1.2 to resolve any `*_id` whose stem names a known table.**
This is the same name-matching construction the section spent four
revisions removing, and would resolve `external_id` if an entity called
`external` ever existed.

## Unresolved

- Should other `uuidExtraTables` columns be reachable as references at
  all, or is `clip` a special case? A general answer would be better
  than two field declarations, but there may be no second instance —
  and `screenplay_prop_tags` anchors to a line by uuid rather than by
  row id, which suggests the format already prefers the other approach
  where it had the choice.
- Is a clip's line range better expressed as a span (§5) than as two
  endpoint references? Out of scope here, but worth knowing before this
  is settled, because it would make the question moot.

---

## Resolution

*Left empty until the proposal is accepted, declined or deferred.*
