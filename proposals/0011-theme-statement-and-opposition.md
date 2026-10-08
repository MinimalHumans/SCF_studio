<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0011 — A theme's statement and its opposition

| | |
|---|---|
| **Status** | **implemented** — schema 2.14. See Resolution |
| **Author** | Found while mapping Scriptyard's `.scf` export; written up by the maintainers |
| **Opened** | 2026-09-20 |
| **Affects** | `schema/entity_registry.py` (`theme`); `registry.json`, `scf-schema.sql`, `entity-reference.md`; Q00 and Q10 results if authored in the fixture |

## The problem

**A theme in SCF is a topic with a description. It cannot say what the
story argues about that topic.**

`theme` carries `description`, `motifs` (json), `character_connections`
and `scene_connections` (textareas), `evolution` and `notes`. The
fixture's two themes are "Forgiveness" and "What the water keeps".

Most screenwriting practice treats a theme as an **argument**:

- a **statement** — the claim the story makes, e.g. "forgiveness is
  something you give yourself";
- an **opposition** — the counter-argument it tests that claim against.

"Forgiveness" is a topic. The statement is what the film says about it,
and it is the thing a production is asked to keep consistent. SCF has no
place to put it except inside `description`, alongside everything else.

**This has actually bitten.** Scriptyard's Theme carries `statement`,
`expression` and `opposition`:

- `statement` maps to `description`, at a stretch.
- `expression` (how the theme shows up) is close to `evolution` plus the
  thematic connections.
- `opposition` has nowhere to go.

## The proposal

**Add two optional fields to `theme`:**

```python
FieldDef("statement", "Thematic Statement", "textarea",
         help_text="The claim the story makes about this theme."),
FieldDef("opposition", "Counter-argument", "textarea",
         help_text="The position the story tests the statement against."),
```

`description` stays as the general account of the theme.

## What it breaks

- Schema version moves; additive under §11.1.
- Q00 (brief) and Q10 (thematic accounting) project the theme row. Their
  published results move if the fixture authors the fields, which it
  should, on Forgiveness.

## Alternatives

**Use `description` for the statement, `notes` for the opposition.**
Works today, and a reader cannot tell which part of a description is the
claim.

**Model the argument as `thematic_connection` rows** with
`nature_of_connection = challenges`. That value exists, and it says a
*carrier* challenges the theme, not what the counter-position is. It is
complementary, not a replacement.

**Do nothing.**

## Unresolved

- **Does Scriptyard's `expression` need a field too**, or is it
  `evolution`?
- **`theme.character_connections` and `scene_connections` are prose
  shadows of `thematic_connection` rows.** Should they stay? See 0021 for
  the same question about `scene.characters_present`.

---

## Resolution

**Implemented in schema 2.14**, as proposed: `theme.statement` and
`theme.opposition`. `description` stays the general account.

Recorded retrospectively, 2026-10-08 (release checklist §B3): the change
landed in schema 2.14 and `docs/schema-changelog.md` records it, but
this file was never updated, so it read `draft` for six revisions.
