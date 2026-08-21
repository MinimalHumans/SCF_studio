# SCF stability tiers

Companion to [scf-spec.md](scf-spec.md). Every normative area of the
specification carries a tier. The tier is a promise about **change**,
not a statement of quality — a Stable area can still be wrong; it just
cannot change quietly.

Current as of specification 0.28 / schema 2.12. This document is expected
to change on most rounds; the specification is not.

---

## The tiers

| Tier | Promise |
|---|---|
| **Stable** | The rule will not change incompatibly before 2.0. A change requires a deprecation cycle (spec §11.4) and a changelog entry. Third parties may build against it. |
| **Provisional** | The rule is believed right and is implemented, but has not been exercised by a second implementation or a real outside consumer. May change in a 1.x release with a changelog entry and a migration note. |
| **Unstable** | Actively being worked on. Will change. Do not build against it. |
| **Reserved** | The name or namespace is claimed; the semantics are not specified. Nothing may occupy it. |
| **Out of scope** | Not part of 1.0. May exist in files; conforming readers ignore it. |

A **1.0 release is the act of moving every Unstable row to Provisional
or better, and every "not yet implemented" note to done.** Nothing else
about it is ceremonial.

---

## By area

### Physical format

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| SQLite container, `.scf` extension | §1.1 | Stable | Yes | Unchanged since 1.0 of the schema. |
| `application_id` / `user_version` | §1.2 | Provisional | Yes | `fileIdentity.ts`, stamped by `initDatabase`. Value chosen (`0x53434631`) and checked against SQLite's registry; `spec/scf.magic` ships the `magic(5)` stanza. Provisional until the stanza is upstreamed into `sqlite/magic.txt`, which is the only step that makes a stock `file(1)` recognise it. |
| Table set from the registry | §1.3 | Stable | Yes | |
| Additive column tolerance on open | §1.4 | Stable | Yes | `initDatabase` ALTER-adds missing registry columns. |

### Entity model

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Registry as normative source | §2.1 | Stable | Yes | Generated from `entity_registry.py`; linted. |
| Registry structure published | §2.1 | Provisional | Yes | `spec/registry.schema.json`, validated against `registry.json` by `registrySchema.test.ts`. Provisional until a third party has consumed it. |
| Physical DDL published | §1.3 | Provisional | Yes | `spec/scf-schema.sql`, dumped from `initDatabase()`, with a `--check` mode. Excludes `sqlite_%` since 0.25 — it previously carried `CREATE TABLE sqlite_sequence`, which SQLite rejects, so the published DDL could not be loaded. |
| Reference projection derived from the registry | §12.1.2 | Provisional | Yes | `referencesOf()`. Replaced hand-written per-query maps that disagreed with each other. |
| Anchors contribute their asset | §12.8 | Provisional | Yes | `resolveMedia` dereferences; `mediaReferences` needs no cross-table lookup, so the row-id conflation cannot recur. |
| Artifact addressing and checksums | §2.1 | **Unstable** | Yes | `spec/ARTIFACTS.md` and `SHA256SUMS` cover **41 files** as of 0.31 — the four specification documents and the eleven blessed negative reports joined the twenty-six generated artifacts. Unstable until a `schema-X.Y` tag exists and the URLs it publishes resolve. |
| Framework columns | §2.2 | Stable | Yes | |
| Ownership rule (`scene_id` belongs vs points at) | §2.3 | Stable | Yes | `sceneOps.ts`. Derived, so new entities are covered without an edit. |
| Hidden `nameField` rule | §2.3 | Stable | Yes | |
| Registry-derived asset usage | §2.3 | Provisional | Yes | Correct as written; only one implementation has ever applied it. |
| Tier bands 0–6 | §0.7 | Provisional | Yes | Descriptive only. Carries no semantics, which is why it is not Stable — if a tier ever gains meaning, this changes. |

### Derived versus stored

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| The derive-don't-store rule | §3.1–3.2 | Stable | Yes | The oldest rule in the format and the most load-bearing. |
| `shot_number` exception | §3.3 | Stable | Yes | Includes the renumber-on-scene-move clause. |
| `screenplay_lines.scene_id` MUST NOT be relied on | §3.4 | Provisional | Yes | Stated as a prohibition because the column is a known fragility. If the threading ever becomes reliable, this text changes rather than the column. |

### Position and ordering

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Story order from screenplay position | §4.1 | Stable | Yes | `scenePositions` / `sceneOrderHint` / `storyOrder()`, with SQL twins. |
| Fallback chain (`scene_number`, then row id) | §4.1 | Stable | Yes | |
| `scene_number` is a label | §4.2 | Stable | Yes | |
| Scene-number grammar and ordering | §4.2.1–4.2.3 | Provisional | Yes | `sceneNumbers.ts`. Implemented in both engines and pinned, including a test asserting the two agree. Provisional rather than Stable only because no second implementation has exercised it. |
| `scene_number` declared type | §4.2.3 | Provisional | Yes | Widened to text in schema 2.9. The FIXTURE's column was rebuilt to match in 0.17 — until then the registry, the published DDL and the fixture disagreed, and §4.2's grammar was unexercised by the artifact meant to demonstrate it. |
| The fixture exercises §4.1's ordering rule | §4.1 | Provisional | Yes | Fixed in 0.17: `12A` sits mid-script with the highest row id, and `16` follows `19` keeping its number. The three orders now differ, and three invariant tests pin that. |
| Numbering policy covers all four numbers | §4.3 | Provisional | Partly | 0.17 states that act, sequence, scene and shot numbers are all authored and all governed by `project.numbering_policy`. The implementation recomputes scene numbers and shot codes; whether it recomputes act and sequence numbers under `derived` is untested. |
| `project.numbering_policy` | §4.3 | Provisional | Yes | Renamed from `scene_numbering` in 2.11; the old column removed in 2.12 under §11.0. `numbering.ts` owns resolution, and a test asserts a stale `scene_numbering` cannot override it. |
| Pre-1.0 change licence | §11.0 | Provisional | n/a | States that §11's rules take effect at 1.0 and that earlier files are disposable, with the fixture excepted. Provisional because it is the kind of clause that is easy to write and easy to overrun — it needs the 1.0 release to prove it was honoured. |
| Result envelope and row projection | §12.1 | Provisional | Yes | `queryResult.ts`. Rows by uuid, volatile columns dropped, references resolved to uuids. Provisional until a second implementation has produced a matching result. |
| The `{uuid, fields}` projected row | §12.1.2 | Provisional | Yes | Stated in 0.29. It had been demonstrated by the blessed artifacts and never defined, which was the third reader run's central finding. Provisional until a second implementation has produced one from the text alone. |
| Polymorphic `_id` columns dropped | §12.1.2 | Provisional | Yes | `projectRow()` drops any `_id` with no `referenceEntity`. Stated in 0.29; Q10 and Q15 both depend on it. |
| Derived records carry nulls | §12.1.4 | Provisional | Yes | Stated in 0.29. The opposite of §12.1.2's omit-empties rule, and the two were indistinguishable in the artifacts. |
| §12's closed vocabularies | §12.1.5 | Provisional | Partly | Stated in 0.29: §8.3's states, §12.9's severities, §12.8's `provenance`. `provenance` is the only one §12 introduces, and 0.29 states its three members in §12.8 rather than leaving them in `mediaReferences.ts`. Partly, because unlike the other two it has no published artifact behind it — a fourth layer would be a spec edit with nothing to check it against. |
| Label lists | §12.1.5 | Provisional | Yes | Stated in 0.29, with the source column named per query. Q12 only. |
| Q09 relatedness is one hop | §12.10 | Provisional | Yes | Stated in 0.29. Non-transitive, deliberately. |
| Report `clean`, `rowIds`, `count` | §9.5 | Provisional | Yes | Stated in 0.29. `clean` was listed in §9.5 and never defined; the semantics lived only in `findings.ts`. |
| The screenplay tables are published | §1.3.1 | Provisional | Yes | `screenplay-tables.json`, dumped from `initDatabase()` on `scf-schema.sql`'s reasoning. Columns, nullability, defaults and a purpose per table. |
| `line_type` is a closed vocabulary | §1.3.1 | Provisional | Yes | Fifteen values. `LINE_TYPES` in `fountain/types.ts` is now a runtime array rather than a type-only union, the artifact is generated from it, and `screenplayTables.test.ts` checks the artifact back. Provisional because the closure is a requirement on implementations that the column — free TEXT — cannot enforce, and **no finding fires on a value outside the set**. |
| All sixteen queries | §12.2–12.17 | Provisional | Yes | Specified and blessed as `fixtures/expectations/*.result.json`. Q03 and Q12 are blessed away from scene 12 — at 19, and diffing 19 → 16 — so the suite can now tell a §4.1-conforming resolver from one ordering by `scene_number`. Reintroducing the old ordering fails four tests; before 0.22 it failed none. |
| Expectation coverage | — | Provisional | Partly | Four results now sit at three different positions. The rendered-markdown expectations still cluster on scene 12, and will until the queries behind them are specified. |
| Results exclude `cut` rows | §12.1.2 | Provisional | Yes | Follows §6.6.1. Settled before the other fourteen queries were blessed, so they get blessed once. |
| Shot-code canonical form | §4.4.1 | Stable | Yes | `shots.ts`. Bijective base-26, zero-based. |
| Shot codes parsed relative to the scene | §4.4.2 | Provisional | Yes | `parseShotCode()`, used by both `nextShotNumber()` and `restampShotNumber()`. Pinned by the A-page regression cases in `shots.test.ts`. |
| Shot-code allocation | §4.4.3 | Provisional | Yes | Continue-past-highest, with the stated no-retired-codes limitation. |
| Restamping under `numbering_policy` | §4.4.4 | Provisional | Yes | Corrected in 0.29: §4.4.4 had cited `project.scene_numbering`, removed in schema 2.12. |
| Pattern 1 — explicit rows | §4.3 | Stable | Yes | |
| Pattern 2 — persistence | §4.3 | Stable | Yes | Pinned. |
| Pattern 3 — latest wins | §4.3 | Stable | Yes | Pinned. |
| Oldest-first merge of persistent states | §4.3 | Provisional | Yes | Field-by-field override is right for the cases in the fixture; no outside consumer has tested it. |

### Structure

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Spans defined by start alone | §5.1 | Stable | Yes | |
| Contiguity constraint | §5.2 | Stable | Yes | Accepted cost, stated in the design record. A cross-cut requirement would require replacing the model, not patching it. |
| Acts and sequences independent | §5.3 | Stable | Yes | |
| Run-grouping requirement for renderers | §5.3 | Provisional | Yes | `actOutline()`. A presentation requirement in a data spec — sits oddly, may move to a rendering note. |
| `scene_sequence` shadow rows | §5.4 | **Unstable** | Yes | Materialised for compatibility with queries that predate spans. A candidate for removal in 1.0: they are a derived fact that is stored, which §3.1 forbids everywhere else. |
| Half-placed structure valid | §5.5 | Stable | Yes | |

### Identity

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Row `uuid` on all entities | §6.1 | Stable | Yes | Schema 2.3. |
| Uuids do not cross files | §6.2 | Stable | Yes | |
| Junction natural keys | §6.3 | Provisional | Yes | Published as `spec/junction-keys.json` in 0.26 — it was cited as a FUNCTION until then, so no third party could compute one. Still only exercised by de-duplication; merge is the real test and does not exist. |
| Q14's rubric published | §12.9.1 | Provisional | Partly | `spec/readiness-rubrics.json`. Requirement-to-severity is machine-readable; **step labels are prose** and do not resolve against the registry. |
| **Rubric step labels resolve to entities** | §12.9.1 | **Unstable** | **No** | Six rubrics carry labels like `sound_cue / music_cue`, `bundle + *_asset_binding`, `performance_state (vocal)` — two entities, a pattern, a filtered subset. A third party can reproduce the severities but must read the labels as a person would, which is not a specification. |
| Unexplained shadow rows reported | §5.4 | Provisional | Yes | `structure.shadow_row_unexplained`, added in 0.26. §5.4 required a finding the closed catalog had no code for, and the detection lived only in the editor's commit path — so the one tool a third party runs never mentioned them. |
| Duplicates as findings | §6.4 | Stable | Yes | |
| Relationship `directionality` | §6.5 | Provisional | Yes | Schema 2.4. |
| Read from both character columns | §6.5 | Stable | Yes | |
| `lifecycle_status` preserved | §6.6 | Provisional | Yes | The column exists and is authored on every non-link entity. |
| Cut rows excluded from every derivation | §6.6.1 | Provisional | Yes | `rows()` filters; `rowsIncludingCut()` is the history path. The fixture carries a cut scene with a heading and a cut beat in scene 12, so the rule is exercised rather than asserted. |
| Reading back what was cut | §6.6.2 | **Unstable** | Partly | `rowsIncludingCut` exists; no tool uses it. A cut list or audit view is unbuilt, and until one exists "inspectable" is a claim rather than a feature. |
| `sceneOrder` derives from the screenplay | §4.1 | Provisional | Yes | Fixed in 0.21 — it had sorted by `scene_number` then row id, which §4.1 forbids. Now delegates to `scenePositions`, with a test asserting the two agree. |

### Cascade

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Cascade identified by its leaf | §7.1 | Provisional | Yes | Rewritten in 0.17. The previous text described a scope ordering that does not exist. |
| Chain is the `refines` closure | §7.2 | Provisional | Yes | `cascadeChain()`. Independently reverse-engineered from the data by a second implementation, which reproduced Q07's seven layers and Q08's two exactly — good evidence the rule is right, and that it was undocumented. |
| One row per entity, most specific first | §7.3 | Provisional | Yes | `fetchLayer()`. |
| Every contributing entity returned | §7.4 | Stable | Yes | |

### Assets

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Asset is a reference, never a container | §8.1 | Stable | Yes | Pinned by an assertion that no export contains `base64`, `blob:` or `data:`. |
| Identifier grammar | §8.2 | Provisional | Yes | Schema 2.8. Newest normative area in the document. |
| `@project` root | §8.2 | Stable | Yes | |
| Root mapping not stored in the file | §8.2 | Stable | Yes | Follows from portability. |
| Absolute paths representable, flagged | §8.2 | Provisional | Yes | |
| Resolution states | §8.3 | Provisional | Yes | Settled in 0.19. Five states, the code's spelling, and the spec/code disagreement about an unmapped root resolved in the spec's favour: it is `unaddressed`, not `out-of-root`. `out-of-root` now depends only on the identifier, never on the session. |
| Purpose lives on the link | §8.4 | Stable | Yes | `asset_type` was removed in 2.8, deliberately not replaced. |
| Format is a hint | §8.5 | Stable | Yes | |
| Unknown extension is not an error | §8.5 | Stable | Yes | `previewCapability()` lands unknowns in tier 3, never tier 1. |
| Orphan detection registry-derived | §8.6 | Provisional | Yes | Measured to 2,000 assets. |
| Content metadata never stored | §8.7 | Stable | Yes | Including the "cannot be queried" consequence. |
| Layers | §8.8 | Reserved | No | Name claimed. Layers live in a subfolder, never at the root. Nothing else specified. |

### Findings

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Describes, does not enforce | §9.1 | Stable | Yes | |
| Resolvers total | §9.2 | Stable | Yes | |
| Extraction is a proposal | §9.3 | Stable | Yes | |
| Props never auto-accepted | §9.3 | Stable | Yes | |
| Export carries a resolution report | §9.4 | Provisional | Yes | |
| Finding catalog published | §9.4 | Provisional | Yes | `spec/finding-catalog.json`, generated and checked. Closes the reason no independent implementation could satisfy §9.4. |
| Negative fixtures reproducible by third parties | — | Provisional | Yes | `fixtures/negative/CASES.json`, generated by the same script that builds them. |
| **Queries as part of the format** | — | **Unstable** | **No** | Decided 2026-08-17: the sixteen canonical queries are normative, and the normative answer is the STRUCTURE, not the rendered prose. Nothing is specified yet. This is the largest remaining piece of specification work. |
| Enumerated finding types | §9.4 | Provisional | Yes | `findings.ts` — a closed catalog of 35 codes, severity owned by the catalog, deterministic ordering, and `collectFindings()` as the single engine a CLI, the panels and the tests all share. Provisional until a report has been read by someone who did not write it. |
| The known-table set | §1.3 | Provisional | Yes | §1.3 defines the file's tables as the registry plus `UUID_EXTRA_TABLES`, which conflated two questions. Schema 2.10 splits them: `ownedTables` for SCF's tables that carry no identity, `uuidExtraTables` for those that do, and `Registry.knownTables` as the union. Title-page rows are properties of the screenplay, so they carry no uuids. Found by `collectFindings` on its first run over the fixture. |
| Enumerated finding behaviour on broken files | §9.4 | Provisional | Yes | Eleven negative fixtures in `fixtures/negative/`, each pinning one code, with blessed reports and a `--check` mode. |
| The serialised report | §9.5 | Provisional | Yes | `report.ts`, own format version, determinism pinned. Provisional until a second implementation has parsed one. |
| `scf-check` | §9.4–9.5 | Provisional | Yes | CLI over `collectFindings`. Covers eight of `conformance.md` §4's nine checks; the asset resolution tally needs a root-mapping flag that has not been designed. |

### Extensibility

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Ignore unknown content | §10.1 | Provisional | Yes | Pinned by `extensibility.test.ts`. |
| Preserve unknown content on write | §10.1 | Provisional | **Yes — verified** | An `x_` table, an `x_` column with its values, and an unprefixed unknown table survive `initDatabase` across five cycles, and survive the app's own open→edit→save cycle across three. Provisional rather than Stable because the browser's `sqlite3_js_db_export` path is still exercised only by hand. |
| Document equality / canonical dump | §11.6 | Provisional | Yes | `canonical.ts`. Answers `conformance.md` §3's open question about what a round trip is compared on. Provisional until a second implementation has produced a dump. |
| Canonical query expectations as data | — | Provisional | Yes | `fixtures/expectations/` — a normative `.result.json` for all sixteen queries, plus rendered markdown for eight. Both free of row ids and timestamps. `shapes.json` was retired in 0.30. |
| Conformance claim process | — | Provisional | n/a | `conformance.md` §6: self-certification, per role, with the reports published. Untested in the only way that matters — nobody has made a claim. |
| Reserved names | §10.2 | Provisional | Yes | `@plates` and `@nas` reserved; entity and column names checked by `lint_registry.py` and `registrySchema.test.ts`. |
| `x_` extension prefix | §10.3 | Provisional | Yes | Enforced at the moment a name is chosen (the linter) and again at the generated artifact (the schema test). Preservation covered by the row above. |

### Versioning

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Additive-only schema changes | §11.1 | Stable | Yes | Every change so far has been one. |
| Forward compatibility | §11.2 | Provisional | Partly | Follows from §10.1, which is untested. |
| Backward compatibility | §11.3 | Provisional | Partly | Same. |
| Deprecation window | §11.4 | Provisional | n/a | Newly stated. 2.8's removal of `asset_type` predates it. |

### Out of scope

| Area | Tier | Notes |
|---|---|---|
| Version / snapshot system | Out of scope | May never enter. Revert is retired; publish and diff remain read-only. External file versioning is the right tool. |
| Cross-file merge | Out of scope | Depends on natural keys, which are specified. The algorithm is not. Belongs with multi-user work. |
| Packaging / archive form | Out of scope | Not planned. |
| Editor UX, import heuristics | Out of scope | Never in scope. |
| Metadata query | Out of scope | Deliberately impossible, per §8.7. |

---

## Summary — what stands between here and 1.0

Five Unstable rows, in rough dependency order:

1. **The remaining three queries** (§12) — Q01, Q02, Q04. Their
   compositions live in the app and must move to the core first, as Q03's
   and Q12's did.
2. **The asset resolution tally in `scf-check`** (§8.3) — the one check
   the validator cannot do, because §0.3 makes the root mapping a
   property of the consuming environment and no flag exists to supply
   one.
3. **Rubric step labels** (§12.9.1) — prose where a specification needs
   references. The requirement half is publishable and published; the
   subject half is not.
4. **A view for what was cut** (§6.6.2) — the filter is done; the way to
   read cut rows back is a library function nothing calls. Until a cut
   list exists, "inspectable" is a claim.
4. **`scene_sequence` shadow rows** (§5.4) — decide whether they survive
   1.0 or go. They are now at least reported.
5. **Artifact addressing** (§2.1) — the manifest is written, covers all
   41 files as of 0.31, and verifies. No `schema-X.Y` tag exists, so the
   URLs it publishes do not resolve. One `git tag` closes it.

*Closed in 0.24:* the envelope holds for a whole-story answer, not only
a positional one.

*Closed in 0.23:* every query that takes a position is specified. Q13's
embedded row id is gone, and §12.1.1 now distinguishes a row reference
from a literal parameter.

*Closed in 0.22:* the expectations no longer cluster on one scene. The
suite can now distinguish a conforming resolver from one using the
ordering §4.1 forbids — which it could not do when that bug was live.

*Closed in 0.21:* §6.6 is decided — cut rows are excluded from every
derivation, and the fixture carries cut rows that prove it by changing
nothing. `sceneOrder` was also found ordering by `scene_number`, which
§4.1 forbids, and now derives from the screenplay.

*Closed in 0.20:* §12 exists. The queries have an envelope, a portable
row projection, and two normative definitions.

*Closed in 0.19:* `scene_numbering` is gone, and with it the one place
the format deliberately stored a fact twice; and §8.3's resolution
states now agree between spec and implementation.

*Closed in 0.17:* the finding catalog is published (§9.4); the negative
fixtures are reproducible without this repository; §7 was rewritten,
having been found wrong rather than incomplete; and the fixture's three
orders were made to differ, so §4.1 is checkable at last.

*Closed in 0.15:* the known-table set (§1.3), and `scf-check`, which
was the item most of §5 was waiting on.

*Closed in 0.14:* enumerated finding types (§9.4).

*Closed in 0.13:* unknown-content preservation (§10.1) — tested, and it
holds — and the `x_` prefix (§10.3), now enforced at both the linter and
the generated artifact.

*Closed in 0.12:* `application_id` / `user_version` (§1.2).

*Closed in 0.11:* the `scene_number` declared type (widened in schema
2.9) and shot-code parsing (`parseShotCode()`), which were one decision
with two commits.
