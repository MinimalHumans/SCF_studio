# The SCF Format Specification

**Version 0.19 (draft) — not a release.**
Describes schema version **2.12**.
Editors: Christopher Smallfield, Jesse Kretschmer (Minimal Humans).

| | |
|---|---|
| Status | Draft. Section stability is stated in [stability.md](stability.md). |
| Conformance | Roles and requirements in [conformance.md](conformance.md). |
| Changelog | [CHANGELOG.md](CHANGELOG.md). |
| Rationale | Design record: [../docs/conventions.md](../docs/conventions.md). |
| Registry | `scf-core/registry/registry.json`, generated from `schema/entity_registry.py`. |

This document states what SCF *is*. It does not explain why, argue for
any decision, or describe the reference implementation's internals.
Those belong to the design record, which cites this document by section
and never restates a rule.

---

## 0. Scope

### 0.1 What SCF is

SCF (Story Context Framework) is a file format for describing a film's
intent in enough structural detail that a human or a machine can answer
a specific question about a specific moment: what a character sounds
like in a given scene, what is in force at a given point in the story,
what a shot is for.

An SCF file describes **what is in the film**. It is not a revision
history, not an archive of alternatives, and not a production database.
External version control covers history; SCF describes the current
intent.

### 0.2 What this document specifies

Normative:

- the physical encoding of a `.scf` file (§1);
- the entity model and the registry that defines it (§2);
- which facts are stored and which MUST be derived (§3);
- story position, ordering, and the scene-number and shot-code
  grammars (§4);
- narrative structure as spans (§5);
- row and cross-file identity (§6);
- the direction cascade (§7);
- asset addressing and resolution (§8);
- the findings model — how a conforming implementation reports problems
  rather than refusing data (§9);
- extension and reserved names (§10);
- versioning and compatibility (§11);
- **the canonical queries (§12)** — the sixteen questions SCF exists to
  answer, and what a conforming implementation returns for each.

§12 is **not yet written**. The queries were decided to be part of the
format on 2026-08-17, and the normative answer is the RESULT STRUCTURE,
not any rendering of it. Until §12 exists, the only definition of a
canonical query is the blessed expectation in `fixtures/expectations/`,
which is a demonstration rather than a specification — an implementer
has to infer the query from one example of its output. That is the
largest known gap in this document and it is tracked in
[stability.md](stability.md).

### 0.3 The unit of interchange

**The unit of interchange is the `.scf` file.** A single `.scf` is a
complete, self-describing SCF document. Everything a consumer needs in
order to answer a question about the story is inside it.

Asset identifiers inside a `.scf` may be root-relative (§8), and a
resolver needs a mapping from a root name to a location before it can
fetch bytes. That mapping is supplied by the consuming environment; it
is not part of the document, and its absence does not make the document
incomplete. A `.scf` opened with no root mapping is a valid SCF
document in which every asset resolves to `unaddressed`.

The reference editor asks the user for a project folder and derives
`@project` from it. That is a workflow, not a property of the format. No
conforming implementation is required to use folders, and this
specification defines no packaged or archive form.

### 0.4 What is outside version 1.0

The following are explicitly **not** specified by SCF 1.0. A file MAY
contain them; a conforming reader MUST NOT rely on them, and MUST ignore
what it does not understand (§10).

| Area | Status |
|---|---|
| Version / snapshot system (`screenplay_versions`, `screenplay_version_lines`) | Outside 1.0, and may never enter it. The function belongs to external tooling. Tables MAY be present; conforming readers MUST ignore them. |
| Layers — a `.scf` referencing another `.scf` | Reserved (§8.8). The word is claimed; nothing else is specified. |
| Cross-file merge | Not specified. Depends on natural keys (§6.3), which are specified, but the algorithm is not. |
| Packaging / archive format | Not specified and not planned. |
| Editor behaviour, UI, and import heuristics | Never in scope. Proposal extraction is an authoring aid, and §9.3 states the only requirement the format places on it. |
| Metadata query | Deliberately impossible (§8.7). Content facts are read from files, never stored, and therefore cannot be filtered on. |

### 0.5 Requirement keywords

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD
NOT, RECOMMENDED, MAY, and OPTIONAL are to be interpreted as described in
RFC 2119.

Requirements are addressed to **implementations**, in the roles defined
in [conformance.md](conformance.md). Where a requirement applies to only
one role, the role is named.

### 0.6 Versions

Three numbers, deliberately independent:

- **Specification version** — this document. Currently `0.19` (draft).
  Increments when the normative text changes.
- **Schema version** — the entity/field set, `SCHEMA_VERSION` in
  `schema/schema_meta.py`. Currently `2.12`. Increments on any
  non-cosmetic registry change.
- **Implementation version** — any given tool's own release number. Not
  governed here.

This specification describes schema **2.12 and later**. A conforming
reader MUST accept any file whose schema version is greater than or
equal to the minimum it declares support for, subject to §11.

### 0.7 Terminology

**entity** — one of the 99 row types defined by the registry. A table.

**link entity** (also **junction**) — an entity whose purpose is to
connect two others. Thirteen exist.

**tier** — a registry-declared depth band, 0–6, grouping entities by how
far they sit from the bedrock nouns. Tier is descriptive; it carries no
semantics in this specification.

**scope** — a registry-declared positional grain (`global`, `act`,
`sequence`, `scene`, `shot`, `moment`). Descriptive. It does **not**
order the direction cascade (§7.2).

**subject** — the registry-declared entity a row is about. Load-bearing
for §6.5's carve-out and nothing else in this document.

**refines** — a registry-declared list of the entities an entity adds
detail to. Load-bearing: it defines the direction cascade (§7).

**span** — an act or a sequence: a run of contiguous scenes defined by
its start alone (§5).

**position** — a scene's place in story order (§4.1).

**in force** — a state row applies at a given position, under that row's
position pattern (§4.3).

**cascade** — the ordered resolution of direction from broad to specific
(§7).

**identifier** — an asset's stored, portable address (§8.1).

**root** — a name, written `@name`, standing in for a location an
identifier is relative to (§8.2).

**resolver** — the component that maps an identifier to bytes.

**finding** — a reported problem in the data that does not prevent the
data being read (§9).

**derived** — computed from other stored facts at read time, never
written back (§3).

---

## 1. Physical format

### 1.1 Container

An SCF document is a **SQLite 3 database file**. Implementations MUST NOT
assume any particular SQLite page size, journal mode, or encoding beyond
what SQLite itself guarantees.

The conventional file extension is `.scf`.

### 1.2 File identification

SQLite reserves two 32-bit header slots for exactly this purpose:
`application_id` at byte offset 68, `user_version` at offset 60. Both
lie in the first 100 bytes, so a `.scf` can be identified from its first
page without a SQL engine — and, more usefully, told apart from the
thousands of unrelated SQLite databases on a machine.

A conforming writer MUST set:

| Slot | Value |
|---|---|
| `application_id` | `0x53434631` (`1396917809`) — `SCF1` as big-endian ASCII |
| `user_version` | the schema version as `major * 1000 + minor` (schema 2.12 → `2012`) |

The trailing `1` in `SCF1` is the **container generation**, not the
schema version. It changes only if the physical encoding ever breaks
compatibility. The schema version lives in `user_version`, where it
moves freely. This follows the convention of SQLite's own `magic.txt`
registry, in which GeoPackage registered both `GPKG` and `GP10`.

**A conforming reader MUST NOT reject a file that lacks either stamp.**
Every file written before this requirement carries neither. The stamps
are an identification aid, never a gate.

Where the header's `user_version` and `_scf_meta.schema_version`
disagree, `_scf_meta` is the authority and the disagreement is a finding
(§9).

The registered `magic(5)` stanza ships as [`scf.magic`](scf.magic).

The media type is `application/vnd.minimalhumans.scf`. It is a vendor-tree
type and requires no registration; the conventional extension is `.scf`.

### 1.3 Tables

A conforming file contains one table per registry entity, named for the
entity, plus the screenplay infrastructure tables. Column sets are
defined by the registry (§2).

The registry declares those infrastructure tables in two lists, because
being SCF's and carrying row identity are different properties:

| List | Meaning |
|---|---|
| `uuidExtraTables` | Not registry entities, but they carry uuid row identity on the same terms (§6.1). |
| `ownedTables` | SCF's, and carrying no identity. A title page is a property of the screenplay rather than a row in its own right. |

**The known table set is the registry entity names, both lists, and
`_scf_meta`.** Anything else is unknown content under §10.1. A reader
MUST test against the union rather than assembling its own list.

Tables whose names begin `sqlite_` are **excluded from that test**. They
are SQLite's own — `sqlite_sequence` is created automatically for any
`AUTOINCREMENT` column, and the registry's framework columns declare
one, so every conforming file has it. Reporting them as unknown content
would put a finding on every SCF in existence.

A file MAY contain further tables. A conforming reader MUST ignore any
table it does not recognise, and MUST NOT treat its presence as an
error (§10).

The physical DDL for the current schema version is published as
[`scf-schema.sql`](scf-schema.sql). It is dumped from a database created
by the reference implementation rather than written by hand, so it
cannot drift from what that implementation produces. It is the physical
schema only: a database created from it alone is structurally conforming
and semantically empty.

### 1.4 Missing columns

A reader that intends to write MUST tolerate a file lacking columns the
registry defines, and SHOULD add them on open rather than refusing the
file. Every schema change to date has been an additive optional field,
and §11 requires that this remains true.

---

## 2. The entity model

### 2.1 The registry is normative

The set of entities, their fields, types, and reference targets are
defined by `registry.json`, generated from `schema/entity_registry.py`.
The registry is a normative part of this specification; where this
document and the registry disagree about a field, the registry is
correct and this document is in error.

The registry's own STRUCTURE is described by
[`registry.schema.json`](registry.schema.json), a JSON Schema, so that a
consumer can read the field set without running the reference
implementation. That document constrains shape only — which entities
exist is the registry, and what they mean is this specification.

Each schema version's artifacts are addressable and checksummed; see
[ARTIFACTS.md](ARTIFACTS.md).

Version 2.12 defines **99 entities** across tiers 0–6.

### 2.2 Framework columns

Every entity carries `uuid` (§6.1). Entities additionally carry
framework columns where the registry declares them:
`lifecycle_status`, external-id columns, and version columns. An
implementation MUST determine which apply from the registry rather than
from a hand-maintained list.

### 2.3 Deriving behaviour from the registry

Several rules in this specification are stated in terms of registry
metadata rather than enumerated lists, and implementations MUST derive
them the same way, so that adding an entity requires no code change:

- **Ownership.** A field named `scene_id` means the row BELONGS to that
  scene and MUST be deleted with it. Any other reference to `scene`
  means the row POINTS AT the scene and MUST retain its identity with
  the reference cleared. `act.start_scene_id` and
  `sequence.start_scene_id` are excluded from both and MUST be
  re-anchored (§5.4).
- **Link labels.** Where a link entity declares its `nameField` as
  `hidden: true`, that column is not a name and MUST NOT be displayed as
  one (§3.2).
- **Asset usage.** Every field anywhere in the schema whose
  `referenceEntity` is `asset` counts as a use of that asset for the
  purpose of §8.6.
- **Direction cascades.** An entity's `refines` list is its parents in
  the direction cascade, and the cascade chain is the closure of that
  list (§7.2). `refines` is the most semantically loaded field in the
  registry and carries this meaning alone.

---

## 3. Derived versus stored

### 3.1 The rule

**If a value can be computed from another stored value, it MUST be
computed and MUST NOT be stored.**

A stored copy of a derivable fact is a second truth that nothing detects
when the original changes.

### 3.2 Values that MUST be derived

| Value | Derived from |
|---|---|
| A scene's display label | `sc {scene_number} — {name}`, at render time |
| A link row's label | the rows it points at |
| Act and sequence membership | the span's start boundary (§5) |
| Story order | the screenplay position of each scene's heading (§4.1) |
| An asset's format | its identifier's extension (§8.5) |
| An asset's path tree position | its identifier's segments |
| A file's content metadata | the file, read at display time (§8.7) |

### 3.3 The one exception

`shot.shot_number` IS stored and IS authored. A shot number is an
identifier issued to a crew, not a display label. Consumers MUST NOT
rewrite it.

An implementation MAY compute a derived shot code and MAY present it
alongside an authored one that disagrees, so a list can be reissued
deliberately.

A shot moved to a different scene MUST be renumbered. The rule protects
a number against its scene renumbering; it does not protect a number
that names the wrong scene.

### 3.4 Derived-but-stored

`screenplay_lines.scene_id` is threaded onto body lines when the
screenplay is committed. It is derived state that happens to be stored,
and it is absent for lines typed since the last commit and for files
written before the threading existed.

**Implementations MUST NOT rely on it.** To read a scene's text, find the
heading line linked to that scene and take every line up to the next
heading.

---

## 4. Position and ordering

### 4.1 Story order

Everything positional is keyed to a **scene**. Scenes are ordered by
their position in the screenplay: the `line_order` of the heading that
carries each scene.

A scene the screenplay does not contain has no screenplay position, and
implementations MUST fall back to `scene_number` — unnumbered scenes
last — and then to row id.

**Implementations MUST NOT order scenes by `scene_number` alone.** Doing
so is wrong for any file written without a screenplay, and for any scene
moved since the last commit.

### 4.2 Scene numbers

`scene_number` is a label for a position, not the position itself
(§4.1). Two scenes MAY carry the same label, and a scene MAY carry none.

#### 4.2.1 Canonical form

```abnf
scene-number  = [prefix] digits [suffix]
prefix        = 1*3ALPHA
digits        = 1*DIGIT
suffix        = 1*3ALPHA
```

Examples: `1`, `12`, `101`, `12A`, `A12`, `12AB`.

A prefix marks a scene inserted before the numbered one; a suffix marks
a scene inserted after it. Both letter runs are **bijective base-26**
(`A`=1, `Z`=26, `AA`=27) and are compared case-insensitively; the
canonical form is uppercase.

#### 4.2.2 Ordering

Where §4.1's fallback reaches `scene_number`, implementations MUST order
by the tuple:

```
(digits, prefix-present ? 0 : 1, prefix-index, suffix-index)
```

with `prefix-index` and `suffix-index` the bijective base-26 values, and
`0` where the run is absent. This yields `A12 < B12 < 12 < 12A < 12B`,
which is the convention the notation exists to express.

#### 4.2.3 Non-conforming values

A `scene_number` that does not match §4.2.1 is **opaque**. It is valid
data and MUST NOT be rejected (§9.1). Implementations MUST NOT order it
by §4.2.2 and MUST fall through to the next term in §4.1's chain.

> **Registry note.** Schema 2.9 declares `scene_number` as text, so the
> declared type and this grammar agree. Files written before 2.9 carry an
> integer-affinity column; no conversion is needed, since affinity is a
> hint and §4.2.3 defines the behaviour for any value either way.

### 4.3 Numbering policy

**All four numbers are authored and stored**: `act.act_number`,
`sequence.sequence_number`, `scene.scene_number` and `shot.shot_number`.
None of them is derived from position, and none may be inferred from one.

`project.numbering_policy` governs whether an implementation recomputes
them:

- `derived` (default) — act, sequence and scene numbers and shot codes
  are recomputed at commit to match story order;
- `fixed` — authored numbering is preserved, in full.

An implementation that recomputes any of the four on a `fixed` file is
non-conforming.

The two modes are the two halves of a project's life. While a writer is
still moving the story around, renumbering by hand is tedious and the
numbers carry no external commitment, so `derived` keeps them tracking
the page. Once a production is greenlit the numbers leave the building —
on schedules, call sheets, shot lists — and become identifiers rather
than labels. From that point `fixed` holds them still, and a scene
numbered 12 that plays after scene 45 is **correct**: it is scene 12,
and every document in the production office says so.

§4.1's warning is the same fact from the reader's side. Under `fixed`, a
scene's number stops predicting its position, which is why story order
is derived from the screenplay and never from the number.

### 4.4 Shot codes

`shot.shot_number` is authored and stored (§3.3). This section defines
the form a conforming implementation generates and how any
implementation MUST read one.

#### 4.4.1 Canonical form

```abnf
shot-code  = [scene-prefix] letter-run
letter-run = 1*ALPHA
```

`scene-prefix` is the `scene_number` of the shot's scene, reproduced
verbatim. `letter-run` encodes a **zero-based** ordinal in bijective
base-26: `A`=0, `Z`=25, `AA`=26, `AB`=27.

A shot in a scene with no `scene_number` has no prefix, and its code is
the letter run alone.

Codes are compared case-insensitively; the canonical form is uppercase.

#### 4.4.2 Parsing is relative to the scene

**A shot code MUST be parsed by removing its scene's `scene_number` from
the front and reading the remainder as the letter run. An implementation
MUST NOT parse a shot code by taking its trailing letter run in
isolation.**

The two readings differ whenever a scene number ends in a letter, which
§4.2.1 permits. For a shot `12AB` in scene `12A`:

| Reading | Prefix | Letters | Ordinal |
|---|---|---|---|
| Correct — strip the scene number | `12A` | `B` | 1 |
| Incorrect — trailing run | `12` | `AB` | 27 |

A shot code whose prefix does not match its scene's number is
**unparseable**, not an error: it is valid data, MUST NOT be rejected,
and MUST be left unchanged by any operation that would otherwise
renumber it.

#### 4.4.3 Allocation

A newly created shot SHOULD take the code one past the **highest**
ordinal already used in its scene, not the first unused one. A shot
number may already be held by a crew, so a cut `42B` MUST NOT be reissued
to a different setup while any sibling above it exists.

This is a guard, not a guarantee. Nothing records codes that once
existed, so deleting the highest-numbered shot in a scene frees its code
again. An implementation requiring the stronger promise needs a stored
counter, which this version does not define.

#### 4.4.4 Restamping

When a scene's number changes and `project.scene_numbering` is
`derived`, an implementation MUST restamp each of that scene's shot
codes onto the new number, preserving the ordinal (§4.4.2).

When `scene_numbering` is `fixed`, shot codes MUST be left unchanged
along with the scene numbers. That is the state a distributed shot list
requires.

An implementation MAY display a derived code alongside an authored one
that disagrees, so that a list can be reissued deliberately (§3.3).

### 4.5 Position patterns

Each entity declares a `positionPattern`. Three exist, and a resolver
MUST apply the one the registry declares.

**Pattern 1 — explicit rows.** One row per scene. What is in force is
what is written. No inference.

**Pattern 2 — persistence.** A state row is keyed at a scene and carries
`persistence`:

- `scene_only` — in force at its own scene and nowhere else;
- `until_resolved` — in force from its scene forward until
  `resolved_at_scene_id` (exclusive), or to the end of the story.

Where several persistent states apply at one position, implementations
MUST merge them oldest-first, so a later state overrides an earlier one
field by field.

**Pattern 3 — latest wins.** A state row exists at each scene where the
value changed. The answer at any position is the most recent row at or
before it. There is no resolution point; the next row supersedes.

---

## 5. Structure: spans

### 5.1 Spans are defined by their start

An act **begins** at a scene and runs until the next act begins. A
sequence likewise. `act.start_scene_id` and `sequence.start_scene_id`
are the only stored facts. Membership MUST be derived.

### 5.2 Spans are contiguous

A span covers every scene from its start to the start of the next span
of the same kind. Non-contiguous membership is not expressible. An
implementation MUST NOT invent a representation for it.

### 5.3 Acts and sequences are independent

Acts and sequences are independent spans, **not** a hierarchy. A scene
MAY be in an act with no sequence, and a sequence MAY begin in one act
and end in another. Both are legal and MUST NOT be rejected.

An implementation presenting acts and sequences as nested MUST group an
act's scenes into runs of sequence, so that a crossing sequence appears
in each act as the part of it that belongs there. Grouping by "sequences
whose start falls in this act" is incorrect.

### 5.4 Shadow rows

`scene_sequence` rows MAY be materialised at commit so that queries
written against them keep working. The boundary is the truth and those
rows are its shadow; they MAY be stale between commits.

Rows that no boundary explains MUST be counted and reported as a finding
(§9), and MUST NOT be silently deleted.

### 5.5 Half-placed structure is valid

An act with no boundary, a boundary on a deleted scene, two acts on one
scene, and scenes before the first act are all valid file states. Each
MUST produce a usable structure and a finding.

---

## 6. Identity

### 6.1 Row identity

Every row in every entity, junctions included, carries a `uuid` that is
unique within its table. Implementations that open a file for writing
MUST backfill missing uuids.

A uuid answers the **lineage** question: is this the same row as before,
across export, re-import, and being read by another tool. Row ids are
local to a file and MUST NOT be treated as meaningful outside it.

### 6.2 Uuids do not identify across files

A uuid is minted per file. Two files describing the same production will
carry different uuids for the same real link. Implementations MUST NOT
match rows across files by uuid.

### 6.3 Natural keys

Across files, a junction is identified by its **natural key**: the rows
it joins, plus the polymorphic target where it has one, plus `domain`
where present.

The natural key for each of the thirteen link entities is stated by
`junctionKeyFields()`. Any implementation that merges, de-duplicates, or
validates junctions MUST use that key.

### 6.4 Duplicates are findings

Nothing in the schema prevents two rows sharing a natural key.
Duplicates MUST be reported as findings (§9), and MUST NOT be rejected
on write. Duplicates whose content disagrees MUST be reported distinctly
from duplicates that are identical.

### 6.5 Relationships

`character_relationship` has no constraint on its two character columns
and no convention about ordering.

`directionality` carries the symmetry fact: `mutual` (unordered) or
`a_to_b` (reads A → B).

**Consumers MUST read relationships from both character columns** and
MUST NOT assume the character of interest occupies `character_a_id`.

`character_relationship` is not one of the thirteen link entities — its
`subject` is `character` — so junction tooling does not cover it.
Implementations MUST report, separately:

- one pair entered twice as `mutual` — duplicate;
- two `a_to_b` rows in opposite directions — two legitimate facts;
- the same direction twice — duplicate;
- one row `mutual` and another directed for the same pair —
  contradiction;
- rows with no `directionality`;
- rows naming one character twice;
- rows pointing at a character not present in the file.

### 6.6 Lifecycle status

`lifecycle_status` marks a row as active or cut.

Where the registry declares it, an implementation MUST preserve it. Of
the thirteen link entities only `actor_character_role` and
`thematic_connection` carry it; the others MUST NOT.

> **1.0 requirement, not yet defined.** Whether resolvers exclude `cut`
> rows by default, and how a consumer asks for history, is a normative
> gap. It is in scope for 1.0 and is tracked in
> [stability.md](stability.md). Until it is specified, implementations
> MUST treat a `cut` row as present, and MUST NOT rely on that remaining
> the answer.

---

## 7. The direction cascade

Direction — how something should look, sound or be played — is authored
at several levels of generality and resolved from the broadest to the
most specific. This section defines that resolution.

An earlier revision of this section described the cascade as
`project → sequence → scene → shot`. **That was wrong**: those are
positional scopes, and the cascade is not ordered by them. It was
corrected in specification 0.17 after an independent implementation
demonstrated the contradiction.

### 7.1 A cascade is identified by its leaf

There is no single cascade. A cascade is named by its **leaf entity**,
and the caller supplies it — for the canonical queries, the query names
it. Q07 resolves the leaf `shot_design`; Q08 resolves
`scene_music_design`.

The leaf is **not derivable** from the data or from the registry. Two
entities can both be about sound, both be populated, and only one be part
of the soundscape cascade. Any interface offering direction resolution
MUST take the leaf as an input.

### 7.2 The chain is the `refines` closure

Each entity declares `refines`: a list of the entities it adds detail
to. Twelve of the 99 entities declare a non-empty one.

The chain for a leaf is produced by walking `refines` **depth-first,
post-order**, so that an entity's parents precede it and the leaf is
last. Where an entity refines several parents, they are visited in
declared order. An entity already in the chain is not revisited.

```
chain(leaf):
    for parent in leaf.refines:   # declared order
        chain(parent)
    append(leaf) if not already present
```

This is the whole ordering rule. It is a graph walk, not a scope
ordering — which is why a `scope: global` entity can appear after a
`scope: scene` one, as `look_development` does in the Q07 chain.

### 7.3 One row per entity, most specific first

For each entity in the chain, a resolver selects **at most one row**:

1. If the entity's `positionPattern` is `latest_wins` and a scene is
   given, the row is the latest at or before that scene in story order
   (§4.5).
2. Otherwise, if a shot is given and the entity has a `shot_id` column,
   a row matching that shot.
3. Otherwise, if a scene is given and the entity has a `scene_id`
   column, a row matching that scene **whose `shot_id` is empty** — so a
   shot-level row never also arrives as a scene-level layer.
4. Otherwise, if the entity has neither column, its first row.
5. Otherwise, nothing.

An entity contributing no row is **skipped**, not represented as an
empty layer. Absence is well-defined and is not a finding.

### 7.4 What resolution returns

An ordered list of `(entity, row)` pairs, root-first, with the last pair
the most specific opinion.

A resolver MUST return **every contributing entity**, not only the
last, so a consumer can determine where a value came from. "Every
contributing layer" means every entity in the chain that supplied a row
under §7.3 — not every row in the file that might have applied.

Returning only the resolved value makes an answer unarguable and
unexplainable at once; the chain costs nothing and turns the cascade
into something a person can reason about.

## 8. Assets and addressing

### 8.1 An asset is a reference

An asset row addresses content; it does not contain it. A conforming
file MUST NOT embed asset bytes. Query output and exports MUST carry
references, never bytes.

### 8.2 Identifiers and roots

An asset row stores an **identifier**: portable, root-relative, and the
thing that is committed and diffed.

```
@project/characters/eleanor/face_ref.png
```

Grammar:

- An identifier beginning `@` is **rooted**. The root name runs from the
  `@` to the first separator; the remainder is the path below it.
- A root name MUST NOT be empty.
- Separators are normalised to `/`. Empty and `.` segments are removed.
- A path containing a `..` segment escapes its root and MUST NOT be
  resolved.
- An identifier not beginning `@` is treated as **absolute**. It MUST
  NOT be silently adopted into `@project`.

`@project` is the root of the document's own content and is the only
root that appears in the common case. Root names other than `@project`
are reserved (§10.2); the mapping from a root name to a location is
supplied by the consuming environment and MUST NOT be stored in the
`.scf`.

Absolute paths are representable. They MUST be flagged non-portable and
MUST resolve to `out-of-root`.

### 8.3 Resolution states

Every asset resolves to exactly one state:

| state | meaning |
|---|---|
| `resolved` | bytes reachable now |
| `missing` | does not resolve under its root |
| `unmaterialised` | cloud placeholder; appears on access |
| `out-of-root` | absolute or foreign root; resolvable but non-portable |
| `unaddressed` | nothing to resolve against: the row carries no identifier, or this session supplies no mapping for its root |

`unmaterialised` MUST NOT be reported as a kind of `missing`. A synced
project full of placeholders is healthy.

`unaddressed` is the state of every asset in a document opened with no
root mapping (§0.3). An implementation MUST distinguish it from
`missing`, and MUST NOT report it as `out-of-root`. The three are
different facts and lead to different actions:

| state | what it means | what a user does |
|---|---|---|
| `unaddressed` | nothing to resolve against | attach a project folder, or give the row an identifier |
| `missing` | resolved, and the bytes are not there | find the file |
| `out-of-root` | the identifier points outside the project **by construction** — absolute, or containing `..` | fix the identifier, or accept it will not travel |

`out-of-root` is a property of the identifier and does not depend on the
session. `unaddressed` is a property of the session and says nothing
about the identifier. Reporting an unmapped root as `out-of-root` tells
a user their paths are wrong when the truth is that no folder is
attached, and makes every asset in a lone `.scf` look broken.

The two ways to be `unaddressed` are distinguished by findings, not by
state: a row with no identifier raises `asset.identifier_absent`
(§9.4). A resolver reporting the state alone need not tell them apart;
one that wants to MUST use the finding.

Resolution MUST stay total. A document in which nothing resolves MUST
open, list everything, and report findings.

### 8.4 Purpose lives on the link

There is no intrinsic-purpose column on `asset`, and a conforming
implementation MUST NOT add one within the `asset` namespace (§10.1).

Use is a property of the link: `bundle_asset.role_in_bundle` and
`asset_relationship.relationship_type` carry it. A file used twenty ways
is twenty edges and one row.

`tags` is a freeform, user-controlled field. It is not a taxonomy and
MUST NOT be interpreted as one.

### 8.5 Format is a hint

An asset's format is derived from its identifier's extension. It MAY
dispatch preview and coarse filtering. It is **never** a claim about
purpose.

An unrecognised extension MUST NOT be treated as an error, and MUST NOT
be handed to a renderer on the assumption that it will decode.

### 8.6 Orphans

An asset referenced by no field anywhere in the schema is an **orphan**.
Orphan detection MUST be derived from the registry (§2.3), not from a
maintained list.

`asset`'s own version columns MUST be excluded from the usage count: a
row whose only inbound reference is its own successor is still an
orphan.

### 8.7 Content metadata is read, never stored

`size_bytes` and `source_mtime` are stored, because they are hints about
the **reference** going stale.

Dimensions, channels, compression, duration, generator, and every other
fact about the **content** MUST be read from the file when shown and
MUST NOT be stored. There is no width column and a conforming schema
MUST NOT add one.

The accepted consequence is that content metadata cannot be queried.

### 8.8 Layers are reserved

A `.scf` that references another `.scf` is performing **composition**,
not reference. That is outside 1.0 (§0.4).

An implementation MUST NOT represent another `.scf` as an `asset` row.
The term for the eventual mechanism is **layer**; nothing else about it
is specified.

---

## 9. Findings

### 9.1 SCF describes; it does not enforce

The schema constrains almost nothing beyond required fields and
reference columns. Duplicates, contradictions, and gaps are **findings**
— reported, never rejected on write.

A half-entered document is a normal state of work, not an error.

### 9.2 Resolvers are total

Every resolver MUST return a usable answer for missing, dangling, and
contradictory data, and MUST report the problem separately. A resolver
that throws on half-placed data is non-conforming.

Consumers MUST NOT assume a row is well-formed because it exists.

### 9.3 Extracted content is a proposal

Anything a tool extracts from a screenplay is a **proposal**, not a
fact. A writer MUST NOT create entities from extraction without user
confirmation, except where its own confidence model marks a proposal as
certain.

Props are the standing exception: **a prop MUST NOT be created by
automatic acceptance.** A prop is created only by explicit user action.

### 9.4 Findings are enumerated

Every finding a conforming implementation reports MUST carry a **code**
drawn from the catalog published as
[`finding-catalog.json`](finding-catalog.json), and MUST take its
**severity** from that catalog rather than assigning one at the point the
finding is raised.

The catalog carries its own version, on its own track: a code added to it
is a change to this specification, but the file's shape can change
without one.

Codes are `area.condition`, lowercase, dotted. They are a closed set:
adding one is a change to this specification, with a catalog entry naming
the section it derives from.

Severity describes the DATA, never acceptance of the file:

| | Meaning |
|---|---|
| `error` | The data contradicts itself or this specification, and two conforming readers would resolve it differently. **Not** a reason to refuse the file (§9.1) — a reason to fix it before anyone relies on the answer. |
| `warning` | Resolvable, and probably not what the author meant. |
| `info` | Worth reporting; nothing is wrong. |

A report over one unchanged file MUST be deterministic: the same
findings, in the same order, on every run. Ordering is by severity, then
code, then table, then lowest row id. Without this a report cannot be
diffed, which is most of what reporting is for.

This vocabulary covers **whether a file is well-formed**. It does not
cover whether a given query can be answered well from it — that is
readiness, a different question with a different audience, and the two
scales MUST NOT be conflated. A flawless file may still have too little
authored for a query to say anything useful.

### 9.5 The serialised report

A validation report MUST carry:

- `reportFormat` — the version of the report shape itself, on its own
  track. A consumer parsing a report needs to know how to read the
  REPORT, which changes for reasons unrelated to the format reported on.
- `toolSchemaVersion` and `fileSchemaVersion` — what the tool knows, and
  what the file claims. They differ routinely and both matter.
- `source`, `counts`, `clean`, and `findings`.

Each finding carries its code, severity, table, row ids, message, count,
and the specification section it derives from.

A report MUST be byte-identical across two runs over an unchanged file.
Any volatile field — a timestamp above all — MUST be omitted by default,
because a report that differs on every run cannot serve as a baseline,
which is most of what reports are for.

A tool reporting on a file it could not open MUST distinguish that from
a file it read and found errors in. Unreadable is not a finding: a
finding is something the implementation has an opinion about, and it
never got to look.

### 9.6 Reports accompany exports

Every export whose content includes asset references MUST carry a
resolution report naming what was referenced, what resolved, and what
did not. Silently omitting an unresolvable reference is non-conforming.

---

## 10. Extensibility and reserved names

### 10.1 Unknown content

A conforming reader MUST ignore tables, columns, and rows it does not
recognise, and MUST NOT treat their presence as an error.

A conforming writer MUST preserve unknown tables and columns across a
read-modify-write cycle. Data loss on round-trip is non-conforming.

### 10.2 Reserved names

Reserved to this specification, and MUST NOT be used by third-party
extensions:

- every table name defined by the registry, and every name in
  `UUID_EXTRA_TABLES`;
- every column name defined by the registry;
- the root name `@project`, and the root names `@plates` and `@nas`;
- the table-name prefix `scf_`.

### 10.3 Extension namespace

Third-party tables and columns MUST be prefixed `x_`. A name so prefixed
will never be claimed by this specification, and the reference
implementation's linter rejects any registry name that claims it.

A conforming writer MUST preserve `x_` tables, columns and rows across a
write cycle, on the same terms as any other unrecognised content
(§10.1). The distinction is one of intent, not of protection: unknown
content is preserved because it is unknown, whether or not whoever wrote
it followed the convention.

Third-party root names MUST NOT be introduced without registration,
since a root name that later becomes reserved would silently change
meaning.

---

## 11. Versioning and compatibility

### 11.0 When these rules take effect

**This section becomes binding at 1.0.** Before then, files written by
earlier schema versions are disposable: a change may remove a column,
alter a type, or rename a field outright, and no migration path is owed
to anything already written.

The one exception is `fixtures/hollow_creek.scf`, which is a normative
artifact (`conformance.md` §5.1) and is migrated with every change that
would otherwise invalidate it.

This is not a licence to be careless — it is a statement about *when*
the cost of compatibility is worth paying. Before 1.0 nobody has built
on the format, so a deprecation window protects nothing and leaves the
format carrying two descriptions of one fact. After 1.0 someone has, and
every rule below is expensive to violate.

Two changes taken under this clause: schema 2.9 widened
`scene.scene_number` from integer to text, and schema 2.12 removed
`project.scene_numbering` one version after renaming it, without the
window §11.4 would otherwise require.

### 11.1 Schema changes are additive

A schema change MUST be an additive optional field wherever that is
possible. No conforming schema change may require existing files to be
converted.

### 11.2 Forward compatibility

A reader encountering a file with a higher schema version than it knows
MUST read what it recognises and ignore the rest (§10.1). It MUST NOT
refuse the file on version grounds alone.

### 11.3 Backward compatibility

A writer MUST preserve every table, column, and row it did not
originate, including those from a schema version it does not know
(§10.1).

### 11.4 Removal

A field MAY be removed only after being marked deprecated in a released
schema version, and MUST remain readable for at least one subsequent
version.

> **Note.** Several changes so far would not be permissible after 1.0
> and were taken deliberately before it, under §11.0: schema 2.8 removed
> `asset.asset_type` and `asset.file_path` one version after deprecating
> them in 2.7; 2.9 widened `scene_number` from integer to text, which
> SQLite cannot do to a column in place; and 2.12 removed
> `project.scene_numbering` immediately rather than carrying the window
> this section describes.

### 11.5 The specification version

Editorial changes to this document that do not change a requirement
increment the patch component only. Any change to a MUST or MUST NOT is
a minor version at minimum, and MUST be recorded in the specification
changelog.

### 11.6 Document equality

Two SCF documents are **equal** when their canonical dumps are equal.
Equality is never a byte comparison: SQLite reorders pages, reuses
freelist space and changes file size without any row changing, so
byte-different files routinely say the same thing.

A canonical dump is produced by:

- taking every table, sorted by name, **including tables this
  specification does not define** — a dump that skipped unknown content
  could not detect the loss §10.1 forbids;
- sorting each table's rows by `uuid` where the table has one, and by
  their full sorted content where it does not;
- sorting each row's columns by name;
- excluding row ids, which are file-local and are not identity (§6.2);
- excluding `_scf_meta`, whose `updated_at` changes on every save
  without the document changing.

A conforming Writer MUST produce an equal document when it opens a file
and writes it back without editing anything.

---

## Appendix A — Conformance test map

Where a rule is machine-checkable, the test that pins it is named. A
change to one without the other is a defect.

| Section | Pinned by |
|---|---|
| §3.4 derived-but-stored | `scf-app/test/sceneScript.test.ts` |
| §1.2 file identification | `scf-core/test/fileIdentity.test.ts` |
| §2.1 registry structure | `scf-core/test/registrySchema.test.ts` |
| §9.4 finding vocabulary | `scf-core/test/findings.test.ts`, `spec/finding-catalog.json` |
| §4.3 numbering policy and its deprecation window | `scf-core/test/numbering.test.ts` |
| §9.4 finding behaviour on broken files | `scf-core/test/negativeFixtures.test.ts` (11 cases) |
| §9.5 serialised report | `scf-core/test/report.test.ts` |
| §11.1 additive-only schema changes | *unpinned — a policy, checked by review* |
| §11.2–11.3 forward and backward compatibility | `scf-core/test/extensibility.test.ts`, `scf-app/test/roundTrip.test.ts` |
| §11.4 deprecation window | *unpinned — a policy, checked by review* |
| §11.6 document equality | `scf-core/src/canonical.ts`, exercised by `scf-app/test/roundTrip.test.ts` |
| Round-trip integrity (`conformance.md` §3) | `scf-app/test/roundTrip.test.ts` |
| Canonical query expectations (`conformance.md` §5.4) | `scf-app/test/queryExpectations.test.ts`, `fixtures/expectations/` |
| §10.1 unknown-content preservation | `scf-core/test/extensibility.test.ts` |
| §10.2–10.3 reserved namespaces | `scf-core/test/registrySchema.test.ts`, `schema/lint_registry.py` |
| §4.2 scene-number grammar and ordering | `scf-core/test/sceneNumbers.test.ts` — including a case asserting the TypeScript comparison and its SQL twin order the same list identically |
| §4.4 shot codes | `scf-core/test/shots.test.ts` |
| §4.3 pattern 2 | `scf-core/test/conformance.canonical.test.ts` → "persistence rule" |
| §4.3 pattern 3 | `scf-core/test/conformance.canonical.test.ts` → "pattern 3 (latest-wins)" |
| §5 spans | `scf-core/test/structure.test.ts` |
| §6.3–6.4 natural keys | `scf-core/test/junctions.test.ts` |
| §6.5 relationships | `scf-core/test/relationships.test.ts` |
| §7 cascade | `scf-core/test/conformance.canonical.test.ts` → Q07, Q08, Q11 |
| §8.2 identifiers | `scf-core/test/assets.test.ts` |
| §8.3 resolution states | `scf-core/test/assets.test.ts` |
| §8.5 format hint | `scf-core/test/preview.test.ts` |
| §8.6 orphans | `scf-core/test/assetIndex.test.ts` |
| §8.7 metadata | `scf-core/test/fileMetadata.test.ts` |
| §9.4 resolution report | `scf-core/test/mediaReferences.test.ts` |

Sections with no entry are not yet pinned, and two entries above say
*unpinned* on purpose: §11.1 and §11.4 are policies about how the format
is allowed to change, not properties of a file. No test can check that a
future change will be additive; only review can.

The remaining gap is §2 — the registry's own content, as opposed to its
structure (§2.1) and the behaviour derived from it (§2.3, pinned
throughout). See [conformance.md](conformance.md) §5.
