# SCF specification changelog

Changes to [`scf-spec.md`](scf-spec.md). Governed by its §11.5:

- **patch** — editorial only. No requirement changes meaning.
- **minor** — any MUST or MUST NOT added, removed, or changed in meaning.
- **major** — a change that would make a conforming implementation
  non-conforming.

This tracks the **specification**, not the schema. Schema versions live
in [`../docs/schema-changelog.md`](../docs/schema-changelog.md), and the
two move independently by design (spec §0.6).

Every entry names the schema version the specification described at the
time, so that a reader of an old spec knows what it was describing.

---

## 0.27 — 2026-08-18

*Describes schema 2.12.*

**§12.12 Q00, §12.13 Q11, §12.14 Q15.** Thirteen of sixteen specified,
twenty-two artifacts published.

**The nesting decision is withdrawn, and §12.1.3 says why.** It was
recorded on the premise that the six remaining queries were composites
that build on other queries' results. They are not: **no canonical query
calls another.** What look like composites assemble their own answers
from the same resolvers, and Q01 and Q02 share a helper rather than a
result. Nesting whole results would have invented a relationship the
implementation does not have.

Each query therefore defines its own result shape, and where two share a
composition the shared part is one function in one place. Nesting
remains available if a query is ever built by calling another.

**Q00 is the only query with an empty envelope**, which is worth having
tested: the envelope has to survive having nothing to put in it. Its
layer list is fixed by §12.12 rather than derived, because what belongs
in a brief is an editorial choice and not a fact the registry knows.

**§12.13 states that every part of an audience state may be absent**,
and that absence is null or empty and never invented. It also requires
that a file lacking one of these tables yields nothing for it rather
than failing — an older file predating an entity is not an error.

**§12.14 specifies the permissive matching** Q15 needs.
`affected_entities` is free-form and may hold a JSON array, an object,
or prose, so the accepted conventions are now written down:
`entity:id`, `entity#id`, a bare `entity`, and an object carrying an
entity kind with an optional id. `mentionsRow` moved from the app into
`scf-core` with it — Q15 is normative, so its matcher is too, and while
it lived in the app no independent implementation could know which
conventions counted.

§12.14 also requires the version-chain walk to terminate on a cycle
rather than follow it: a cycle is a finding, not a reason to hang.

## 0.26 — 2026-08-18

*Describes schema 2.12.*

Fixes 5, 6 and 7 of the second audit's list. All three were the same
failure as the four before them — **a normative fact that lived only in
code** — and all three are fixed the same way, which is now the third
time this move has been needed.

**§6.3's junction natural keys are published** as
`spec/junction-keys.json`. The section cited `junctionKeyFields()`, a
function, so an independent implementation could not compute a natural
key and therefore could not de-duplicate, merge or validate a junction
as §6.3 requires. Thirteen entities, with the derivation recorded in the
file.

**§5.4's finding now has a code.** It required unexplained
`scene_sequence` rows to be reported as a finding while §9.4's catalog —
closed — had no code for it, so the two sections could not both be
obeyed. `structure.shadow_row_unexplained` is added at `warning`, and
`collectFindings` detects them: the detection previously existed only
inside the editor's commit path as a count on a result object, which
means `scf-check`, the one tool a third party actually runs, never
mentioned them.

**§12.9.1 publishes Q14's rubric** as `spec/readiness-rubrics.json`,
with the requirement-to-severity mapping that turns it into findings.
§12.9 had defined the envelope and the severity scale and nothing about
what was assessed, so the second reader implemented an invented rubric
and correctly declined to claim anything for it.

**And an overclaim caught while publishing it.** The rubric's steps were
emitted under a field called `entity`, which asserts they resolve
against the registry. They do not: several are prose — `sound_cue /
music_cue`, `bundle + *_asset_binding`, `performance_state (vocal)` —
naming two entities, a pattern, or a filtered subset. The field is now
`label`, the file says which half is machine-readable, and §12.9.1 says
so too. Making the labels resolve is tracked as Unstable rather than
quietly implied to be done.

## 0.25 — 2026-08-18

*Describes schema 2.12.*

The first revision written in response to the **second** independent
implementation. It reproduced five of ten queries exactly, attempted a
conformance claim, and found that what was failing was no longer the
specification but its own artifacts.

**A blessed artifact named the wrong asset.** `Q13.result.json`'s anchor
reference carried the uuid of `eleanor_turnaround_v3.png`; the anchor
points at `eleanor_face_ref.png`, which appeared nowhere in the result.
The cause was a row id looked up in the wrong table — an `entity_anchor`
row's id resolved against `asset`. It produced a well-formed uuid, so
every portability test passed.

The fix is at the source rather than at the projection. §12.8 now states
that **an anchor contributes the asset it anchors, not itself**: an
`entity_anchor` names a place in an asset and carries no identifier of
its own, so reporting the anchor row would produce a reference that can
never resolve. The reference carries the asset's identity, with the
anchor's name in `anchorName`. `mediaReferences` no longer needs any
cross-table lookup, which removes the class of defect rather than this
instance of it.

§12.8 also states that **`trail` and `references` run in opposite
directions** — the trail broadest-first as an explanation, matching
§7.4, the references most-specific-first as an answer. The previous text
claimed both were most-specific-first, which was wrong about the trail.

**Reference maps MUST be derived from the registry.** §12.1.2 now says
so. Three results dropped a reference column §12.1.2 required, because
the implementation maintained a hand-written map per query — the exact
antipattern §2.3 warns against, inside the module implementing §12.1.2.
`scene.location_id` was projected in one result and silently dropped in
another; two reference columns on one motif row were treated
differently.

**`conformance.md` contradicted this specification** and has been
corrected. Its Reader requirements told an implementer to "treat a `cut`
row as present, pending §6.6" — §6.6.1 forbids exactly that, so the
document an implementer reads to learn what is required would have sent
a careful one to a wrong answer on every query. Its step 2 also still
named two specified queries when there are ten.

**`spec/scf-schema.sql` could not be executed as published.** It carried
`CREATE TABLE sqlite_sequence(name,seq)`, which SQLite rejects; the
emitter dumped `sqlite_master` without excluding SQLite's own tables. A
third party who did not know to strip it failed at the first negative
fixture. The emitter now excludes `sqlite_%`, and the published DDL
loads into an empty database unmodified.

## 0.24 — 2026-08-17

*Describes schema 2.12.*

**§12.10 Q09 and §12.11 Q10.** Ten of sixteen specified, seventeen
artifacts published.

**Q10 is the first query whose answer spans the whole story** rather
than a position, and it needed nothing new from the envelope — which is
the useful result. §12.11 states the rule that makes it worth having:
**the spine MUST include every scene, carriers or not.** A spine listing
only the scenes a theme reaches could not answer the question the query
exists for, which is where the theme is absent.

The spine is in story order and excludes cut scenes, and a carrier
reaching a cut scene reaches nowhere — so its scene list and the spine's
counts agree rather than disagreeing at one position.

**Q09 states its own heuristic.** `dense` is a flag, not a finding
(§9.1), and a result MUST publish the `densityThreshold` that produced
it so a consumer can see the number rather than infer it from a count. A
different implementation MAY choose a different threshold and MUST say
which. §12.10 also says a `candidate` is not an obligation: it is a
related motif absent from this scene, offered because a placement
decision is easier when you can see what is adjacent.

**A correction.** 0.23's notes claimed the specified queries were
"every query taking a position", and that the remaining eight enumerated
the project instead. That was wrong: Q02, Q04, Q09 and Q11 all take a
scene. The claim is removed from `conformance.md` and `stability.md`.
What the six remaining actually have in common is that they **compose
other queries** — a brief, a dossier, a scene package — so specifying
them means deciding whether a composite result nests the results it is
built from or restates them.

## 0.23 — 2026-08-17

*Describes schema 2.12.*

**Four more queries: §12.6 Q06, §12.7 Q08, §12.8 Q13, §12.9 Q14.** Eight
of sixteen are now specified, and fifteen artifacts are published.

**Q06 and Q08 cost almost nothing**, which was the point of taking them
next. Q06 is Q05 with a different modality and Q08 is Q07 with a fixed
leaf, so both became parameters of the existing builders rather than new
ones — one definition each, not two. §12.7 states that Q08 takes no
shot: sound is authored at the scene and there is no shot-level sound
entity to be a leaf, so `shot` is always null rather than an omission an
implementer discovers by finding nothing.

**Q13 dissolves the row-id defect.** The rendered form puts
`character #1` in its header and carries `AssetReference.id` through;
neither travels (§6.2). The result names its subject and every asset by
uuid.

§12.8 also states what `rootMapped` is for: it is a fact about the
SESSION, not the file. With no root mapping every reference is
`unaddressed` — not `out-of-root`, which is a property of an identifier
— so a result reporting zero resolved references and `rootMapped: false`
describes a healthy file nobody has pointed at a folder.

**Q14 needed a warning written into the specification, because I got it
wrong first.** `findings` includes `ok` entries: Q14 is a rubric, not a
problem list. The fixture's deliberately thin character produces FEWER
findings than the well-authored one, because fewer things are there to
be reported on at all. **Severity carries the answer**, and §12.9 says
so. It also restates that readiness severity is its own scale and must
not be conflated with §9.4's.

**§12.1.1 is refined.** It said every parameter is a uuid or null, which
was wrong as soon as a query took a literal: Q14's `target` is a query
id and Q13's `intent` is an enum value. It now says a parameter
identifying a ROW is its uuid, a literal appears as itself, and **a row
id MUST NOT appear** — so no parameter is a bare number, which is the
rule that actually matters and is what the portability test asserts.

## 0.22 — 2026-08-17

*Describes schema 2.12.*

**§12.4 Q03 and §12.5 Q12 are specified**, and blessed **away from scene
12**. Four of sixteen queries now have normative results.

The previous session found a live conformance bug — `sceneOrder`
deriving story order from `scene_number`, which §4.1 forbids — and the
uncomfortable part was that the whole suite passed before and after the
fix. Every blessed expectation targeted scene 12, where the forbidden
ordering and the required one agree.

So these two were blessed at positions where they do not:

- **Q03 at scene 19**, which sits before 16 in the script and after it by
  number.
- **Q12 diffing 19 → 16**, which is forward in the script and backward
  by number. §12.5 states the rule this pins: the two positions are
  ordered by §4.1, never by their scene numbers, because under `fixed`
  numbering a scene numbered 16 may play after one numbered 19 — and
  diffing them by number resolves every pattern-2 and pattern-3 state at
  the wrong position.

**Verified rather than assumed.** Reintroducing the old ordering makes
**four** tests fail, including a blessed expectation. Before this
session it made none.

§12.4 also states what a cut position answers: `scene` null and nothing
present, rather than an error (§9.2) — the query-layer face of §6.6.1.

**Q03 and Q12's composition moved into `scf-core`.** Q05 and Q07 could
wrap resolvers that already lived there; these two composed in the app's
runner, so a normative result would have had to re-derive "who is
present and what is true of them" a second time. The core now composes
rows, the runner renders them, and the result projects them — one
derivation, two consumers.

`ARTIFACTS.md` carries eleven artifacts.

## 0.21 — 2026-08-17

*Describes schema 2.12.*

**§6.6 is decided: a cut row is not in the film.** It was the oldest
open question in the document — `lifecycle_status` was authored on 88
entities and read by nothing, so "cut" was decorative and every consumer
would have answered the canonical queries differently.

New **§6.6.1**: a resolver MUST exclude cut rows, and the consequences
are stated rather than left to be inferred — a cut scene has no story
position, takes part in no span, and appears in no query result; a cut
state is in force nowhere; a cut row contributes no cascade layer.

A cut scene MAY keep its heading in the screenplay, because a cut scene
in a real script is struck through rather than deleted. An
implementation that rebuilt story order from headings alone would
resurrect it, and MUST NOT.

The section states the property that makes the rule testable: **adding a
cut row changes no answer.** The fixture now carries a cut scene *with a
heading*, and a cut performance beat inside the most heavily asserted
scene in the file.

New **§6.6.2**: excluding cut rows from resolution is not hiding them.
An implementation MAY read them back for a cut list or an audit view,
and SHOULD keep that path distinct from the resolvers. Identity survives
being cut — restoring a row restores the same row.

**§12.1.2** follows: a result MUST NOT contain a cut row.

**A live conformance bug, found by the rebuilt fixture.**
`resolution.sceneOrder` — the function every position-dependent answer
runs through — ordered scenes by `scene_number` and then by row id,
which §4.1 forbids in as many words, and its own doc comment said so.
Nothing caught it for as long as it existed because the fixture's three
orders coincided; the moment they differed it disagreed with the
specification on its first run. It now delegates to `scenePositions`,
and a test asserts the two agree.

That is the fixture rebuild paying for itself, and worth noting: the
entire suite passed both before and after the fix, because the blessed
expectations cluster on one scene.

## 0.20 — 2026-08-17

*Describes schema 2.12.*

**§12 exists.** The canonical queries were decided to be part of the
format and then defined nowhere; this is the first instalment.

**§12.1 defines what any query returns.** An envelope naming the query,
its own result-format version, the schema read, and the parameters —
each a uuid. Then §12.1.2, the rule that makes a result portable:

- row ids MUST NOT appear;
- `id`, `created_at`, `updated_at` are omitted;
- null and empty fields are omitted, so absence is unambiguous;
- reference columns are resolved to uuids — `scene_id` becomes
  `scene_uuid`;
- field names are the registry's own.

And the sentence the section turns on: **the normative answer is the
result structure. Any rendering of it is a convenience and is not
normative.** Two implementations that agree on the result and print it
differently are both conforming.

**§12.2 Q05** — baseline, states in force by pattern 2, merged
modulations, beats. A null baseline is stated as a well-defined absence
rather than an error.

**§12.3 Q07** — the cascade, with §12.3.1 stating that the leaf depends
on the PARAMETERS: `scene_color_palette` for a scene,
`shot_design` when a shot is named. That is what §7.1 means by the leaf
not being derivable from the data, said in the place an implementer will
look for it.

Q05 and Q07 were chosen because they stress different machinery. One
envelope and one projection rule served both, which is the evidence that
the shape is worth extending to the other fourteen.

`fixtures/expectations/Q05.result.json` and `Q07.result.json` are
blessed and published in `ARTIFACTS.md` — nine artifacts now.

**Still unspecified: fourteen queries**, and whether a result excludes
`cut` rows, which waits on §6.6.

---

## 0.19 — 2026-08-17

*Describes schema 2.12.*

**New §11.0: these rules take effect at 1.0.** §11.1 read as binding
today while §11.4 carried a note saying pre-1.0 removals were
permissible — the document contradicted how the format is actually being
built. It now says plainly that before 1.0 files written by earlier
schema versions are disposable, with `fixtures/hollow_creek.scf` the one
exception because it is a normative artifact.

The clause also says *why*, since "we may break things" reads worse than
it is: before 1.0 nobody has built on the format, so a deprecation
window protects nothing and leaves the format carrying two descriptions
of one fact. After 1.0 someone has.

**§4.3.1 is deleted, and schema 2.12 removes
`project.scene_numbering`.** The rename to `numbering_policy` shipped in
2.11 through §11.4's window: both columns present, writers mirroring into
the old one, removal scheduled. Under §11.0 that window protected only
pre-2.11 files, which are disposable — so it bought nothing and cost the
one place the format deliberately stored a fact twice. The window is
gone along with the column and the mirroring.

The deprecation machinery stays specified in §11.4. It becomes live at
1.0, when it earns its cost.

**§8.3's resolution states are corrected, and the implementation with
them.** The spec and the code had disagreed since the states were
written, and the audit flagged it as a wire-value conflict blocking any
external consumer.

The code reported an **unmapped root** as `out-of-root`. It is
`unaddressed` — §8.3 and §0.3 both said so, and §0.3 states outright
that a `.scf` opened with no root mapping is valid and resolves
everything to `unaddressed`.

`out-of-root` now means only what its name says: the identifier points
outside the project **by construction** — absolute, or containing `..`.
It is a property of the identifier and does not depend on the session.
`unaddressed` is a property of the session and says nothing about the
identifier. §8.3 gains a table of what each state means and what a user
does about it, because reporting an unmapped root as out-of-root told
people their paths were wrong when the truth was that no folder was
attached — and made every asset in a lone `.scf` look broken.

The two ways to be `unaddressed` — no identifier at all, or no mapping
for its root — are distinguished by findings rather than by state:
`asset.identifier_absent` covers the first.

The blessed Q13 moves with it, and one of its summary lines was wrong in
a way worth naming: it read `3 with no identifier` for three assets of
which two had identifiers. It now reads `3 unresolvable`.

**§0.2 now lists the query layer as §12**, and states that §12 is not
yet written: the queries are part of the format, the normative answer is
the result structure rather than any rendering, and until the section
exists the only definition of a canonical query is one blessed example
of its output. That is named as the largest known gap in the document.

---

## 0.18 — 2026-08-17

*Describes schema 2.11.*

**§4.3's field is renamed: `scene_numbering` → `numbering_policy`.** It
governs act, sequence and scene numbers and shot codes, and was named
after one of the four.

New **§4.3.1** states the deprecation window. A reader MUST prefer
`numbering_policy` and MUST fall back to `scene_numbering`; a writer MUST
mirror into the old column while it exists. The mirroring is an explicit,
time-boxed exception to §3.1, and the section says why: a reader knowing
only the old column would otherwise see a stale `derived` on a locked
project and renumber a shot list already on paper.

The rename is **additive** — schema 2.11 adds the new column, 2.12
removes the old — so no file needs converting. An earlier note in this
document called the rename non-additive and "before 1.0 or never"; that
was wrong, and §11.4's window is exactly the mechanism for it.

Appendix A gains a row for §4.3.

---

## 0.17 — 2026-08-17

*Describes schema 2.10.*

The first revision written in response to an **independent
implementation**. A Python reader built from `spec/` alone reproduced all
eight blessed query expectations and reported 33 gaps. This closes the
three most serious.

**§7 is rewritten. The previous text was wrong.** It described the
cascade as `project → sequence → scene → shot`; those are positional
scopes, and the cascade is not ordered by them. The reader's proof:
`look_development` is `scope: global` and appears fifth in Q07's chain.

§7 now states what the cascade actually is:

- **§7.1** A cascade is identified by its **leaf entity**, supplied by
  the caller — it is not derivable from the data or the registry, and
  any interface offering direction resolution must take it as an input.
- **§7.2** The chain is the `refines` closure, walked depth-first
  post-order, parents in declared order. `refines` had never been
  mentioned in this specification despite being the mechanism.
- **§7.3** One row per entity, with the selection rules stated —
  including that a scene-level match excludes rows carrying a `shot_id`,
  so a shot-level row never also arrives as a scene layer.
- **§7.4** "Every contributing layer" means every entity in the chain
  that supplied a row, not every row in the file that might have
  applied.

**§9.4's catalog is published.** `spec/finding-catalog.json`, generated
from the implementation, with all 35 codes, their severities, the
severity meanings, and the report ordering. §9.4 made the catalog
normative and it existed only in TypeScript, so no independent
implementation could satisfy it — the reader invented 21 codes of its
own and correctly described its clean exit code as "semantically empty".

**§1.3 no longer flags SQLite's own tables.** Names beginning `sqlite_`
are excluded from the known-table test. `sqlite_sequence` exists in every
conforming file, because the framework columns declare `AUTOINCREMENT`,
so the rule as written put a finding on every SCF in existence.

**§2.3 and §0.7 now document the registry fields that carry meaning.**
`refines` is load-bearing and defines the cascade; `scope` and `subject`
are described, and `scope` is explicitly *not* what orders the cascade.

`conformance.md`: both previously unperformable Reader claim steps are
now performable — step 1 against the published catalog, step 3 against
`fixtures/negative/CASES.json`, which publishes each negative case's
statements so a third party can build the databases rather than guess
the reports.

**§4.3 now covers all four numbers.** It governed scene numbers and shot
codes; `act.act_number` and `sequence.sequence_number` were unmentioned,
so an implementation could renumber acts on a locked project and remain
conforming. All four are authored, none is derived from position, and
`project.scene_numbering` governs all four.

The section also now says what the two modes are *for*: `derived` while
a writer is still moving the story, `fixed` once the numbers have left
the building on schedules and call sheets and become identifiers. A
scene numbered 12 that plays after scene 45 is correct under `fixed`,
and §4.1's warning is the same fact seen from the reader's side.

**The fixture is now a screenplay, not only an outline.** It carried
eleven sluglines, eight section headers and no body text at all, which
left §3.4 with no artifact behind it — there was no scene text to walk.
Four scenes now carry action and dialogue and the rest stay sluglines,
because an SCF is legitimately either and a reader meets both in one
file.

**The fixture's three orders now differ**, which is the more consequential
half. Scene `12A` sits mid-script with the highest row id; scene `16`
follows `19` in the script and keeps its number, legal precisely because
the project is `fixed`. Until now screenplay order, scene-number order
and row-id order coincided, so a reader ordering by `scene_number` alone
— the one thing §4.1 forbids — passed every blessed expectation. Three
new invariant tests pin the difference.

**The fixture's `scene_number` column was rebuilt as TEXT.** The registry
and `scf-schema.sql` had declared it text since schema 2.9; the fixture's
column was still INTEGER, so `ARTIFACTS.md`'s claim that the published
DDL cannot drift was false, and §4.2's grammar was unexercised by the
artifact meant to demonstrate it.

The rebuild immediately caught two consequences, both of which are §4.2
behaving as designed: a test helper binding scene numbers as JS numbers
matched nothing, because the driver binds numbers as doubles and `12`
arrived as `"12.0"`; and a fixture-invariant test ordering by the raw
column got `1, 10, 11, 12, 16, 19, 21, 24, 3, 7` — the lexicographic
failure §4.2.2 exists to prevent. Both are fixed, and the invariant test
now orders by §4.2.2 and pins the column's storage class.

`conformance.md` §5.4 records a decision not yet implemented: the
canonical queries are part of the format, and **the normative answer is
the structure, not the prose**.

---

## 0.16 — 2026-08-16

*Describes schema 2.10.*

**§11.6 is new: document equality.** `conformance.md` §3 had named this
as an open question — the Writer role rests on "open, save, lose
nothing" and nothing said what the comparison is performed on. It is a
canonical dump, never bytes: SQLite reorders pages and reuses freelist
space without any row changing, so byte-different files routinely say
the same thing.

The dump includes tables this specification does not define, which is
the point rather than an oversight: one that skipped unknown content
could not detect the loss §10.1 forbids.

A conforming Writer MUST produce an equal document when it opens a file
and writes it back unedited.

**Appendix A is complete**, with two entries marked *unpinned on
purpose*: §11.1 and §11.4 are policies about how the format may change,
not properties of a file, and no test can check that a future change
will be additive.

---

## 0.15 — 2026-08-16

*Describes schema 2.10.*

**§1.3's known table set is now two lists.** It defined the file's tables
as the registry plus `UUID_EXTRA_TABLES`, which conflated "is this table
SCF's" with "does this table carry row identity". The registry declares
`ownedTables` alongside `uuidExtraTables` as of schema 2.10, and a
reader MUST test unknown content (§10.1) against the union rather than
assembling its own list.

`screenplay_title_page` and `screenplay_version_title_page` are the
first members: a title page is a property of the screenplay rather than
a row in its own right, so they carry no uuids.

**§9.5 is new: the serialised report.** Required fields, both schema
versions, per-finding spec references, and — the load-bearing
requirement — byte-identical output across two runs over an unchanged
file, with volatile fields omitted by default. A report that differs on
every run cannot serve as a baseline.

§9.5 also requires a tool to distinguish a file it could not open from a
file it read and found errors in. Unreadable is not a finding.

The old §9.5 (reports accompany exports) is renumbered §9.6.

Appendix A gains rows for the negative fixtures and the report format.

---

## 0.14 — 2026-08-16

*Describes schema 2.9.*

**§9.4 is new: findings are enumerated.** This was the largest normative
gap left in the document. Findings were produced by six modules with no
shared codes, no severity scale and no serialised form, which made a
validator unspecifiable — `conformance.md` §4 has said so since it was
written.

- Codes are `area.condition`, lowercase and dotted, drawn from a closed
  catalog. Adding one is a change to this specification.
- Severity comes from the catalog, not from the point the finding is
  raised, so two producers cannot disagree about how bad the same
  condition is.
- The scale is `error` / `warning` / `info`, and it describes the DATA.
  `error` means two conforming readers would disagree about what the
  file says. It is explicitly not a reason to refuse the file.
- Reports MUST be deterministic over an unchanged file, ordered by
  severity, code, table, then lowest row id. A report that reorders
  itself cannot be diffed.
- The vocabulary is scoped to well-formedness and MUST NOT be conflated
  with readiness, which answers a different question.

The old §9.4 (reports accompany exports) is renumbered §9.5.

Appendix A gains a row for §9.4.

---

## 0.13 — 2026-08-16

*Describes schema 2.9.*

**§10.1 gains a MUST that was previously only implied**, and the whole
of §10 stops being an untested promise.

- §10.3 now states explicitly that a writer MUST preserve `x_` content
  across a write cycle on the same terms as any other unrecognised
  content, and notes that the distinction is intent rather than
  protection: unknown content is preserved because it is unknown,
  whether or not its author followed the convention.
- §10.3 also records that the reference implementation's linter rejects
  any registry name claiming the prefix.
- §1.3 points at `scf-schema.sql`, the published physical DDL.
- §2.1 points at `registry.schema.json` and `ARTIFACTS.md`.

`spec/ARTIFACTS.md` is new: an addressing scheme (`schema-X.Y` tag plus
raw URL) and SHA-256 for every published artifact. It states that `main`
MUST NOT be used to pin a version.

Appendix A gains rows for §2.1, §10.1 and §10.2–10.3. §10.1's
preservation requirement had never been verified; it now is, including
across five repeated write cycles.

---

## 0.12 — 2026-08-15

*Describes schema 2.9.*

**§1.2 file identification is now concrete, and implemented.** It had
said a writer MUST set `application_id` to "the registered SCF value"
without saying what that was — a requirement nobody could satisfy.

- `application_id` = `0x53434631` (`1396917809`), `SCF1` as big-endian
  ASCII. Checked against SQLite's `magic.txt` registry: no collision
  with any of its eleven entries.
- `user_version` = `major * 1000 + minor`; schema 2.9 → `2009`.
- The trailing `1` is the container generation, not the schema version.
  GeoPackage set the precedent by registering both `GPKG` and `GP10`.
- Reader tolerance restated as a MUST NOT: no file may be rejected for
  lacking the stamps.
- Header/`_scf_meta` disagreement is a finding, with `_scf_meta` as the
  authority.
- The `magic(5)` stanza ships as `spec/scf.magic`.
- The media type is `application/vnd.minimalhumans.scf` — vendor tree,
  so no registration is required.

Note that **no schema version was bumped for this**. The header stamps
are physical format, not the entity/field set, which is what the two
tracks in §0.6 exist to keep apart.

Appendix A gains a row for §1.2.

---

## 0.11 — 2026-08-15

*Describes schema 2.9.*

**No requirement changed.** 0.11 records that the implementation caught
up with 0.10 and that the registry now agrees with §4.2.1.

§4.2.3's registry note is rewritten: schema 2.9 declares `scene_number`
as text, so the declared type and the grammar no longer differ. Files
written before 2.9 need no conversion — affinity is a hint, and §4.2.3
already defined the behaviour for any value.

Appendix A gains real entries for §4.2 and §4.4, which were marked
unpinned in 0.10. `sceneNumbers.test.ts` pins the grammar, the ordering,
and — the case worth naming — that the TypeScript comparison and its SQL
twin order the same list identically.

The §11.4 note now records both pre-1.0 non-additive changes rather than
just 2.8's.

---

## 0.10 — 2026-08-15

*Describes schema 2.8.*

**Added: §4.2 scene-number grammar.** `scene_number` had been specified
only as "a label, MAY have gaps, MAY be non-numeric", which is not
enough to implement against. It now carries an ABNF canonical form
(optional bijective base-26 prefix, digits, optional suffix), a total
ordering rule for the §4.1 fallback case, and an explicit statement that
a value which does not parse is opaque rather than invalid.

Ordering yields `A12 < B12 < 12 < 12A < 12B`.

**Added: §4.4 shot codes.** Previously the format defined shot codes
only in code. The section states the canonical form, the zero-based
bijective base-26 letter run, allocation (continue past the highest, do
not backfill), and restamping under `project.scene_numbering`.

**Added: §4.4.2, a new MUST — shot codes are parsed relative to their
scene.** A shot code is read by removing its scene's `scene_number` from
the front, never by taking the trailing letter run in isolation. The two
readings diverge as soon as a scene number ends in a letter, which
§4.2.1 now permits: shot `12AB` in scene `12A` is ordinal 1 under the
correct reading and ordinal 27 under the incorrect one.

This is the change that makes 0.10 a minor rather than a patch.

**Renumbered.** §4.3 (position patterns) is now §4.5; the numbering
policy paragraph that had been folded into §4.2 is now §4.3 in its own
right.

**Editorial.** Scope list in §0.2 names the two new grammars. Appendix A
gains rows for §4.2 and §4.4, both marked with what is and is not pinned.

---

## 0.9 — 2026-08-15

*Describes schema 2.8.*

Initial draft. Extracted from `docs/conventions.md`, which becomes the
design record and states no rules from this version onward.

Sections: §0 scope (including the unit of interchange, what is outside
1.0, the three version tracks, and a glossary), §1 physical format, §2
the entity model, §3 derived versus stored, §4 position and ordering,
§5 structure, §6 identity, §7 the direction cascade, §8 assets and
addressing, §9 findings, §10 extensibility, §11 versioning. Appendix A
maps sections to the tests that pin them.

Newly written rather than extracted: §1, §2, §9, §10, §11. These were
facts about the reference implementation with no document behind them.

Known normative gaps at first draft, tracked in
[stability.md](stability.md): §6.6 (whether resolvers exclude `cut`
rows), the finding vocabulary, and §1.2 file identification.
