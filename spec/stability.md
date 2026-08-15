# SCF stability tiers

Companion to [scf-spec.md](scf-spec.md). Every normative area of the
specification carries a tier. The tier is a promise about **change**,
not a statement of quality — a Stable area can still be wrong; it just
cannot change quietly.

Current as of specification 0.9 / schema 2.8. This document is expected
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
| `application_id` / `user_version` | §1.2 | **Unstable** | **No** | Specified, no code. Application id value not yet chosen or registered with SQLite's `magic.txt`. 1.0 requirement. |
| Table set from the registry | §1.3 | Stable | Yes | |
| Additive column tolerance on open | §1.4 | Stable | Yes | `initDatabase` ALTER-adds missing registry columns. |

### Entity model

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Registry as normative source | §2.1 | Stable | Yes | Generated from `entity_registry.py`; linted. |
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
| `project.scene_numbering` | §4.2 | Provisional | Yes | Schema 2.5. Two values today; a third (per-act, per-reel) is conceivable. |
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
| Junction natural keys | §6.3 | Provisional | Yes | `junctionKeyFields()`. Stated for all thirteen links but only exercised by de-duplication; merge is the real test and does not exist. |
| Duplicates as findings | §6.4 | Stable | Yes | |
| Relationship `directionality` | §6.5 | Provisional | Yes | Schema 2.4. |
| Read from both character columns | §6.5 | Stable | Yes | |
| `lifecycle_status` preserved | §6.6 | Provisional | Yes | The column exists and is authored on every non-link entity. |
| **Whether resolvers filter `cut`** | §6.6 | **Unstable** | **No** | The open normative gap. Nothing in `scf-core` reads the column, and the fixture has no non-active row, so "cut" is currently decorative. In scope for 1.0. Deciding it changes the answer to every canonical query, so it also needs a fixture with cut rows and suite expectations for both readings. |

### Cascade

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| project → sequence → scene → shot | §7 | Stable | Yes | Pinned by Q07, Q08, Q11. |
| Every contributing layer returned | §7 | Stable | Yes | |

### Assets

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Asset is a reference, never a container | §8.1 | Stable | Yes | Pinned by an assertion that no export contains `base64`, `blob:` or `data:`. |
| Identifier grammar | §8.2 | Provisional | Yes | Schema 2.8. Newest normative area in the document. |
| `@project` root | §8.2 | Stable | Yes | |
| Root mapping not stored in the file | §8.2 | Stable | Yes | Follows from portability. |
| Absolute paths representable, flagged | §8.2 | Provisional | Yes | |
| Resolution states | §8.3 | **Unstable** | Partly | **The specification and the implementation disagree.** `docs/conventions.md` listed four states spelled `unmaterialized`; `scf-core/src/assets.ts` defines five spelled `unmaterialised`, the fifth being `unaddressed`. The spec now states five with the code's spelling. This needs settling in code, docs and any serialised output before 1.0 — a state name is a wire value. |
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
| **Enumerated finding types** | — | **Unstable** | **No** | Findings are produced by several modules with no shared vocabulary, no codes, and no defined severity. A validator (conformance.md §4) cannot be specified without this. 1.0 requirement. |

### Extensibility

| Area | Spec | Tier | Implemented | Notes |
|---|---|---|---|---|
| Ignore unknown content | §10.1 | Provisional | Partly | The permissive behaviour exists; it has never been tested. There is no round-trip test asserting that unknown tables survive a read-modify-write. |
| Preserve unknown content on write | §10.1 | **Unstable** | **Unknown** | Believed true, never verified. This is the single most likely place a conforming-writer claim would fail. |
| Reserved names | §10.2 | Provisional | n/a | Reserving `@plates` and `@nas` costs nothing and prevents a future collision. |
| `x_` extension prefix | §10.3 | Provisional | No | Specified; nothing enforces or tests it. |

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

Seven Unstable rows, in rough dependency order:

1. **Resolution state names** (§8.3) — a wire-value disagreement between
   spec, docs and code. Cheapest to fix, and it blocks any external
   consumer that reads a state.
2. **Enumerated finding types** (§9) — nothing else in the conformance
   story can be built without a finding vocabulary.
3. **`lifecycle_status` filtering** (§6.6) — changes the answer to every
   canonical query. Needs a fixture with cut rows.
4. **Unknown-content preservation** (§10.1) — believed true, untested. A
   round-trip test would settle it in an afternoon.
5. **`x_` prefix** (§10.3) — specified, unenforced.
6. **`application_id` / `user_version`** (§1.2) — four lines of code plus
   registering a value.
7. **`scene_sequence` shadow rows** (§5.4) — decide whether they survive
   1.0 or go.
