<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Authoring guide

How to build up an `.scf` — what to fill in first, what can wait, and
what the format expects of you as an author rather than as an
implementer.

**This document states no rules.** Where it appears to, the
[specification](../spec/scf-spec.md) is what actually binds.

---

## The one thing to understand first

**Depth is optional, and stopping early is a valid state.**

An SCF that is 10% populated answers questions about the 10% and tells
you what is missing from the rest. It does not refuse, does not error,
and does not need to be "finished" before it is useful. A film in
progress is missing most of itself most of the time.

So the order below is not a checklist to complete. It is the order in
which filling something in starts paying off, and you can stop at any
point and still have a file worth having.

---

## The shape of the work

```
Ingest or write a screenplay
        ↓
Define narrative structure          ← acts, sequences, story beats
        ↓
Define the shooting script          ← shots, coverage
        ↓
Define entities and relationships   ← the ninety-seven other tables
        ↓
A queryable database
```

What you get out: full film context, linked and bundled assets, and
sixteen questions that answer themselves.

---

## Stage 1 — Get the screenplay in

**Start here always.** Story order is derived from the screenplay, and
almost everything positional depends on story order existing.

Import Fountain or Final Draft. The editor parses headings into scenes,
character cues into characters, dialogue into lines, and pulls locations
out of the headings.

What you have immediately: scenes in the right order, a cast list, and
locations. That is enough for a few queries to say something.

**Do not renumber scenes to be tidy.** Scene numbers are labels a crew
prints on call sheets, not positions. The format keeps story order and
scene numbering apart precisely so that scene 12A can sit between 12 and
13, and so that a scene added late can carry a number that sorts oddly
and still sit in the right place. If your numbers look wrong, they are
probably right.

**What to fix now rather than later:** character names. Everything binds
by uuid so you *can* rename freely — Bethany to Berthany, no links
broken — but a cue that parsed as two different characters because of a
typo really is two characters, and merging them later is work.

## Stage 2 — Narrative structure

Acts and sequences are **spans**: you define where one *starts*, not
which scenes belong to it. Membership is worked out from the boundaries.

That means inserting a scene in the middle joins it to the right act
automatically, and it means you cannot accidentally have a scene in two
acts or in none.

Add story beats where you have them. They are cheap, and they make the
whole-story queries useful much earlier than you would expect.

## Stage 3 — The project's rules, once, at the top

This is tier 1, nine entities: the project's vision, its visual
identity, its cinematographic philosophy, its colour palette, its sonic
identity, its costume design philosophy.

**This is the highest-value hour you will spend on the file**, for a
structural reason rather than an aesthetic one: everything below
inherits from here. The direction cascade resolves root-first, so a
project-level statement is the answer everywhere nothing more specific
has been said — which, early on, is everywhere.

A file with tier 1 filled in and nothing else already answers "what film
is this and what are its rules" completely.

## Stage 4 — Subject depth

Tier 2, thirty entities: what a character, prop or location **is**,
before any scene bends it.

A character's voice — pitch, pace, accent, what they do while listening.
A prop's surface. A location's design. None of it is scene-specific, and
that is the test: **if the answer changes depending on which scene you
are asking about, it belongs in stage 5, not here.**

This is where a character stops being a name and becomes something you
could brief a concept artist or a casting director on.

**A cycle worth knowing about:** character data generates a reference
image; the image links back to the character; the data and that anchor
image together generate more images that reinforce the character
further. The file gets more specific as you use it.

## Stage 5 — What happens to things

Everything so far has been timeless. This is where the film starts
moving, and you choose how a change behaves:

- **Explicit** — this costume is worn in this scene.
- **Persistence** — injured at the creek, and limping from there on.
- **Latest wins** — the state changes repeatedly; the most recent one
  before this point is in force.

Pick the pattern that matches what is actually true. The commonest
mistake is writing a scene-by-scene state row for something that changed
once — use persistence and let it carry.

## Stage 6 — Scene and shot detail

Tier 3 is the scene's own opinion: emotional target, lighting design,
colour palette, set dressing. Tier 6 is execution: camera, staging,
performance, sound.

You do not need these for a scene until you are actually preparing that
scene. Filling in tier 3 for scene 47 in week one is work you will throw
away.

## Stage 7 — Meaning and audience

Tiers 4 and 5, twelve entities: motifs, subtext, thematic connections,
emotional arcs, and what the audience knows versus what the characters
know.

Most people leave this until last and most people should. But it is the
part that is normally an essay nobody reads, and here it is queryable —
*"we say this film is about forgiveness, show me where"* returns an
actual answer, with the gaps visible.

---

## Assets

SCF stores a file's **address**, never its bytes.

Addresses are written relative to a **root**, like
`@project/ref/eleanor/voice_01.wav`. The `@project` part stands for a
folder that whoever opens the file supplies. Two studios with entirely
different storage can open the same `.scf` and resolve the same assets,
because nothing in the file hard-codes a path.

**Never paste an absolute path.** It will work on your machine and
nowhere else, and the format reports it as a defect rather than silently
accepting it.

Assets attach in layers — a global bundle for a character, a binding for
a scene, an override for a specific shot — and the media query returns
the whole trail with the winner marked. Start with the global bundle and
add overrides only where a shot genuinely needs something different.

---

## Working habits

**Record decisions as you make them.** Creative decisions and notes
attach to any row, and six weeks later somebody will ask why the kitchen
is warm when the project palette says cold. The provenance query answers
that — but only if somebody wrote it down at the time.

**Cut rather than delete.** A cut row vanishes from every answer and
stays in the file, so a decision can be reversed without losing the
record of it.

**Let the readiness query tell you where to work.** Rather than guessing
what to fill in next, ask it: pick a query, pick a scene, and get the
gaps ordered by how much they block. It is the honest answer to *"where
should the next two hours of prep go"*.

**Extend with `x_`.** Columns prefixed `x_` are yours and no conforming
implementation will touch them. If your extension turns out to be
generally useful, [propose it](../proposals/README.md).

---

## What good looks like

Not completeness. A well-made `.scf` at any stage has:

- **The screenplay in**, so story order is real.
- **Tier 1 stated**, so the cascade has a root to fall back to.
- **Depth where the work is happening**, and nothing where it is not.
- **Decisions recorded** alongside the values they explain.
- **Assets addressed relative to a root**, so the file travels.

Everything else is a matter of how far into the film you are.

---

## Next

- [Walkthrough](walkthrough.md) — the same ideas against a real file
- [Entity reference](../spec/entity-reference.md) — all 99, generated
  from the registry
- [Query reference](../spec/query-reference.md) — the sixteen questions
- [Glossary](glossary.md) — terms this guide assumed
