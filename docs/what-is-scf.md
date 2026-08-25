<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# What is SCF?

**A film is not one document.**

It is an actor's performance, a writer's screenplay, a director's
intent, a designer's world, an editor's final cut — and a thousand
decisions made across all of them. Today those live in separate files,
separate formats, separate tools, and most of the connections between
them live in somebody's head.

SCF — the Story Context Framework — is a file format for the film
itself: what is true of it, at any point in it, in a form a person and
a machine can both read.

---

## Start with the screenplay

The screenplay is the spine, and it is already almost a database.

A hundred years of convention have made it rigidly structured. A scene
heading is a scene. A character cue is a character. A block of dialogue
belongs to that character, in that scene. Pull the location out of the
heading and that is a thing too.

```
INT. MOON BASE - DAY

A remote moon base on the dark side of the moon has a sole occupant.

                    GEORGE
              (to himself)
          I'm pretty lonely on this
          moon base.
```

Three entities are already in there — a scene, a location, a character
— and the nesting between them is unambiguous.

## Then answer what the screenplay cannot

The screenplay says George is on a moon base and is lonely. It does not
say what he looks like, how he sounds, why he is alone, or what the base
looks like on the day you shoot it. Somebody decides all of that, and
usually writes it down somewhere that is not the script.

SCF is where it goes:

| | |
|---|---|
| **Dr. George Moonman** | 175cm, 65kg, 57. Smokey voice. Favours his left side. Short grey hair. |
| **Moon Base** | Dark side of the moon. As big as a shopping mall. Brutalist. Worn down but functional. |

That is three entity types. **The format defines ninety-nine.** They
exist because sixteen questions need them — which is the next section,
and the more important one.

## The point is the questions

A schema on its own leaves every tool to invent its own answer to the
same question, and then two tools disagree about what a scene contains.

So SCF specifies **sixteen canonical queries**. They are part of the
format rather than a feature of any program, each with a published,
checksummed reference answer, which means two independent
implementations asked the same question return the same thing.

| | |
|---|---|
| **What film is this, and what are its rules?** | The whole creative and technical rulebook, generated rather than written. A new department head in week three. |
| **How should this character's lines sound here?** | Baseline voice, plus what has happened to them since, plus this scene's recording aesthetic. For ADR, a voice session, or a text-to-speech tool that needs more than a reference clip. |
| **What should a frame in this scene look like?** | The project's palette, narrowed by the scene's, narrowed by the shot's — with every layer visible and the winner marked. |
| **What changed between these two positions?** | Scenes 9 and 12 shoot the same day. What has to differ — wardrobe, injury, prop custody, relationship stage? |
| **What does the audience know here?** | Dramatic irony as a queryable fact rather than a note in a margin. |
| **What is missing, and how much does it block?** | Can we shoot scene 12 tomorrow? And: where should the next two hours of prep go? |

The [full list is here](../spec/query-reference.md).

**The same answer serves a person, a tool and a model.** Every query has
three consumer modes: rendered in the editor, raw JSON for a tool, or a
prompt-ready context block.

---

## What it is not

**Not a screenplay format.** Fountain and Final Draft describe a
*document*. SCF describes a *film*. The screenplay lives inside an
`.scf` because story order comes from it, but it is one table of
ninety-nine. You export into SCF; you do not stop using your
screenwriting software.

**Not a production database.** Schedules, budgets, who is on set on
Tuesday — that is the making of a film. SCF is the film.

**Not an asset manager.** SCF stores the *address* of a reference image
or a voice sample, never its bytes. Your asset manager stays where it
is.

**Not a system you move into.** It is an interchange format. It sits
between the script, the asset manager and the shot-list tool and answers
what none of them can answer alone.

---

## How it is put together

### Entities

Every character, location, prop, theme — and the relationships between
them — is an entity. Each carries four things:

- **Identity.** A uuid that survives export, re-import and versioning.
  Rename your character from Bethany to Berthany and every link holds.
- **Subject.** What the row is *about*.
- **Scope.** Whether it is global or applies only to an act, a sequence,
  a scene, a shot, a moment. A costume might be global; a performance
  beat is a moment.
- **Query membership.** Which of the sixteen questions it helps answer.

### Tiers

Tiers separate *what a thing is* from *how deeply it is specified*.

| | | |
|---|---|---|
| **0** | Structural foundation | 24 entities. The objects the film is made of and the wiring between them. Nothing here is an opinion. |
| **1** | Project-level direction | 9. The film's rules, stated once, at the top. Everything below inherits from here. |
| **2** | Subject depth | 30. What a character, prop or location is before any scene bends it. The timeless essence. |
| **3** | Scene detail | 7. The scene's own opinion, between the project's rules and the shot's execution. |
| **4** | Thematic tracking | 8. Meaning, as data rather than an essay. |
| **5** | Emotional architecture | 4. The audience's experience, distinct from the characters'. |
| **6** | Production | 17. How it is actually executed. Camera, staging, performance, sound. |

### The direction cascade

Look and sound resolve **root-first, most specific last**: project →
sequence → scene → shot. The last layer wins, and the query returns the
whole trail rather than just the answer, so you can see where a decision
came from.

The final shot of a film with your protagonist in it is that baseline
character, plus everything that has happened to them since.

### Three position patterns

How the format decides what is true at a given point:

- **Explicit** — this costume is in this scene.
- **Persistence** — the character is injured in scene 9, and limps for
  the rest of the film.
- **Latest wins** — things change; the most recent state is the one in
  force.

### Story order

Derived from the screenplay, not from scene numbers. Scene numbers are
*labels* — a crew already has `12A` printed on a hundred documents, so
they are assigned once and deliberately not renumbered. Story order and
scene numbering are different facts, and the format keeps them apart.

---

## Why SQLite

An `.scf` is a SQLite database with a story schema. One file. It opens
like a document and queries like a database.

- **Public domain.** Your file is a file you own outright.
- **Ubiquitous.** SQLite ships in every OS, phone and browser. Any
  language with a database binding can already read an SCF, with no
  parser and no dependency on this project's code.
- **Archival.** Self-describing, and readable in fifty years.

Nothing uploads. Nothing needs a server.

---

## Depth is optional

**An SCF that is 10% populated is completely usable.**

A film in progress is missing most of itself most of the time, and a
format that refused to answer until every field was filled would be
useless exactly when it is needed. So SCF **describes; it does not
enforce.** Every derivation stays useful on incomplete data and reports
what is missing alongside the answer rather than instead of it.

A file with contradictory data is not an error. It is a file about a
film where two people disagree, which is a normal Tuesday.

---

## Deterministic, on purpose

Generative tools are probabilistic. That is an enormous advantage and a
notable weakness — results vary, and hallucination is real.

SCF is deterministic. Ask the same question of the same file and get the
same answer, every time, from any conforming implementation. That makes
it a good foundation *for* probabilistic tools rather than a competitor
to them: write, generate, edit the result, generate again, and the
context stays fixed and reviewable while the outputs vary.

Continuity, consistency and context live in the file rather than in a
prompt you have to rewrite each time.

It also scales in the direction the tools are going. Today's models have
limited context windows and the queries hand them exactly the right
slice. Tomorrow's will take far more, and the full context is already
in the file waiting.

---

## Where to go next

| | |
|---|---|
| Terms you do not recognise | [Glossary](glossary.md) |
| Questions this raised | [FAQ](faq.md) |
| See it work on a real file | [Walkthrough](walkthrough.md) |
| Build one yourself | [Authoring guide](authoring-guide.md) |
| Implement the format | [The specification](../spec/scf-spec.md) |

**A note on status.** SCF is pre-1.0. The specification is a draft,
[what is safe to build against is stated per subject](../spec/stability.md),
and until 1.0 there is no migration path for files already written. Four
independent implementations have been built from the specification by
people with no access to the reference code; what they got wrong is what
most of its recent revisions are about.
