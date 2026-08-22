<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# The SCF Format Specification

**Version 0.34 (draft) — not a release.**
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

All sixteen are specified, each with a published normative result.

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

- **Specification version** — this document. Currently `0.34` (draft).
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

#### 1.3.1 The screenplay tables

The infrastructure tables are published as
[`screenplay-tables.json`](screenplay-tables.json): both lists, each
table's columns with types, nullability and defaults, and what each
table is for. Their columns are not in the registry, because they are
not registry entities, and until 0.30 nothing published them.

**`line_type` is a closed vocabulary of fifteen values, published in
that file.** It is carried by `screenplay_lines.line_type` and
`screenplay_version_lines.line_type`, both of which default to `action`.

A writer MUST NOT store a value outside the published set. A reader
encountering one MUST treat that line as unknown content (§10.1) and
**MUST NOT map it to a value it resembles**. The set is closed and the
resemblance is not a rule: a scene heading is `heading`, and
`scene_heading` is not a synonym for it.

The column is declared `TEXT` and SQLite enforces nothing, so this is a
requirement on implementations rather than a constraint the file can
carry. **No finding is raised for an unrecognised `line_type`**, which
is deliberate and is why the requirement is stated here: story order is
derived from this table (§4.1), so a reader that guesses wrong produces
a wrong answer confidently and in silence. That is not hypothetical — it
is how this subsection came to exist.

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
[ARTIFACTS.md](ARTIFACTS.md). **The manifest covers this document and
the other three specification documents**, so a reader can verify that
the prose it built against is the prose that was published — three
independent implementations have now been written from these files, and
until 0.31 nothing let them confirm they had read the same bytes.

The digests are over raw bytes. A checkout whose working tree converts
line endings will not match, which is a property of the checkout rather
than of the artifacts.

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

When a scene's number changes and `project.numbering_policy` is
`derived`, an implementation MUST restamp each of that scene's shot
codes onto the new number, preserving the ordinal (§4.4.2).

When `numbering_policy` is `fixed`, shot codes MUST be left unchanged
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

Rows that no boundary explains MUST be reported as
`structure.shadow_row_unexplained` (§9.4), and MUST NOT be silently
deleted. Deleting authored data to satisfy a derivation is not a
migration.

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

The natural key of every link entity is published as
[`junction-keys.json`](junction-keys.json). Any implementation that
merges, de-duplicates or validates junctions MUST use those keys.

The keys are derived from the registry — every non-auto-injected
reference field the entity declares, then `entity_type`, `entity_id` and
`domain` where present — and the file records that derivation. It is
published rather than described because an earlier revision cited a
function instead of an artifact, and an independent implementation could
not compute a natural key at all.

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

`lifecycle_status` marks a row as `active` or `cut`.

Where the registry declares it, an implementation MUST preserve it. Of
the thirteen link entities only `actor_character_role` and
`thematic_connection` carry it; the others MUST NOT.

#### 6.6.1 A cut row is not in the film

**A resolver MUST exclude rows whose `lifecycle_status` is `cut`.** The
point of marking something cut rather than deleting it is that it stops
being considered while remaining inspectable — so nothing that answers a
question about the film may see it.

This applies to every derivation in this specification, and the
consequences are meant to reach that far:

- a cut scene has **no story position** (§4.1), takes part in no span
  (§5), and appears in no canonical query result (§12);
- a cut state is in force nowhere (§4.5);
- a cut row contributes no layer to a cascade (§7.3);
- a cut link joins nothing.

A cut scene MAY still carry its heading in the screenplay — a cut scene
in a real script is struck through, not deleted. An implementation that
derived story order from headings alone would resurrect it, and MUST
NOT.

Because a cut row is excluded everywhere, **adding one to a file changes
no answer.** That is the test of a conforming implementation, and the
conformance fixture is built to make it: it carries a cut scene, with a
heading, and a cut performance beat in its most heavily asserted scene.

#### 6.6.2 Reading what was cut

Excluding cut rows from resolution is not hiding them. An
implementation MAY offer a view that reads them back — a cut list, an
audit trail, a history panel — and SHOULD keep that path distinct from
the resolvers, so that the two cannot be confused at a call site.

Row identity survives being cut (§6.1): a cut row keeps its uuid, and
restoring it restores the same row rather than creating a new one.

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
- `source` — identifies the file reported on, never its contents.
- `counts` — how many findings were raised at each severity of §9.4.
  **Every severity is a key, including those with a count of zero**, so
  a consumer never has to distinguish an absent key from a zero.
- `clean` — **true when `counts.error` is zero**, and false otherwise.
  It is a restatement of the error count, not a second judgement:
  warnings and info findings do not affect it. **`clean` does not mean
  "no findings"**, and it never means the file was accepted or refused
  — §9.1 leaves that to the consumer. It says only that no two
  conforming readers would disagree about what this file says.
- `findings` — the findings, in §9.4's order.

Each finding carries:

| | |
|---|---|
| `code`, `severity` | From the catalog (§9.4). |
| `title` | The catalog's one-line title for the code, so a report reads without one. Carried on the finding rather than looked up, because a report is read where the catalog is not. |
| `table` | The table the finding is about, or **null** where it is file-wide. |
| `rowIds` | The rows at fault. |
| `message` | One sentence, written for a person. **MUST NOT be parsed** — `code` is the machine-readable answer. |
| `count` | How many occurrences this finding stands for. |
| `spec` | The section of this document the finding derives from. |

**`rowIds` is an array and MAY be empty.** It is empty when the finding
is about a table or the file rather than about particular rows, and
carries several ids when the finding is inherently about a set — two
rows sharing a key, a contradictory pair. **An empty `rowIds` is not an
absence of evidence**, and a consumer MUST NOT treat it as one; `table`
and `message` locate a finding that no single row is at fault for.

**`rowIds` carries bare row ids, and this is the one place in SCF where
that is correct.** §6.2 and §12.1.2 forbid them in a query result
because a result travels and describes a story. A report does not
travel: it names one file, in `source`, and its whole purpose is to send
a person to a row in that file. Publishing uuids instead would be
useless at exactly the moment the report is read.

**`count` is an occurrence count, not a row count**, and the two differ
routinely: a finding standing for one duplicated uuid across two rows
has a `count` of 1 and two entries in `rowIds`. A finding MUST NOT be
raised more than once for the same condition on the same table — that is
what `count` is for — and `count` is **1** for a finding that stands for
a single occurrence, never 0.

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

## 12. The canonical queries

### 12.0 What this section is

The sixteen canonical queries are part of the format. They can be
reinvented from §1–§11, but the point of SCF is to describe a film's
structure, and shipping the questions is that description. Defining them
does not preclude anyone asking others.

**All sixteen are specified below**, each with a normative result
published in `fixtures/expectations/`. The rendered markdown in the same
directory is a convenience and is not a contract for any of them.

### 12.1 What a query returns

#### 12.1.1 The result envelope

Every canonical query returns:

| Field | |
|---|---|
| `query` | The query's id, e.g. `"Q05"`. |
| `resultFormat` | Version of this envelope, on its own track. A field added here is not a change to SCF. |
| `schemaVersion` | The schema the answering implementation read. |
| `parameters` | What was asked. A parameter identifying a ROW is its **uuid**; a literal parameter — a query id, an enum value — appears as itself. **A row id MUST NOT appear**, so no parameter is a bare number. |
| `result` | The query's own structure, defined per query below. |

`parameters` makes a result self-describing: a reader handed one can
tell which question it answers without being told.

#### 12.1.2 Rows in a result

**The normative answer is the result structure. Any rendering of it —
markdown, HTML, prose — is a convenience and is NOT normative.** Two
implementations that produce the same result and print it differently
are both conforming.

**The projected row.** Wherever a result carries a row, it carries an
object with exactly two members:

| Member | |
|---|---|
| `uuid` | The row's identity (§6.1), or **null** when the row carries none. |
| `fields` | An object holding that row's values under the registry's own column names. |

Both members are ALWAYS present, and `fields` is present even when it
holds nothing, as `{}`. A row with nothing authored is a row that
exists, and collapsing it to null would say something else.

**Nothing else appears beside them.** A projected row is not a place to
hang a derived value, because a consumer walking `fields` has to be able
to assume that every name in it is a registry column. Values a query
computed are §12.1.4's business, and belong next to the projected row
rather than inside it.

The shape is nested rather than flat so that identity and content never
share a namespace: in a flat shape a registry that one day declared a
column named `uuid` would overwrite the row's identity, and nothing
would notice.

**What `fields` contains:**

- **Row ids MUST NOT appear.** They are local to a file (§6.2) and a
  writer may renumber them. A result carrying one describes the file
  rather than the story.
- `id`, `created_at` and `updated_at` MUST be omitted. They differ
  between two files that say the same thing.
- **A value that is null, absent, or the empty string MUST be omitted**,
  so absence is unambiguous. **Zero and `false` are values, not
  absences**, and MUST be kept — a `false` dropped as empty would be
  read back as unauthored.
- A column holding JSON is carried **as stored**, as the column's text,
  unparsed. The registry declares a column's type, not a schema for its
  contents, so a parsed value would be one implementation's reading of
  an opaque string rather than the value the file holds.
- **Reference columns MUST be resolved to uuids**: `scene_id` becomes
  `scene_uuid`, carrying the referenced row's uuid. A reference that
  cannot be resolved is omitted.
  **Which columns are references is declared by the registry**
  (`referenceEntity`, §2.3) and MUST be derived from it. An
  implementation maintaining its own list will project a column in one
  query and drop it in another, and nothing will notice.
- Field names are the registry's own column names. A result is made of
  registry fields; a second vocabulary for them would be a second thing
  to keep in step.

**Any remaining column whose name ends `_id` MUST be dropped.** This is
the rule for a **polymorphic reference** — a column such as
`motif_appearance.entity_id` or `thematic_connection.entity_id`, whose
target entity is named by a sibling column at run time and which
therefore carries no `referenceEntity` for the previous rule to act on.
Dropping it is not a loss of information but a refusal to publish a row
id under a name that looks like content. The sibling column naming the
kind — `entity_type` — is an ordinary stored value and is kept.

**Where a query needs the target itself, it MUST resolve it and carry it
beside the projected row, never inside it.** §12.11 is the worked
example: Q10 keeps `entity_type` in the connection's `fields`, drops
`entity_id`, and publishes `targetEntity`, `targetUuid` and `targetName`
as members of the carrier record. A polymorphic reference whose kind is
not a registry entity, or whose row is absent, resolves to a null
`targetUuid`; that is a legitimate answer and not a finding (§9.2).

**A result MUST NOT contain a cut row** (§6.6.1). It carries
`lifecycle_status` on the rows it does contain, because an
implementation may legitimately mark something cut between one answer
and the next, and a consumer holding a result should be able to see what
it was told.

#### 12.1.3 Composition

An earlier note recorded a decision that a composite query's result
would **nest** the result bodies of the queries it is built from. That
decision has not been applied, because the premise was wrong: no
canonical query calls another. What look like composites assemble their
own answers from the same resolvers, and Q01 and Q02 share a helper
rather than a result.

So each query defines its own result shape. Where two queries genuinely
share a composition — as Q01 and Q02 do — the shared part is one
function in one place, and both results state the same structure for it.
Nesting remains available where a query genuinely is built by calling
another, and carries the inner `result` body without its envelope.
**Exactly one query does this**: Q02's media layer is Q13's answer at a
position (§12.16), and it carries Q13's result body with the query it
came from named.

#### 12.1.4 Values that are not rows

Not every member of a result is a projected row, and the difference is
normative, because the two obey **opposite rules about absence**.

A **derived record** is an object a query composes rather than reads. It
mixes values drawn from several rows with values a resolver computed, so
no single registry column set describes it. §12.8's `references` entries
are the clearest case: the asset's `identifier` comes from the asset
row, `anchorName` from the link that reached it, `state` and `detail`
from the resolver, and `sizeBytes` from the filesystem.

**A derived record has a fixed member set, declared by the query's
section below, and every declared member MUST be present. An absent
value is carried as null and MUST NOT be omitted.** §12.1.2's
omit-empties rule does not apply here and MUST NOT be applied to it.

The asymmetry is deliberate. In a projected row, an absent field means
"not authored", and a consumer can discover which fields could have been
there by reading the registry. A derived record has no registry to ask,
so an omitted member and a member that legitimately has no value would
be indistinguishable, and a consumer could not tell a reference with no
role from a reference whose role it failed to parse. This is why
`"role": null` appears in a published Q13 result while an unauthored
`role` on a projected row is simply gone.

A **label list** is an array of bare strings naming rows the result does
not carry — §12.1.5.

A **scalar** — a count, a boolean, a threshold — is itself. Where a
scalar is a **judgement rather than a fact**, the query MUST publish
whatever produced it alongside it, so a consumer can see the basis
instead of inferring it: §12.10 requires `densityThreshold` beside
`dense` for exactly this reason.

#### 12.1.5 Vocabularies and label lists

Every string in a result is one of three things, and each query's
section below MUST say which of the three each of its strings is:

| | |
|---|---|
| **A stored value** | Carried through from a column. Its vocabulary, where it has one, is the registry's, and this section adds nothing to it. |
| **A closed vocabulary** | A fixed set of strings **this specification** defines and a conforming implementation MUST produce exactly. Adding a member is a change to this specification. |
| **A label list** | An array of bare strings, each the `name` of a row the result does not otherwise carry. |

The closed vocabularies of §12 are: the resolution states of §8.3, as
they appear in §12.8's `state` and in every `counts` keyed by them; the
readiness severities of §12.9; and §12.8's `provenance`. There are no
others. A string not covered by one of them is a stored value or a label
and is named as such where it appears.

**A label list is a convenience, not an identity.** A bare name cannot
be resolved back to a row — two rows may carry the same one, and a name
may be edited without the thing it names changing. **A consumer needing
identity MUST ask the query that carries the rows themselves**, which
for §12.5's lists is §12.4 at either position.

They exist because the queries that use them are **diffs**, and a diff
whose two sides are full projections is unreadable at the moment a
person most wants to read it. Where a query carries a label list, its
section below MUST name the column the labels are taken from.

#### 12.1.6 Order within a result

**Every array in a result is ordered, and each query's section below
states the order for each of its arrays.** An array whose order is not
stated there is in **story order** (§4.1). Nothing in a result is in row
order, which is a fact about the file rather than the story.

**Member order within an object is not part of the answer.** Results
compare as JSON values, not as bytes, on the same reasoning as §11.6.
An implementation MAY serialise members in any order and remain
conforming.

The **published artifacts** are nonetheless serialised to a fixed order
so that they diff cleanly and can be regenerated and checked byte for
byte: envelope members in the order §12.1.1 lists them, `fields` keys
ascending by code point. That is a property of the artifacts, not a
requirement on an implementation, and conformance is never a byte
comparison against them.

### 12.2 Q05 — Voice direction

**How this character's lines should sound in this scene.**

Parameters: `character`, `scene`.

The result composes three things a consumer would otherwise have to
assemble: the character's standing description, whatever is temporarily
true of them here, and anything authored line by line.

| Field | |
|---|---|
| `modality` | `"vocal"`. Q06 is the same query with `"physical"`. |
| `baseline` | The character's `vocal_profile`, projected per §12.1.2, or **null** when none is authored. |
| `states` | `performance_state` rows of this modality in force at this scene, resolved by §4.5 pattern 2, **oldest first**. |
| `modulations` | The states' `modulations` merged oldest-first, so a later state overrides an earlier one key by key. Derived; carries no identity. |
| `beats` | `performance_beat` rows for this character, scene and modality, in `beat_order` then row order. |

A null `baseline` is a well-defined absence, not an error (§9.2). It is
what a readiness report exists to warn about — the fixture leaves one
character deliberately thin for that reason.

`modulations` is a merge of an opaque JSON column. Where two states
carry the same key, the later one wins; §4.5's "field by field" means
keys within that object.

### 12.3 Q07 — Look resolution

**What a frame in this scene, or this shot, should look like.**

Parameters: `scene`, and `shot` — optional.

| Field | |
|---|---|
| `leaf` | The cascade's leaf entity (§7.1). |
| `layers` | Root first, each `{ entity, row }`, the last being the opinion in force (§7.4). |

#### 12.3.1 The leaf depends on the parameters

| Given | Leaf |
|---|---|
| scene only | `scene_color_palette` |
| scene and shot | `shot_design` |

This is what §7.1 means by the leaf not being derivable from the data:
it is a property of the question. A conforming implementation MUST use
the leaf this table gives, and MUST resolve the chain by §7.2's
`refines` closure — not by any ordering of `scope`.

#### 12.3.2 Layers

Each layer is one entity's contribution, selected by §7.3. An entity in
the chain that supplies no row is **absent from `layers`**, not present
and empty.

`layers` MAY be empty. A scene with no authored look is a legitimate
answer and not a finding.

### 12.4 Q03 — World state

**Everything true at one position.**

Parameter: `scene`.

| Field | |
|---|---|
| `scene` | The scene itself, projected. Null when the position does not resolve — including when the scene is cut (§6.6.1). |
| `characters` | Each character present, with `states` in force there (§4.5) and the `costumes` they are wearing. |
| `props` | Each prop present, with its `state` at this position by pattern 3, or null where none is yet established. |
| `motifs` | Motif appearances at this position: name and domain. These come from a join rather than a table and carry no identity of their own. |

Presence is authored, not inferred: a character appears because a
`scene_character` link says so, not because a state mentions them.

A cut scene answers as an empty position rather than an error (§9.2):
`scene` null, and no characters, props or motifs.

### 12.5 Q12 — Continuity

**What changed between two positions.**

Parameters: `from`, `to`.

| Field | |
|---|---|
| `from`, `to` | The two scenes, projected. |
| `characters` | Each character present at either position, projected, with `statesFrom` and `statesTo`. |
| `relationships` | Each relationship with a stage at either position, projected, with `stageFrom` and `stageTo`. |
| `props` | Each prop with a state at either position, projected, with `whereFrom` and `whereTo`. |

A row appears when it has something to say at **either** position, so an
appearance and a disappearance are both visible.

**The paired members are labels, not rows** (§12.1.5), and each names
the column it is taken from:

| Member | Kind | Taken from |
|---|---|---|
| `statesFrom`, `statesTo` | Label list, resolved by §4.5 pattern 2, **oldest first** | `character_state.name` |
| `stageFrom`, `stageTo` | A single label, or **null** where no stage is in force | `relationship_state.stage_label` |
| `whereFrom`, `whereTo` | A single label, or **null** where no state is in force | `prop_state.whereabouts` |

Each is a derived record member under §12.1.4, so a null is carried
rather than omitted. **A consumer needing the state rows themselves MUST
ask §12.4 at either position**, which returns them projected.

**The two positions are ordered by §4.1, never by their scene numbers.**
Under `fixed` numbering a scene numbered 16 may play after one numbered
19, and diffing them by number resolves every pattern-2 and pattern-3
state at the wrong position. The conformance fixture is built so that
this is not hypothetical: its blessed Q12 result diffs 19 → 16, which is
forward in the script and backward by number.

### 12.6 Q06 — Physical direction

**How this character moves and behaves in this scene.**

Q05 with `modality` `"physical"`. Same parameters, same result
structure, different content. It is one definition rather than two
because two would be two places for the shape to change.

### 12.7 Q08 — Soundscape

**What this scene sounds like.**

Parameter: `scene`. **No shot.** Sound is authored at the scene, and
there is no shot-level sound entity to be a leaf (§7.1), so `shot` is
always null in the envelope. That is stated rather than left for an
implementer to discover by finding nothing.

Leaf: `scene_music_design`. Result structure as §12.3.

### 12.8 Q13 — Media resolution

**Which assets are in force for a subject and an intent.**

Parameters: `subject` — a character, prop or location — plus `scene` and
`shot`, both optional. `intent` and the subject's kind are literals and
appear in the result rather than the envelope.

| Field | |
|---|---|
| `subject`, `intent` | What was asked, as literals. |
| `trail` | The resolution trail, **broadest first**, matching §7.4's root-first convention. |
| `references` | Each asset in force, **most specific first** — shot overrides, then anchors, then bundles. |
| `counts` | References per resolution state, keyed by §8.3's states. Every state is a key, including those with a count of zero. |
| `rootMapped` | Whether the session had a root mapping at all. |

**A reference names its asset by uuid**, never by row id (§12.1.2).

**Each reference is a derived record** (§12.1.4), not a projected row.
Its members are fixed, and one absent is carried as **null**:

| Member | Kind | |
|---|---|---|
| `uuid` | Identity | The asset's own uuid, taken from the asset row. Never resolved from a row id — see below. |
| `name`, `identifier`, `format` | Stored values | From the asset. |
| `role` | Stored value | `asset_bundle_item.role_in_bundle` where the cascade reached this asset through a bundle. Free-form; the registry constrains it, this section does not. Null otherwise. |
| `anchorName` | Stored value | `entity_anchor.name` where the reference came from an anchor. Null otherwise. |
| `intent` | Literal | Echoes the `intent` asked for. |
| `provenance` | **Closed vocabulary** | Which layer put this reference in force: `shot override`, `anchor`, `bundle`. |
| `state` | **Closed vocabulary** | The resolution state, §8.3. |
| `detail` | Prose | Why, for anything not `resolved`. Written for a person and **MUST NOT be parsed**; `state` carries the machine-readable answer. Null when `state` is `resolved`. |
| `sizeBytes` | Number | Read from the resolved file. Null unless `state` is `resolved`. |

**An asset appears at most once.** The layers are walked most specific
first and an asset already carried is skipped, so `provenance` names the
**strongest** layer that reached it rather than every layer that did. An
asset both overridden at the shot and present in the bundle appears once,
as `shot override`. Reporting it twice would make `counts` disagree with
the number of distinct assets a consumer has to fetch.

**`trail` and `references` run in opposite directions**, and both are
deliberate: the trail reads as an explanation, broadest first, the way
§7.4 returns a cascade; the references read as an answer, most specific
first, so the opinion in force is at the top.

**An anchor contributes the asset it anchors**, not itself. An
`entity_anchor` row names a place in an asset — a face, a frame, a
region — and carries no identifier of its own, so reporting the anchor
row as the reference would produce something that can never resolve.
The reference carries the asset's identity and the anchor's name in
`anchorName`.

`rootMapped` is a fact about the SESSION, not the file. With no root
mapping every reference is `unaddressed` (§0.3, §8.3) — not
`out-of-root`, which is a property of an identifier. A result reporting
zero resolved references and `rootMapped: false` is describing a
perfectly healthy file that nobody has pointed at a folder.

**A result carries references, never bytes** (§8.1).

### 12.9 Q14 — Readiness

**What is missing for another query to answer well.**

Parameters: `target` — the query being assessed, a literal — plus
`character`, `scene` and `shot` as the target needs them.

| Field | |
|---|---|
| `target`, `targetName` | The query assessed. |
| `findings` | Each with `severity`, the `entity` it concerns, and a message. |
| `counts` | Findings per severity. |

#### 12.9.1 The rubric

What Q14 assesses is published as
[`readiness-rubrics.json`](readiness-rubrics.json). Each rubric names a target query and the things it depends on, each
marked `required`, `recommended` or `optional`.

A step's `label` is **prose, not a registry entity name** — several name
two entities, a filtered subset, or a pattern. `requirement` is the
machine-readable part. Making the labels resolve against the registry is
outstanding work and is tracked in [stability.md](stability.md); until
it is done, a conforming implementation can reproduce a rubric's
severities but must interpret its labels the way a person would.

A conforming implementation MUST draw its findings from that file, and
MUST map requirement to severity as the file states:

| Step | If absent | If present |
|---|---|---|
| `required` | `blocker` | `ok` |
| `recommended` | `warning` | `ok` |
| `optional` | `suggestion` | `ok` |

**Only some queries have a rubric.** A query with a generative or
pre-flight consumer — one you act on before shooting or rendering — has
readiness semantics of its own. An analytic query reads whatever exists
and has none beyond the walkable queries it is built from; asking Q14
about one is answered by assessing those.

Until this file was published, §12.9 defined the envelope and the
severity scale and nothing about what was assessed, and an independent
implementation correctly declined to claim anything for the rubric it
had to invent.

**`findings` includes `ok` entries.** Q14 is a rubric, not a problem
list: it reports what is present as well as what is missing, so a
consumer counting findings would read it backwards — a thin subject can
produce FEWER findings than a well-authored one, because fewer things
are there to be reported on at all. **Severity carries the answer.**

Readiness severity is its own scale — `blocker`, `warning`,
`suggestion`, `ok` — and is not the finding-vocabulary severity of §9.4.
That vocabulary answers whether a file is well-formed; this answers
whether a query can be answered well from it, and §9.4 forbids
conflating them.

### 12.10 Q09 — Motif manifest

**Which motifs should be perceivable in this scene, and how.**

Parameter: `scene`.

| Field | |
|---|---|
| `scene` | The scene, projected. |
| `manifest` | Each motif placed here: the `motif`, its `appearance` at this position, and its evolved `state` there by pattern 3 (§4.5). |
| `candidates` | Motifs related to something placed here that are **not** placed here, projected. |
| `dense` | Whether the manifest exceeds the density threshold. |
| `densityThreshold` | The threshold that produced `dense`. |

**Related means one hop along `motif.related_motif_id`**, and nothing
else. A motif is a candidate when some motif in `manifest` points at it
through that column and it is not itself placed in this scene. **The
relation is followed exactly once and is not transitive**: a motif
reached only through another candidate is not a candidate. A closure
would grow with the project until the list stopped being an aid to
judgement, which is the only thing it is for.

`candidates` carries **each motif once**, in the order the manifest
first reaches it. `manifest` is in the row order of the appearances at
this scene.

A **candidate is not an obligation.** It is a related motif absent from
this scene, offered because a placement decision is easier to make when
you can see what is adjacent to it. Nothing is wrong with a scene that
places none of them.

`dense` is a **heuristic, not a finding** (§9.1). A result MUST publish
the threshold alongside the flag, so a consumer can see what produced it
rather than inferring a number from a count. A different implementation
MAY use a different threshold and MUST say which.

### 12.11 Q10 — Thematic accounting

**Where a theme lives across the whole story, and where it does not.**

Parameter: `theme`. This is the first query whose answer spans the
entire spine rather than a position.

| Field | |
|---|---|
| `theme` | The theme, projected. |
| `carriers` | Each `thematic_connection` projected, plus `targetEntity`, `targetUuid`, `targetName` and `sceneUuids` in story order. |
| `spine` | **Every scene in story order**, each with the number of carriers reaching it. |

**The zeroes are the point.** A spine listing only the scenes a theme
reaches could not answer the question this query exists for, which is
where the theme is absent. A conforming result MUST include every scene,
carriers or not.

The spine is in **story order** (§4.1), never scene-number order, and
excludes cut scenes (§6.6.1). A carrier reaching a cut scene reaches
nowhere, so its `sceneUuids` and the spine's counts agree.

**`thematic_connection.entity_id` is polymorphic**, so §12.1.2 drops it
from the projected connection and this query resolves it into the three
`target*` members beside it. `entity_type` stays in the connection's
`fields` as an ordinary stored value. A connection whose `entity_type`
is not a registry entity, or whose row is absent, carries a null
`targetUuid` and `targetName` and reaches no scenes.

How a carrier reaches scenes depends on what it points at: a scene
carries the theme at itself; a motif carries it wherever it appears; a
character carries it wherever they are present. A carrier pointing at
anything else reaches no scenes, which is a legitimate answer and not a
finding.

### 12.12 Q00 — Brief

**What film is this, and what are its rules.**

No parameters. The only canonical query with an empty envelope.

| Field | |
|---|---|
| `layers` | The project-level entities, **broadest first**, each `{ entity, row }`. |
| `themes` | Every theme in the project. |

The layer list is an editorial choice about what a brief *is*, not a
fact the registry knows, so it is fixed by this section rather than
derived: `project`, `project_vision`, `project_tone`, `visual_identity`,
`project_color_palette`, `cinematographic_philosophy`, `sonic_identity`,
`look_development`, `costume_design_philosophy`, `technical_specs`.
Adding one is a change to this section.

An unauthored layer is **absent** from `layers`, not present and empty.

### 12.13 Q11 — Audience state

**What the audience knows and should feel at a position.**

Parameter: `scene`.

| Field | |
|---|---|
| `scene` | The scene, projected. |
| `information` | The information strategy here, or null. |
| `identification` | The identification strategy with its primary and secondary characters, or null. |
| `emotionalBeats` | Each beat with the arc it belongs to. |
| `toneMarkers` | Tone markers at this position. |
| `emotionalCascade` | The direction cascade for leaf `scene_emotional_design`, root first (§7). |

Every one of these may be absent, and absence is **null or empty, never
invented** (§9.2). A scene with no authored audience design is a
legitimate answer.

A file that does not contain one of these tables yields nothing for it
rather than failing — an older file predating an entity is not an error.

### 12.14 Q15 — Provenance

**Why is this value what it is, and who touched it.**

Parameters: `entityType` — a literal — and `row`.

| Field | |
|---|---|
| `entityType`, `row` | The row asked about. |
| `versionChain` | The row's version chain, **oldest first**, walked back to the root and then forward. Empty when the entity is not versionable. |
| `attached` | `creative_decision` and `collaboration_note` rows that mention this row. |

Walking the chain MUST terminate on a cycle rather than following it
(§9.2). A cycle is a finding (`identity.chain_cycle`), not a reason to
hang.

**Attachment is matched permissively.** `affected_entities` is
free-form and may hold a JSON array, a JSON object, or prose, so an
implementation MUST accept the conventions `entity:id`, `entity#id`, a
bare `entity`, and an object carrying an entity kind with an optional
id. A provenance trail that silently omitted a note would be worse than
one that included a doubtful one — §9.1, SCF describes.

### 12.15 Q01 — Subject dossier

**Everything about a subject, before any scene bends it.**

Parameters: `subjectType` — a literal — and `subject`.

| Field | |
|---|---|
| `subjectType`, `subject` | The subject and its kind. |
| `groups` | Entities authored about this subject, each `{ entity, rows }`. |
| `motifCarriage` | Motif appearances that name this subject, with the motif. |
| `thematicConnections` | Thematic connections that name it. |

**`groups` is derived, not listed.** A group is any entity whose
registry `subject` is this kind, at `scope: global`, carrying a
reference back to it. Adding a new entity about characters puts it in
every character's dossier with no change here — which is what `subject`
and `scope` are for (§0.7).

A group with no rows is omitted rather than carried empty.

### 12.16 Q02 — Subject in context

**Everything needed to realise a subject in a scene, and optionally a
shot.**

Parameters: `subjectType`, `subject`, `scene`, and `shot` — optional.

| Field | |
|---|---|
| `subject`, `scene` | Projected. |
| `dossier` | Q01's result body — what is true of the subject before this scene. |
| `costumes`, `relationshipStates`, `performanceStates`, `beats` | For a character subject. |
| `locationVariant` | For a location subject: the variant in force and any mismatches. |
| `propState` | For a prop subject. |
| `media` | **Q13's result body**, with `fromQuery: "Q13"`. |

**Fields that do not apply to a subject's kind are null or empty, never
omitted.** A consumer must be able to tell "not applicable here" from
"unauthored", and an absent key says neither.

This is the one query built by calling another (§12.1.3). The media
layer carries Q13's body without its envelope: an envelope inside an
envelope would let an inner `resultFormat` disagree with the outer one.

### 12.17 Q04 — Scene package

**The complete context for a scene, as a unit of work.**

Parameter: `scene`.

| Field | |
|---|---|
| `scene` | Projected. |
| `lineage` | Act and sequence, **broadest first**. |
| `storyBeats` | In `beat_order`. |
| `cast`, `props` | Present by authored link, not inference. |
| `location`, `locationVariant` | The location and the variant in force, with mismatches. |
| `detail` | Scene-level design entities, each `{ entity, rows }`, empty groups omitted. |
| `blocking`, `stagingBeats` | Staging, beats in `beat_order`. |

The `detail` list is fixed by this section rather than derived — what
belongs in a scene package is an editorial choice, as Q00's layer list
is: `scene_emotional_target`, `scene_color_palette`, `lighting_design`,
`scene_music_design`, `dialogue_sound_design`, `set_dressing`,
`tone_marker`.

Q04 does **not** nest Q03 or Q07 despite covering some of the same
ground. It assembles its own answer, and §12.1.3 explains why that is
described rather than changed.

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
| §4.1 resolution agrees with story order | `scf-core/test/conformance.canonical.test.ts` |
| §6.6 cut rows excluded everywhere | `scf-core/test/conformance.canonical.test.ts`, `scf-core/test/lifecycle.test.ts` |
| §12.1 result envelope and row projection | `scf-core/test/canonicalQueries.test.ts` |
| §12.2–12.17 — all sixteen queries | `scf-core/test/canonicalQueries.test.ts`, `fixtures/expectations/*.result.json` |
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
