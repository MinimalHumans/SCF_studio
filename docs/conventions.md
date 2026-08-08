# SCF conventions

What the format means, and why. The registry says which fields exist;
this says how to read them. Where a rule is machine-checkable it is
pinned by a conformance test, and the test is named here so the two
cannot drift apart silently.

This is not the spec. A spec is a commitment to outside consumers and
the format is still moving. This is the document that stops the reasons
being lost — every rule below was a decision with a rejected
alternative, and several were learned by breaking something.

---

## 1. What SCF is

A description of a film's intent, dense enough that a human or a machine
can answer a specific question about a specific moment: what does this
character sound like in this scene, what is in force here, what is this
shot for.

**SCF describes; it does not enforce.** There are almost no constraints
in the schema beyond required fields and foreign key columns. Everything
else — duplicates, contradictions, gaps — is reported by the readiness
layer as a *finding*, never rejected on write. A half-entered project is
a normal state of work, not an error, and a format that refuses
incomplete data is a format nobody finishes filling in.

Consequence for consumers: never assume a row is well-formed because it
exists. Every resolver in `scf-core` stays total — it returns a sane
answer for missing, dangling, and contradictory data, and reports the
problem separately.

---

## 2. Derived versus stored

**The rule: if a value can be computed from another, compute it.**

A stored copy of a derivable fact is a second truth, and the moment the
original changes the copy is a lie that nothing detects. This has been
the source of more bugs in this project than anything else.

Applied:

- A **scene's label** is `sc {scene_number} — {name}`, built at render
  time. Not stored: renaming a scene would strand every copy.
- A **link row's label** is composed from the rows it points at. Where a
  link entity declares its `nameField` `hidden: true` — twelve of
  thirteen do — that column is not a name and must never be displayed.
  The importer parks cue text there; showing it made a character's whole
  scene list read as that character's own name.
- **Act and sequence membership** is derived from a boundary (§4).
- **Story order** is derived from `scene_number`, never from row id.

**The one deliberate exception is `shot.shot_number`**, which IS stored
and IS authored. A shot number is not a display label: it is an
identifier issued to a crew. Once a shot list goes out, 42A stays 42A
even if the scene renumbers, because paperwork exists on paper.
Consumers must not rewrite it. The app shows the derived code beside an
authored one when they disagree, so a list can be reissued deliberately.

The distinction that resolves the apparent contradiction: **a shot moved
to a different scene IS renumbered.** The rule protects the number
against the scene renumbering; it does not protect a number that names
the wrong scene.

### Derived-but-stored: a known fragility

`screenplay_lines.scene_id` is threaded onto body lines at commit — it
is derived state that happens to be stored. It is absent for lines typed
since the last commit and for projects written before the threading
existed. **Do not key anything important off it.** To read a scene's
text, find the heading line linked to that scene and take everything up
to the next heading; commit enforces one scene per heading, and
"slugline to slugline" is what a scene means anyway.

Pinned by: `scf-app/test/sceneScript.test.ts` (nulls every body line's
`scene_id` and asserts identical output).

---

## 3. Position and persistence

Everything positional is keyed to a **scene**, and scenes are ordered by
`scene_number` with unnumbered scenes last, then by id. That ordering is
the spine every other rule stands on.

Three patterns, distinguished by `positionPattern` on the entity:

**Pattern 1 — explicit rows.** A row per scene, no inference.
`costume_scene`, `scene_prop`. What is in force is what is written.

**Pattern 2 — persistence.** A state row is keyed at a scene and carries
`persistence`:
- `scene_only` — in force at its own scene and nowhere else.
- `until_resolved` — in force from its scene forward, until
  `resolved_at_scene_id` (exclusive), or to the end.

An injury taken at sc 9 is still in force at sc 12; hoarseness from the
same scene is not. Modulations from multiple states merge oldest-first,
so a later state overrides an earlier one field by field.

Pinned by: `conformance.canonical.test.ts` → "persistence rule".

**Pattern 3 — latest wins.** A state row per scene where the value
changed; the answer at any position is the most recent row at or before
it. `relationship_state`, `prop_state`, `motif_state`. There is no
"until" — the next row supersedes.

Pinned by: `conformance.canonical.test.ts` → "pattern 3 (latest-wins)".

---

## 4. Structure: spans anchored at their start

An act **begins** at a scene and runs until the next act begins. A
sequence likewise. `act.start_scene_id` and `sequence.start_scene_id`
are the only stored facts; membership is derived.

Why the start alone, rather than a start/end pair or a row per scene:

- Overlaps and gaps become impossible to express. Nothing to validate.
- A scene inserted mid-act joins it with no write at all.
- No end anchor to drift out of sync when scenes move.
- "Scenes 32–54 are Act II" is two placements, not 23 rows.

The cost, accepted deliberately: **spans must be contiguous.** A
cross-cut sequence interleaved with another cannot be expressed. If that
requirement arrives, enumerated membership is the only model that
supports it, and this one must be replaced rather than patched.

Acts and sequences are **independent spans, not a hierarchy**. A scene
can be in an act with no sequence — the whole point of the change, since
membership used to be reachable only through `scene_sequence` — and a
sequence may begin in one act and end in another. That is legal and
deliberately unrestricted: a montage or a cross-cut can bridge an act
break, and forbidding it would buy tidiness at the cost of a real
structure.

The consequence is for renderers, not for the data. Anything drawing
acts and sequences as nested must group an act's scenes into **runs** of
sequence (`actOutline()`), so a crossing sequence appears in each act as
the part of it that belongs there. Grouping instead by "sequences whose
start falls in this act" draws the crossing sequence's later scenes
under the wrong act and again under the right one — which is exactly
what both outlines did until it was caught.

`scene_sequence` rows are still materialized at commit so existing
queries keep working. The boundary is the truth; those rows are its
shadow, and may be stale between commits. Rows that no boundary explains
are counted and reported, never deleted.

Half-placed structure is normal: an act with no boundary, a boundary on
a deleted scene, two acts on one scene, scenes before the first act.
Each produces a sane structure and a finding.

Pinned by: `scf-core/test/structure.test.ts`.

---

## 5. Identity

**Rows** carry a `uuid` (schema 2.3), unique per table, backfilled on
open. This is what survives export, re-import, and being read by another
tool. Row ids are local to a file and mean nothing outside it.

**Junctions carry row identity too.** `uuid` is a framework column on
all 99 entities, junctions included — an earlier note in this document
claiming otherwise was wrong. What a uuid answers is the *lineage*
question: is this the same row as before, across export, re-import and
versioning.

It does not answer the other one. A uuid is minted per file, so two
people describing the same production mint different ones for the same
link. Across files a junction is identified by its **natural key** — the
rows it joins, plus the polymorphic target where it has one, plus
`domain` where present, since a motif may legitimately appear in one
scene both visually and sonically. `junctionKeyFields()` in
`scf-core/src/junctions.ts` states that key for all thirteen link
entities so that merging, de-duplicating and validating agree on it.

Nothing in the schema stops two rows sharing a natural key. The commit
path de-duplicates in code; anything added by hand is unchecked. Two
rows for one link split its authored content — a role, a usage note — and
a reader taking the first finds half of it. Reported by
`duplicateJunctions()`, and reported more loudly when the duplicates
disagree, since identical duplicates are only clutter.

**Relationship pairs** are the case where that bites. `character_
relationship` has no constraint on its two character columns and no
convention about which character goes first, so the same pair can be
entered twice, or once from each end, splitting its `relationship_state`
history across two rows that a latest-wins lookup cannot reconcile.

Schema 2.4 adds `directionality` (`mutual` | `a_to_b`) because the
missing fact is **symmetry**: without it nothing can distinguish one
relationship entered twice from two legitimate directed facts. A mutual
pair is unordered; a directed pair reads A → B.

Consumers must read relationships from **both** columns —
`relationshipsFor()` in `scf-core/src/relationships.ts` — and must not
assume a character sits in `character_a_id`.

Duplicates are findings, not constraints. A unique index could not
decide whether a reversed directed pair is a duplicate, and several
relationships between the same two people are legitimate.

Pinned by: `scf-core/test/relationships.test.ts`,
`scf-core/test/junctions.test.ts`.

### Soft-retiring: links inherit their endpoints' lifecycle

Two of the thirteen link entities carry `lifecycle_status` —
`actor_character_role` and `thematic_connection` — and that asymmetry is
deliberate rather than an omission.

A link is a statement that a connection exists. If the connection stops
existing, the row is wrong, not retired: delete it. And when an endpoint
goes, the link goes with it — mark a scene or a prop `cut` and every
link to it is cut by implication, without eleven more columns saying so
again. Adding the field everywhere would put a value on every junction
that nothing sets and nothing reads.

The two exceptions are the links where the row is itself a **claim**
rather than a connection. An actor was really attached to a part before
being recast, and dailies exist. A reading of a theme was really held
before being revised. Those are worth keeping and marking, not deleting.

Test for whether a future link should carry it: *would you want to know
this used to be true?* If yes it is a claim; if the answer is only "it
is not true now", it is a connection, and deleting it loses nothing.

Note that `lifecycle_status` is **authored but unread**: no resolver in
`scf-core` filters on it. A consumer that wants to exclude cut rows must
do so itself. See §9.

---

## 6. The direction cascade

Look and sound resolve **root-first, most specific last**: project →
sequence → scene → shot. The last layer wins, and every layer is
returned so a consumer can see where a value came from rather than only
what it resolved to.

Pinned by: `conformance.canonical.test.ts` → Q07, Q08, Q11.

---

## 7. Proposals from a screenplay

Anything extracted from a script is a **proposal**, not a fact. The
import flow stages proposals for review; only `high` confidence is
accepted by best-guess, and **props never reach `high`** — a prop is
only ever created by a human ticking a box.

The lesson worth keeping from the prop extractor: **capitalization is
not a signal.** Mid-line caps in a screenplay mean "production, take
note" — writers cap character introductions, sound cues, and
camera-worthy actions as readily as objects. Extraction keys on syntax
instead (a noun phrase after a determiner; the object of a handling
verb), filters by the head word against category lexicons, and scores.
Precision over recall, and the UI says so.

Fountain **sections** (`# ACT II`) become acts and sequences at commit
on the same terms as headings becoming scenes: the author typed it, so
creating what they named is the feature. The section's line metadata
carries `structureRef {kind, id}` so renaming a section renames its
entity instead of creating a second one.

Section **text is read before depth**: a line saying ACT is an act at
any depth. `#` = act / `##` = sequence is only the fallback, because
plenty of writers use a single `#` for sequences and never write an act
line.

---

## 8. Changing the format

1. Edit `schema/entity_registry.py`. It is the source of truth.
2. Regenerate: `python schema/generate_registry_json.py`.
3. Lint: `python schema/lint_registry.py`.
4. If the change is not purely cosmetic, bump `SCHEMA_VERSION` in
   `schema/schema_meta.py` and record it in `docs/schema-changelog.md`
   **in the same commit**.
5. Migrate `fixtures/hollow_creek.scf` if a conformance test compares
   its column set. User files need no migration: `initDatabase`
   ALTER-adds any registry column a file lacks, on open.

Prefer **additive optional fields**. Every schema change so far has been
one, which is why no file has ever needed converting.

### The fixture is part of the contract

`fixtures/hollow_creek.scf` is not sample data. Its content is asserted
by the conformance suites, and several of its properties are load-bearing:

- **Scene numbers have gaps** (1, 3, 7, 9, …). Suites address scenes by
  number; renumbering breaks every lookup.
- **Scene 12 is the pinned scene** — its motif manifest, its single
  sound cue, its costume set and its direction chains are asserted
  exactly. Add nothing to it.
- **Marcus's vocal profile is deliberately thin** and his voice bundle
  deliberately absent: the readiness suite asserts Q05 warns about
  exactly those gaps. An authored absence is part of what the fixture
  demonstrates.
- **Shot 12-04 keeps a production numbering scheme** that the app's
  derived code disagrees with, demonstrating that an authored number
  survives.
- A theme carried by both leads lights every scene, so **a second,
  narrowly carried theme** exists to demonstrate Q10's gap reporting.

Rebuild scripts live in `fixtures/build/`.

---

## 9. Open questions

Each is marked **schema** (the format has to change), **editor** (only
this application), or **both**.

- **Filtering on `lifecycle_status`.** *(both)* Every non-link entity
  carries it, nothing in `scf-core` reads it, and the fixture has no
  non-active row — so "cut" is currently decorative. Deciding it means
  answering whether resolvers should exclude cut rows by default, which
  would change the answer to every canonical query, and whether a
  consumer can still ask for history. Until then, treat a `cut` row as
  present unless you filter it yourself.
- **Locking, beyond numbering.** *(editor)* The numbering half is built
  — see Resolved. What is not: revision colours, A-pages, locked page
  breaks, and a stored record of codes that once existed so a reissued
  shot list cannot reuse a retired one. `nextShotNumber` continues from
  the highest code rather than backfilling, but the database keeps no
  memory of deleted codes, so deleting the last shot in a scene frees its
  code again. A production that needs the stronger promise wants a stored
  counter.
- **Merging two files.** *(editor, later)* The live use for junction
  natural keys (§5), and the point at which uuids stop being enough.
  Matching links requires resolving their endpoints first, which is a
  merge algorithm. It belongs with multi-user work, not before.
- **A real spec.** *(both)* When the format stabilizes: registry, this
  document, the fixture, and the canonical query expectations as data
  rather than as test code, so a third consumer costs an afternoon
  instead of a port.

### Resolved

- **Junction identity** *(schema)* — junctions already carry `uuid`;
  what they lacked was a stated natural key, now in
  `scf-core/src/junctions.ts`. §5.
- **Soft-retiring a link** *(schema)* — deliberate: links inherit their
  endpoints' lifecycle, except the two that are claims rather than
  connections. §5.
- **Sequences crossing act boundaries** *(editor)* — legal and
  unrestricted. The renderers were the thing that had to change. §4.
- **Scene order, and the numbering half of locking** *(both, schema 2.5)*
  — two answers that turned out to be one.

  Story order comes from the SCREENPLAY when one exists: the `line_order`
  of the heading carrying each scene. `scene_number` is a LABEL for that
  position, not the position itself. Ordering by it alone was wrong in
  both directions — a blank-written project has no numbers at all, so
  order collapsed to insertion order and a scene added mid-act sorted to
  the end of the film; and a scene moved since the last commit carries a
  number that no longer matches the page. `scenePositions` and
  `sceneOrderHint` in `scf-core/src/structure.ts` are the derivation;
  `SCENE_ORDER_JOIN` / `SCENE_ORDER_BY` are its SQL twin, for callers
  that list scenes straight from a query. **A consumer that sorts scenes
  by `scene_number` alone will be wrong about both cases.**

  `project.scene_numbering` (`derived` | `fixed`, default `derived`) is
  the gate, and it sits exactly where this section predicted: the
  renumber block in `commitStructure`. `derived` recomputes scene numbers
  from the script's order at every commit and clears them for scenes with
  no heading. `fixed` never touches them — which an import needs, because
  a production's own numbering may be gapped or out of sequence and is
  data, not a derivation. Imports of numbered scripts set it.

  Shot codes are under the same flag. `shots.ts` says a shot number is
  never rewritten because `42A` is issued to a crew — but that was
  written as though the script were always locked, and nobody holds paper
  on an unlocked one. `42A` in a scene now numbered 43 is stale, not
  stable. So `derived` restamps the prefix and keeps the letter, and
  `fixed` freezes scene numbers and shot codes together, which is the
  state a distributed shot list needs.

  Act and sequence numbers are NOT gated: they are structural labels the
  app has always owned, and no crew holds paper on one. `renumberSpans`
  is shared by the script commit and the Structure tab, which both move
  boundaries.
- **A scene cut from the screenplay** *(editor)* — derived and badged,
  never written. The entity survives by design; what it loses is a
  position, so it has no number and belongs to no act. `orphanedScenes`
  reports it and the rail badges it. Nothing stamps `status = 'cut'`,
  because `status` is authored (outline / draft / revised / locked / cut)
  and overwriting it on a commit would destroy what the author put there
  with nowhere to remember it for the trip back. Marking a scene cut
  stays the author's own act. This is deliberately NOT an answer to the
  `lifecycle_status` question above, which is still open.
