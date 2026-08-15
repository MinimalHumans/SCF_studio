# SCF conformance

Companion to [scf-spec.md](scf-spec.md). This document defines what it
means to claim SCF support, so that the claim carries information.

**Status: draft, incomplete.** Sections marked *not yet specifiable*
depend on work tracked in [stability.md](stability.md). They are named
here rather than omitted, so the gaps are visible.

---

## 1. Why roles

"Supports SCF" is not a useful claim. A production tracker that reads
scene and character data has nothing in common with an editor that
maintains spans, cascades and identity across edits — and requiring the
tracker to implement span anchoring in order to say it reads SCF would
guarantee that nobody says it.

So conformance is claimed **per role**. Three exist, each a strict
superset of the one before.

---

## 2. The roles

### 2.1 Reader

**Claim:** *reads SCF 1.0.*

A Reader opens a `.scf` and answers questions about it. It does not
write.

A conforming Reader MUST:

- open any SQLite file carrying the SCF table set, without requiring
  `application_id` or `user_version` (spec §1.2);
- tolerate missing registry columns and unknown tables (§1.3, §1.4,
  §10.1);
- derive rather than read every value listed in §3.2;
- order scenes by story order, with the full fallback chain, and never
  by `scene_number` alone (§4.1);
- apply the position pattern the registry declares for each entity
  (§4.3);
- derive span membership from start boundaries (§5.1) and treat
  `scene_sequence` rows as potentially stale (§5.4);
- read relationships from both character columns (§6.5);
- resolve direction root-first, most specific last, and report every
  contributing layer (§7);
- return a usable answer on half-placed, dangling and contradictory
  data, and report the problem separately (§9.2);
- treat a `cut` row as present, pending §6.6.

A conforming Reader MUST NOT:

- match rows across files by uuid (§6.2);
- rely on `screenplay_lines.scene_id` (§3.4);
- reject a file whose schema version is higher than it knows (§11.2).

**Assets are optional for this role.** A Reader that does not resolve
assets MUST report every asset as `unaddressed` (§8.3) rather than
`missing`.

### 2.2 Writer

**Claim:** *reads and writes SCF 1.0.*

Everything required of a Reader, plus:

- backfill missing uuids on open (§6.1);
- add missing registry columns rather than refusing the file (§1.4);
- preserve every table, column and row it did not originate, including
  from a schema version it does not know (§10.1, §11.3);
- never store a value §3.2 requires to be derived;
- never rewrite an authored `shot.shot_number`, except when the shot
  moves to a different scene (§3.3);
- never recompute numbering on a file whose `project.scene_numbering` is
  `fixed` (§4.2);
- report duplicate natural keys rather than rejecting them (§6.4);
- never create a prop by automatic acceptance (§9.3);
- carry a resolution report on any export containing asset references
  (§9.4);
- never embed asset bytes (§8.1).

**The defining test for this role is round-trip integrity:** open, save,
and lose nothing. See §3.

### 2.3 Editor

**Claim:** *authors SCF 1.0.*

Everything required of a Writer, plus maintenance of derived state
across edits:

- re-derive story order, span membership and cascades after any edit
  that could change them;
- apply the ownership rule when deleting a scene — rows owned by it are
  deleted, rows pointing at it keep identity with the reference cleared,
  and span start anchors are re-anchored first (§2.3);
- keep `scene_sequence` shadow rows consistent at commit, and report
  rows no boundary explains (§5.4);
- assign identity explicitly on any operation that creates or destroys
  rows, rather than inferring it from text editing (§9.3).

The reference editor (`scf-app`) is the only implementation claiming
this role.

---

## 3. Round-trip integrity

The Writer claim rests on one property: **a read-modify-write cycle
loses nothing.**

*Not yet specifiable in full.* What is settled:

- unknown tables, unknown columns and rows the writer did not originate
  MUST survive (§10.1);
- uuids MUST be stable across the cycle for every row that was not
  edited (§6.1);
- authored `shot_number` values MUST survive (§3.3);
- scene numbering MUST survive on a `fixed` file (§4.2).

What is not settled: whether byte-level equality of the SQLite file is
ever expected (it is not — page layout is not normative), and therefore
what the comparison is performed *on*. The likely answer is a canonical
row dump per table, ordered by uuid, but no such dump format exists yet.

**There is currently no round-trip test.** This is the largest hole in
the conformance story, and it is the one place a Writer claim would most
plausibly fail today.

---

## 4. The validator

*Not yet built.* Tracked as `scf-check`.

A validator takes an arbitrary `.scf` and reports findings without
opening the reference editor. It is what turns a conformance claim from
an assertion into something a third party can test.

Intended scope, in order of value:

1. schema version, and whether the file carries `application_id` /
   `user_version` (§1.2);
2. tables and columns present that the registry does not define — a
   report, not an error (§10.1);
3. dangling references;
4. duplicate natural keys, and whether the duplicates agree (§6.4);
5. relationship findings, all seven cases (§6.5);
6. structural findings — spans with no boundary, boundaries on deleted
   scenes, two acts on one scene, shadow rows no boundary explains
   (§5.5);
7. asset resolution tally by state, given a root mapping or none (§8.3);
8. orphaned assets (§8.6);
9. identity findings — missing uuids, uuid collisions within a table
   (§6.1).

Most of this exists already as library code — `identity.ts`,
`resolution.ts`, `assets.ts`, `relationships.ts`, `junctions.ts`,
`structure.ts`, `assetIndex.ts`. What is missing is a CLI over it and a
stable output format.

**Blocked on:** the finding vocabulary. Findings today are produced by
several modules with no shared codes, no severities and no serialised
form. A validator whose output cannot be diffed between runs is a
demonstration, not a tool. See [stability.md](stability.md).

---

## 5. Test artifacts

### 5.1 The fixture

`fixtures/hollow_creek.scf` is not sample data. It is a normative
artifact: several of its properties are asserted by the conformance
suites and MUST NOT change.

- **Scene numbers have gaps** (1, 3, 7, 9, …). Suites address scenes by
  number.
- **Scene 12 is pinned** — its motif manifest, its single sound cue, its
  costume set and its direction chains are asserted exactly. Nothing may
  be added to it.
- **Marcus's vocal profile is deliberately thin and his voice bundle
  deliberately absent** — the readiness suite asserts Q05 warns about
  exactly those gaps. The absence is part of what the fixture
  demonstrates.
- **Shot 12-04 keeps a production numbering scheme** the derived code
  disagrees with, demonstrating §3.3.
- **A second, narrowly carried theme** exists so Q10's gap reporting has
  something to report.

Rebuild scripts: `fixtures/build/`.

### 5.2 The suites

| Suite | Covers |
|---|---|
| `conformance.canonical.test.ts` | The canonical query semantics — persistence, latest-wins, the cascade. |
| `conformance.readiness.test.ts` | Findings on deliberately incomplete data. |

These test the reference implementation against the fixture. They do not
test an arbitrary file, which is what §4 is for.

### 5.3 Negative fixtures

*Do not exist.* The fixture contains authored **absences**; it contains
no authored **errors**. Nothing currently pins what a conforming
implementation should report when a file is wrong.

Needed, at minimum: dangling references, duplicate natural keys that
disagree, a relationship pair entered both ways, a span boundary on a
deleted scene, an asset identifier containing `..`, and a file carrying
an unknown table.

### 5.4 The canonical query expectations

*Not yet data.* Query expectations live inside test code, which means a
second implementation must port TypeScript rather than read a file. §10
of the design record has named this since before there was a spec.

Making them data — expected results per query per fixture position — is
the single change that would most reduce the cost of a second
implementation.

---

## 6. Claiming conformance

*Not yet specifiable.* There is no self-certification form, no
registry of implementations, and no test binary to run.

When there is, the shape is expected to be: run `scf-check` against the
fixture and against your own output, publish the report, state the role
claimed and the specification version.

Until then, no third party can claim conformance in a way that means
anything, and this section is the honest statement of that.

---

## 7. Current status

| Implementation | Role claimed | Basis |
|---|---|---|
| `scf-core` | Reader | The canonical and readiness suites pass against the fixture. Round-trip untested. |
| `scf-app` | Editor | The app suite passes. Round-trip untested; unknown-content preservation untested. |
| — | Writer | No independent implementation exists. |

There is no second implementation. Until there is, every rule in the
specification is guaranteed only to be implementable in the way it was
already implemented, which is the weakest form of that guarantee.
