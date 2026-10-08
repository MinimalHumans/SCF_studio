<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0036 — `project.synopsis`

| | |
|---|---|
| **Status** | **implemented** — spec 0.62, schema 2.22. See Resolution |
| **Author** | Found while building the editor's Project tab; drafted with Claude |
| **Opened** | 2026-10-07 |
| **Affects** | `schema/entity_registry.py` (`project`); `registry.json`, `scf-schema.sql`, `entity-reference.md`; §12.12 Q00's result if authored in the fixture |

## The problem

**A project can say what its film is about in one sentence, and why it
is being made, but not what happens in it.**

`project` carries `logline` — one sentence, by its own placeholder — and,
on its Vision tab, `vision_statement` and `creative_philosophy`, which
are about intent and approach. `project_vision` goes further in the same
direction: `core_question`, `why_tell_this_story`, `what_makes_different`.
Every one of them is about the film. None of them is the story.

The **synopsis** — what happens, start to finish, told short — is the
most common development document there is. It is the paragraph in a
pitch, the page in a coverage report, the thing a collaborator reads
before the script. Between the logline and the screenplay SCF has
nothing.

**This has actually bitten.** The editor's new Project tab gathers the
baseline of the film — the project row, the title page, the technical
specs, the project folder — and the first thing asked for that was not
there was a synopsis. The places it could go today:

- **`logline`** — one sentence by definition. A synopsis is a paragraph
  to a page, and putting one there makes the logline field lie.
- **`vision_statement`** — answers *why* and *how*, not *what happens*.
  A reader of Q00 cannot tell which part of it is story.
- **`notes`** — accepts anything, and therefore says nothing about what
  it holds.

It matters beyond the editor. §12.12 Q00 answers **"what film is this"**.
A brief that carries the logline, the vision, the tone, the palette and
the delivery spec, and not what the film is about past one sentence, is
missing the part most of its readers — a collaborator, or a model
generating against it — need first.

**Not the screenplay's synopsis lines.** Fountain's `=` lines
(`line_type = synopsis`, §1.3.1) are outline notes attached to a
section or a scene, inside the script. They describe a piece of the
story, and they are text in the screenplay rather than a property of the
project. This proposal does not touch them.

## The proposal

**Add `synopsis` to `project`**, on the General tab, directly after
`logline`:

```python
FieldDef("synopsis", "Synopsis", "textarea",
         placeholder="What happens, start to finish, told short",
         help_text="The story in prose: a paragraph to a page. The "
                   "logline is one sentence; this is the story told "
                   "short. Not the screenplay's = synopsis lines, which "
                   "outline a section or a scene."),
```

Optional, no default, no vocabulary. Plain text, like every other
`textarea`.

**Author a synopsis in the fixture**, on Hollow Creek's project row,
through the dump/rebuild loop — the editor MVP rule that a capability
the format claims should be visible in the published file. Q00 projects
the project row, so the published Q00 result shows the field surviving
projection (§12.1.2).

**No normative text changes.** Q00's layer list (§12.12) names entities,
not fields, and projects the whole row; the field reaches the brief
without a word of §12.12 changing. The spec's header names the schema
version it describes, so that line moves to 2.22 — an editorial change,
a patch increment under §11.5, since no MUST changes.

## What it breaks

- **Schema version** moves, 2.21 → 2.22. An additive optional field —
  the change §11.1 describes as the normal case.
- **Generated artifacts**: `registry.json`, `scf-schema.sql`,
  `entity-reference.md`, and their `SHA256SUMS` entries; a new
  `schema-2.22` tag.
- **The published Q00 result**, if the fixture authors the field, which
  it should. No other published result projects the project row.
- **Files already written** gain the column on open — `initDatabase`
  ALTER-adds a missing registry column (§1.4) — and it stays null until
  someone writes one. No migration.
- **Readers written against 2.21** see an unknown column under §10.1 and
  preserve it. Nothing else changes for them.
- **Implementations that render the project row field by field** will
  show one more textarea. The reference editor does: its Project tab
  draws the General tab from the registry, and would place the synopsis
  beside the logline.

## Alternatives

**Do nothing; use `notes` or `vision_statement`.** Works today, and is
what a writer would do. It leaves Q00 unable to say which text is the
story, and it puts a different kind of thing in each file under the same
field.

**A development-documents entity** — rows of `{ kind, text }` for a
one-line, a one-paragraph and a one-page synopsis, a treatment, an
outline. More general, and it is where this would end up if a project
needed several lengths of the same thing. It is also a new entity, a
new closed vocabulary for `kind`, and a question about how Q00 would
choose among the rows — a much larger proposal for a need nobody has
reported yet. One field now does not prevent it later: a synopsis field
could become that entity's first row.

**Two fields, short and long** (`synopsis_short`, `synopsis`). The
industry does use both a paragraph and a page. But the line between
them is a convention, not a fact, and two fields invite the same text
in both. See Unresolved.

**Put it on `project_vision`.** That entity is about intent — the core
question, why this story, what makes it different. A synopsis is not
intent; it is the story. `project` already carries the logline, and the
synopsis is the logline's longer form.

## Unresolved

- **One length or two?** This proposal says one field and leaves the
  length to the writer. If a second is wanted, is it a short form beside
  this one, or does that tip the balance toward the documents entity?
- **Should the editor's title page draw on it?** No — a synopsis is not
  printed on a title page, and nothing here changes the Fountain export.
  Noted because the Project tab puts the two side by side and the
  question will be asked.
- **Who writes Hollow Creek's synopsis for the fixture**, and how long
  should it be? It should be long enough to be plainly a synopsis rather
  than a second logline — a paragraph, at least.

---

<!-- A maintainer fills this in when the proposal is resolved. -->

## Resolution

**Implemented 2026-10-07, accepted 2026-10-08.** Spec 0.62 (editorial),
schema 2.22, commit `0d65695`.

It was built ahead of the 1.0 decision pass, which then accepted it
(`docs/release-checklist.md` §A14). Adding a field is additive and could
have landed after 1.0, but the release schema carries every other
registry change anyway, so this costs one field in a bump that was
already happening. The case for it is Q00's: a brief that answers "what
film is this" and cannot say what happens past one sentence is missing
what its readers need first. Under rev 13's rule — declaring a thing
and authoring a row that exercises it are one change — it landed with a
synopsis authored in the fixture, so Q00's normative result carries the
field.

The three open questions, as settled:

- **One length or two: one.** Writers keep a one-paragraph synopsis for
  pitches and a one-page one for coverage, and the question was whether
  the format should hold a field for each. It does not: the boundary
  between the two is a convention, two fields invite the same text in
  both, and the writer chooses the length of the one. If a project ever
  needs several lengths at once, that is the development-documents
  entity under Alternatives, as its own proposal.
- **The title page: no.** A synopsis is not printed on a title page, and
  the Fountain export is unchanged.
- **Q00: yes,** and with no change to §12.12's text — the brief projects
  the project row whole, so the synopsis reaches it as any other field
  of the row does. The published Q00 result carries it.

**The fixture synopsis** is three paragraphs, written from the
screenplay and the fixture's own character data. It follows the data
and the logline on the timeline — Ada drowned seven years before the
story opens — and avoids restating the number in the confession, where
the screenplay's dialogue says "eleven years" against the data's seven.
That disagreement is in the fixture and predates this proposal. Changing
the script to agree was considered and **declined, 2026-10-08**: the
fixture and the blessed results are published under `schema-2.22`, and
a dialogue fix is not worth moving them.
