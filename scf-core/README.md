# scf-core

The SCF (Story Context Framework) core library: **format + executable semantics +
conformance target**, UI-free. This is the foundation of the second
implementation (`docs/design/20260715_SCF_Second_Implementation.md`) — the
web app, the query page, the screenplay editor, and the future MCP server
are all clients of this package.

Structured publishable from day one; **unpublished until the format
settles** (design decision 6).

## What's here

| Module | Contents |
|---|---|
| `registry/registry.json` | **Generated artifact — never hand-edit.** Emitted from `schema/entity_registry.py` (the source of truth) by `schema/generate_registry_json.py`. All 99 entities, every field, the full Phase A ontology. |
| `src/registry.ts` | Types + loader + `cascadeChain` (the `refines` walk). |
| `src/db.ts` | The `SqlExec` seam, `initDatabase()` (CREATE + ALTER-add-columns + uuid identity + `_scf_meta` stamping, same as Python), `newUuid()`. |
| `src/resolution.ts` | Description / direction / media cascades, pattern-3 latest-wins, G4 variant selection. Port of `resolution.py`. |
| `src/queryPaths.ts` | The walkable canonical-query contracts (G6). |
| `src/readiness.ts` | Q14 readiness reports. Port of `readiness.py` — finding messages are part of the conformance surface and are ported verbatim. |
| `src/node.ts` | Node driver (`node:sqlite`) for the `SqlExec` seam. Separate export; browser bundles never touch it. |

## The one interface: `SqlExec`

```ts
type SqlExec = (sql: string, params?: SqlValue[]) => Promise<Row[]>;
```

Everything in scf-core speaks SQLite through this async seam. The browser
app supplies a **sqlite-wasm/OPFS** implementation; Node (conformance CI,
scripts, the MCP server) supplies `node:sqlite` via `scf-core/node`. Async
was chosen because the browser's OPFS VFS is async-facing — sync drivers wrap
for free, the reverse refactor would not. Driver errors must surface as
rejections, never synchronous throws.

## Conformance

```
npm test              # everything
npm run conformance   # the two parity suites only
```

- `test/conformance.canonical.test.ts` — every assertion from
  the canonical query semantics (§ docs/conventions.md)
- `test/conformance.readiness.test.ts` — the readiness rules
- `test/initDatabase.test.ts` — schema parity: a fresh TS-created database
  matches the fixture's column sets, uuid indexes, and schema stamp

All run against the shared checked-in fixture
`fixtures/hollow_creek.scf` (override with `SCF_FIXTURE=`).
**CI must run both implementations' suites; drift fails the build.** The
registry side of that contract:

```
python schema/generate_registry_json.py --check
```

## Parser (Part 2) — all three stages

| Stage | Module | Nature |
|---|---|---|
| 1 Tokenize/classify | `src/fountain/`, `src/fdx/` | Deterministic, spec-faithful. Byte-stable round-trip by construction; golden corpus + property tests (`npm run bless-corpus`). |
| 2 Row model | `src/screenplay/rowModel.ts` | Pure mapping onto v1's own tables (created by `initDatabase` now). Entity ids are only ever GIVEN (`applyAssignments`); byte fidelity survives the database via per-line eol metadata. |
| 3 Entity proposal | `src/proposals/propose.ts` | Heuristic and honest about it: proposals, never rows. Cue normalization shows its work; confidence scoring is corpus-derived, with hard suspicions (prose-shaped forced cues, page furniture, number-glued headings, stopwords, digit-heavy cues, near-duplicates) forcing low. `acceptBestGuess` applies default thresholds; props are never auto-accepted. |

## Deliberately not here

- **UI.** Nothing in this package imports React or touches the DOM.
- **1.x migrations.** They stay in the Python editor; working files are
  disposable, the fixture is 2.x-native.
- **The browser SQLite adapter.** It is an implementation of `SqlExec` that
  needs a browser to exist; it lands with the app shell (Part 1), not
  here. `initDatabase` and the semantics are driver-agnostic and already
  proven through the Node driver.
