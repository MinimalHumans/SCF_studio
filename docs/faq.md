<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Frequently asked questions

**Nobody has asked these yet.** SCF is pre-1.0 and has had four
independent implementers and no users, so this is a first pass at the
questions the format's shape invites rather than a record of ones
received. Where a real question arrives and this page answers it badly,
the real question wins.

---

## What is it, and what is it not

### Is this a screenplay format?

No, though it holds a screenplay.

Fountain and Final Draft describe **a document**: what is on the page,
in what order, formatted how. SCF describes **a film**: who these people
are, what the room looks like at night in winter, which take was printed,
what is in force at page 47 that was not in force at page 12. The
screenplay lives inside an `.scf` because story order comes from it, but
it is one table out of ninety-nine.

You would not replace Final Draft with this. You would export from it
into this.

### Is it a production database?

No. A production database tracks *the making of* a film — schedules,
budgets, who is on set on Tuesday. SCF tracks *the film*, and the
distinction is deliberate: an `.scf` describes what is in the finished
thing, not the process that got there.

It will happily tell a production database what a scene needs. It will
not tell it when to shoot it.

### Is it an asset manager?

No. SCF stores the *address* of an asset and never its bytes. It knows
that this character's voice reference lives at
`@project/ref/eleanor/voice_01.wav`; it does not know what is in the
file, does not move it, and does not version it. Your asset manager
stays exactly where it is.

### So what is it for?

Answering questions about a specific moment without asking a person.

*What does she sound like in scene 12? What is different about this
room since the storm? Which assets does this shot actually resolve to?
Is this scene ready to shoot, and if not, what is missing?* Those are
four of the [sixteen canonical queries](../spec/query-reference.md),
and they are part of the format rather than a feature of any tool —
which means two different programs asked the same question give the
same answer.

Today those questions get answered by someone who has read everything
and remembers it. That does not scale, does not survive that person
leaving, and cannot be asked by a machine.

---

## Practical

### Why SQLite?

Because it makes the file boring, and boring is the point.

A `.scf` is one file. You can email it. Any language with a SQLite
driver — which is most of them, usually in the standard library — can
read it without a parser, without this project's code, and without
a network. It is queryable the moment you have it, and the format
degrades gracefully: a consumer that understands ten of the ninety-nine
entities can read those ten and ignore the rest.

A folder of JSON would have been more fashionable and worse in every
one of those respects.

### Can I use it alongside my existing pipeline?

That is the intended shape. SCF is an interchange format, not a system
you move into. It sits between the script, the asset manager and the
shot-list tool and answers questions none of them can answer alone.

Nothing in it asks you to change how you store files or how you track
work.

### What can read one today?

The reference implementation, which is TypeScript and unpublished until
1.0, and whatever you write. **Four independent implementations have
been built from the specification by people with no access to the
reference code**, three of them in Python. That is the honest answer to
"can this be implemented from the document", and the defects those runs
found are most of what the specification's recent revisions are about.

### Is there a viewer?

There is an editor in the repository — a browser app, Chromium-only,
that reads and writes `.scf` files. It is not hosted anywhere yet.

---

## Scope and design

### Why sixteen queries? Why those?

Because a format that says "here is a schema, good luck" leaves every
consumer to invent its own answer to the same question, and then two
tools disagree about what a scene contains.

The sixteen are the questions that turned out to be load-bearing when
describing a film: a position, a subject, a diff between two points, a
cascade, a media resolution, a readiness assessment, a whole-story
spine. Each has a published, normative answer computed from the
conformance fixture, so an implementation can be checked rather than
believed.

Sixteen is not a claim about completeness. It is what has been specified
so far, and adding one goes through [the proposal
path](../proposals/README.md).

### Does it enforce anything?

Deliberately not. **SCF describes; it does not enforce.**

A film in progress is missing most of itself most of the time. A format
that refused to answer until every field was filled would be useless
exactly when it is needed. So every derivation stays useful on
incomplete data and reports what is missing — a *finding* — alongside
the answer rather than instead of it.

A file with contradictory data is not an error. It is a file about a
film where two people disagree, which is a normal Tuesday.

### How does it relate to OMC / MovieLabs?

They are not competitors and they do not overlap much.

The Ontology for Media Creation describes the *production* — assets,
tasks, participants, the machinery of making. SCF describes the
*story* — what is true in the film. Entities in SCF carry an
`external_id` precisely so a row can be pointed at its counterpart in
another system.

A bridge document between the two is on the list and is not written.
Until it is, treat this answer as an intention rather than a
specification.

### Why not just use USD?

USD was a direct inspiration, particularly its layering and its
composition model, and the resemblance in the cascade is not accidental.

But USD describes a scene graph — geometry, shading, things in space.
SCF describes narrative intent, which has no geometry and mostly is not
in space at all. "What does she sound like when she is lying" is not a
thing USD is shaped to hold.

The borrowed idea is that a strong opinion at a specific level should
override a broad one, and that you should be able to see the whole
chain rather than just the result.

---

## Using it

### Is it stable? Can I build on it?

**Not yet, and the project says so precisely rather than vaguely.**
[`stability.md`](../spec/stability.md) rates every subject in the format
individually, and until 1.0 ships there is no migration path and no
backward compatibility owed to anything already written — see §11.0.

That is deliberate. Promising stability before anyone has used the
format would be promising something nobody can keep.

### When is 1.0?

There is no date, and anyone giving you one is guessing.

What there is instead: `stability.md` defines 1.0 as the act of moving
every Unstable row to Provisional, and **there are none left**. What
remains is documentation for people who are not implementing the
format, a second maintained implementation, and a published package.
[The release checklist](release-checklist.md) tracks all of it.

### What happens to my files when the format changes?

Before 1.0: they break, and the project will not pretend otherwise.
Existing `.scf` files are explicitly disposable — no migration, no
deprecation window. After 1.0 that inverts and §11 binds.

If you are experimenting now, keep whatever you generated the `.scf`
*from*.

### Can I extend it?

Yes. Columns prefixed `x_` are yours and no conforming implementation
will touch them, and unknown tables survive a round trip rather than
being dropped. If your extension turns out to be generally useful, that
is what [proposals](../proposals/README.md) are for.

---

## The project

### Who is behind this?

Two people, and [`GOVERNANCE.md`](../GOVERNANCE.md) says so plainly
along with what that means for a bus factor. The specification, its
artifacts and their checksums are published under tags and are enough
to implement the format without either of them.

### What licence?

Code is Apache-2.0. **The prose is CC BY 4.0** — a specification nobody
may quote is a specification nobody adopts. The boundary between the two
runs by file type and is stated in [`spec/LICENSE`](../spec/LICENSE).

The screenplay in the test corpus is neither: it is under ordinary
copyright with a narrow grant permitting redistribution with the
repository and use in testing software.

### How do I report a problem, or suggest a change?

A defect in the specification is an issue — the text says one thing and
the artifacts do another, a rule cannot be implemented as written, a
term is used and never defined. You do not need to propose a fix.

A change to the *format* goes through [`proposals/`](../proposals/README.md),
because the argument is the valuable part and it should outlive the
discussion.

Security issues go privately: [`SECURITY.md`](../SECURITY.md).

### What is the fastest way to see whether this is real?

Clone the repository and run the tests. Then open
[`fixtures/expectations/`](../fixtures/expectations/) and read a couple
of the sixteen published answers — they are computed from a small
complete film that ships with the format, and every one of them is
checked on every commit.
