<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-core

The SCF (Story Context Framework) core library: **format + executable semantics +
conformance target**, UI-free. The reference editor (`scf-app`), its query
pages and screenplay editor, and the MCP server (`scf-mcp`) are all clients
of this package.

Structured to be publishable; **unpublished until SCF 1.0**
(`docs/release-checklist.md` §E). The public surface is the explicit export
list in `src/index.ts`, recorded in `spec/api-surface.json` and checked in CI.

## What's here

The main modules; `src/index.ts` is the whole list, organised by
`spec/conformance.md`'s roles.

| Module | Contents |
|---|---|
| `registry/registry.json` | **Generated artifact — never hand-edit.** Emitted from `schema/entity_registry.py` (the source of truth) by `schema/generate_registry_json.py`. Every entity and every field. |
| `src/registry.ts` | Types + loader + `cascadeChain` (the `refines` walk, spec §7). |
| `src/db.ts` | The `SqlExec` seam, `initDatabase()` (CREATE + ALTER-add-columns + uuid identity + `_scf_meta` stamping), `newUuid()`. |
| `src/canonicalQueries.ts` | `q00Result()` … `q15Result()`: the sixteen canonical queries as normative results (spec §12). |
| `src/resolution.ts` | Description / direction / media cascades, pattern-3 latest-wins, location variant selection (spec §12.17). |
| `src/queryPaths.ts` | The walkable canonical-query contracts. |
| `src/readiness.ts` | Q14 readiness reports. Finding messages are part of the conformance surface. |
| `src/findings.ts` | `collectFindings()`, the one engine behind `scf-check`, the editor's panels and the tests; the closed catalog published as `spec/finding-catalog.json`. |
| `src/shotContext.ts` | The shot-prompt composite `scf-mcp` serves: `shotContext`, `shotMedia`, `shotReadiness`. |
| `src/node.ts` | Node driver (`node:sqlite`) for the `SqlExec` seam, and `openNodeSession`, a file-backed `Session`. Separate export, `scf-core/node`; browser bundles never touch it. |
| `src/session.ts` | `Session`: one open `.scf` — a connection plus what is unsaved, how to save it, and whether the file changed under it. Storage-agnostic; the app and the Node driver both supply a `SessionDriver`. |
| `src/ops/` | Every write to a `.scf`, as named operations over `SqlExec` + `Registry`. Nothing outside core issues `INSERT`, `UPDATE` or `DELETE`. |

`scripts/scf_check.mjs` is the `scf-check` bin: a validator for any `.scf`
(`spec/conformance.md` §4).

## The one interface: `SqlExec`

```ts
type SqlExec = (sql: string, params?: SqlValue[]) => Promise<Row[]>;
```

Everything in scf-core speaks SQLite through this async seam. The browser
app's reads go to the host (`scf-host`) over a socket, and the host itself
(like conformance CI, scripts and the MCP server) uses `node:sqlite` via
`scf-core/node`. Async was chosen because a remote or browser-side driver is
async-facing — sync drivers wrap for free, the reverse refactor would not.
Driver errors must surface as rejections, never synchronous throws.

Writes are not SQL from a client: they are named functions run by the host.
`ops/calls.ts` is the table of what the editor may call (positional,
plain-data arguments, typed from the functions themselves) and
`ops/opTable.ts` the small schema-checked set meant for tools.

## Conformance

```
npm test              # everything
npm run conformance   # the canonical and readiness suites only
```

- `test/conformance.canonical.test.ts` — the canonical query semantics
  (spec §4.5, §7, §12)
- `test/conformance.readiness.test.ts` — the readiness rules
- `test/canonicalQueries.test.ts` — every query against its published
  normative results in `fixtures/expectations/`
- `test/negativeFixtures.test.ts` — the negative fixtures report as blessed
- `test/initDatabase.test.ts` — a fresh database matches the fixture's
  column sets, uuid indexes and schema stamp

All run against the shared checked-in fixture
`fixtures/hollow_creek.scf` (override with `SCF_FIXTURE=`). The registry
side of that contract:

```
python schema/generate_registry_json.py --check
```

## Parser (Part 2) — all three stages

| Stage | Module | Nature |
|---|---|---|
| 1 Tokenize/classify | `src/fountain/`, `src/fdx/` | Deterministic, spec-faithful. Byte-stable round-trip by construction; golden corpus + property tests (`npm run bless-corpus`). |
| 2 Row model | `src/screenplay/rowModel.ts` | Pure mapping onto the screenplay tables (spec §1.3.1, created by `initDatabase`). Entity ids are only ever GIVEN (`applyAssignments`); byte fidelity survives the database via per-line eol metadata. |
| 3 Entity proposal | `src/proposals/propose.ts` | Heuristic and honest about it: proposals, never rows. Cue normalization shows its work; confidence scoring is corpus-derived, with hard suspicions (prose-shaped forced cues, page furniture, number-glued headings, stopwords, digit-heavy cues, near-duplicates) forcing low. `acceptBestGuess` applies default thresholds; props are never auto-accepted. |

## Deliberately not here

- **UI.** Nothing in this package imports React or touches the DOM.
- **Migrations.** Before 1.0 working files are disposable (spec §11.0),
  and the fixture is rebuilt from source at every schema change.
- **The browser SQLite adapter.** It is an implementation of `SqlExec` that
  needs a browser to exist, so it lives in `scf-app`. `initDatabase` and
  the semantics are driver-agnostic and proven through the Node driver.
