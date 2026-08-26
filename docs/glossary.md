<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Glossary

Plain-language definitions of the terms SCF uses. **This is not the
normative glossary** — that is [§0.7 of the specification][spec], which
says what each term means *for an implementation*. This one says what
each term means, in the sense a person reading about the format would
want.

Where the two differ, §0.7 is right and this is a paraphrase.

[spec]: ../spec/scf-spec.md

---

## The shape of a file

**SCF** — Story Context Framework. The format this project defines. It
describes what is true of a film: its scenes, the people in them, what
they look and sound like, what is in force at any given point.

**`.scf` file** — one film, in one file. It is a SQLite database, which
means any language with a SQLite driver can read it without a parser and
without this project's code. One file is the whole unit: you send it, you
open it, and everything needed to answer a question about the story is
inside.

**Entity** — one kind of thing the format knows about, and the table that
holds it. `character` is an entity. `scene` is an entity. There are 99 of
them, listed in the [entity reference](../spec/entity-reference.md).

**Registry** — the single declaration of all 99 entities and their
fields. Everything else — the database schema, the JSON Schema, the
documentation — is generated from it, so there is one place where the
field set is decided and no second place to disagree with it.

**Link entity**, or **junction** — a row whose whole job is to connect
two other rows. "This character is in this scene" is a link. Thirteen of
the 99 entities are links.

**Tier** — a rough depth band from 0 to 6, grouping entities by how far
they sit from the basic nouns. `scene` is tier 0; `emotional architecture`
is tier 5. It is a navigation aid and nothing in the format depends on it.

---

## Where things sit in the story

**Story order** — the order scenes actually happen in, derived from the
screenplay rather than from scene numbers. This distinction does more
work than any other in the format: see *scene number* below.

**Scene number** — the *label* on a scene: `12`, `12A`, `47`. It is what
a crew calls the scene, not where the scene sits. Numbers are assigned
once and then deliberately not renumbered, because a shooting schedule, a
call sheet and a hundred paper documents already say `12A`. So scene 17
can come after scene 24 in story order, and in the conformance fixture it
does.

**Position** — a scene's place in story order. When something is "at a
position", it means "at that scene, as the story runs".

**In force** — what is true at a given point. A character has a state
that begins somewhere and holds until something changes it, so asking
"what is her voice like in scene 12" means finding the state in force
there. Different kinds of thing decide this differently; the format calls
those *position patterns*.

**Position pattern** — the rule for deciding which of several rows
applies at a given scene. There are three that do anything: one row per
scene (*explicit*); a row that holds from its scene onward until
something resolves it (*persistence*); and the most recent row at or
before this point wins (*latest wins*).

**Span** — an act or a sequence, defined by where it *starts* rather than
by a list of member scenes. Insert a scene in the middle and it joins the
act automatically, because membership is worked out rather than stored.

---

## Direction and detail

**Cascade** — how the format answers "what should this look like" when
several layers have an opinion. A project has a visual philosophy, a
location has a treatment, a scene has a palette, a shot has an override.
The cascade reads them broadest-first and lets the most specific one win,
and it *shows you the chain* rather than just the answer, so you can see
where a decision came from.

**Refines** — the declaration that one entity adds detail to another. It
is what defines the cascade: `shot_design` refines `scene_color_palette`,
so the shot's opinion sits closer to the answer.

**Subject** — the thing a row is *about*. A costume row's subject is a
character. Used to gather everything about one person into one answer.

---

## Assets

**Asset** — a file the film needs: a reference image, a voice sample, a
lookdev turntable. SCF stores the *address* of a file, never its bytes.

**Identifier** — an asset's stored address, written to survive being
moved between machines: `@project/ref/eleanor/voice_01.wav`.

**Root** — the `@name` at the front of an identifier. It stands for a
folder that the machine reading the file supplies. Two studios can open
the same `.scf` with entirely different storage and both resolve the
same assets, because the file never hard-codes a path.

A project may use **several roots** — `@project` for its own content,
and others such as `@plates` or `@nas` for material on separate volumes.
Each is mapped independently by whoever opens the file, so a project
spread across drives is still portable.

**Absolute path** — an address that names a location directly, like
`/Volumes/plates/sh010.exr`, rather than through a root. **Permitted**,
and represented deliberately: it resolves to `out-of-root` and raises a
warning saying it will not travel. That is a statement about
portability, not a defect. A path containing `..` is a different case
and is an error, because where it lands depends on where its root sits.

**Resolver** — whatever turns an identifier into actual bytes. Not part
of the file; part of the environment reading it.

**Resolution state** — what happened when a resolver looked: the file is
there (`resolved`), it is missing, it is a cloud placeholder not yet
downloaded (`unmaterialised`), the address points outside the root
(`out-of-root`), or nobody supplied a root at all (`unaddressed`). The
last one matters: "I did not look" is not the same as "it is not there".

---

## Reading a file

**Query** — one of the sixteen questions SCF is built to answer, listed
in the [query reference](../spec/query-reference.md). They are part of
the format rather than a feature of any tool, which means two different
programs asked the same question return the same answer.

**Projected row** — how a row looks inside an answer. It carries the
row's uuid and its authored values, and deliberately drops anything that
is local to one file — internal ids, timestamps — so an answer describes
the story rather than the file it came out of.

**Derived** — computed when you ask, never written down. Story order is
derived. Act membership is derived. The rule is that anything derivable
gets derived, because a stored copy of a computed fact eventually
disagrees with the thing it was computed from.

**Finding** — a report that something in the data is incomplete or
contradictory, produced *alongside* a usable answer rather than instead
of one. A film in progress is missing most of itself most of the time,
so a format that refused to answer until everything was filled in would
be useless exactly when it is needed.

**Cut** — marked as not in the film. A cut row disappears from every
answer but is still there in the file, so a decision can be reversed
without the record of it being lost.

---

## Identity and change

**uuid** — the identity a row carries wherever it goes. Stable across
edits, exports and rebuilds.

**Row id** — the database's own internal number for a row. It is local
to one file and means nothing outside it, which is why it never appears
in an answer.

**Schema version** — which version of the 99-entity structure a file
uses, stamped in the file. Currently 2.12.

**Specification version** — which revision of the written specification
you are reading. Currently 0.42, and on a separate track from the schema.

**Conformance** — whether an implementation does what the specification
says. There are three roles — Reader, Writer, Editor — and a claim is
made by running the published tests and disclosing anything that differs.

**Fixture** — Hollow Creek: a small, complete, deliberately imperfect
film used to test implementations against. Every published answer is an
answer about it.

---

## Documents

**Normative** — binding. If an implementation disagrees with a normative
document, the implementation is wrong. `spec/scf-spec.md`,
`conformance.md`, `stability.md` and the published artifacts are
normative.

**Informative** — explanatory. This glossary is informative. So is the
[design record](conventions.md), which explains *why* the format is as
it is and deliberately states no rules — a rule found only there would
be a defect.

**Artifact** — a published file that implementations are checked
against: the schema, the registry, the sixteen query results, the
eleven negative reports. All are generated from source and verified by
their checksums, so a third party can confirm they have the same bytes
the project published.
