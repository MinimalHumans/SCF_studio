<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# SCF Studio

[![CI](https://github.com/MinimalHumans/SCF_studio/actions/workflows/ci.yml/badge.svg)](https://github.com/MinimalHumans/SCF_studio/actions/workflows/ci.yml)

Tooling for the **Story Context Framework** — a description of a film's
intent, dense enough that a human or a machine can answer a specific
question about a specific moment: what a character sounds like in this
scene, what is in force here, what a shot is for.

An `.scf` file is a SQLite database. The schema is generated from one
declaration; every consumer reads the generated registry.

**Status: pre-1.0.** The specification is a draft at `spec/scf-spec.md`,
and `spec/stability.md` states what is safe to build against. Until 1.0
ships, existing `.scf` files are disposable — there is no migration path
and no backward compatibility owed to anything already written (spec
§11.0). The one exception is `fixtures/hollow_creek.scf`, which is a
normative artifact.

| Directory | What it holds |
|---|---|
| `schema/` | **The source of truth for the format.** Entity and field declarations, the version, the registry generator and linter. |
| `scf-core/` | The semantics, in TypeScript: resolution, structure, readiness, screenplay parsing, proposals. Environment-agnostic. |
| `scf-app/` | The editor — a browser application over the same core, SQLite in OPFS, CodeMirror screenplay editor, canonical query pages. |
| `fixtures/` | `hollow_creek.scf`, the conformance fixture and demo project, with the scripts that build it. |
| `corpus/` | Screenplay parsing corpus. The public tier is checked in; `corpus/private` is not. |
| `spec/` | **The normative specification.** `scf-spec.md` (what the format is), `stability.md` (what is safe to build against), `conformance.md` (what claiming SCF support means), `CHANGELOG.md`. Published artifacts: `scf-schema.sql` (physical DDL), `registry.schema.json` (JSON Schema for the registry), `finding-catalog.json` (the normative finding codes), `junction-keys.json`, `readiness-rubrics.json`, `scf.magic` (a `file(1)` pattern), `ARTIFACTS.md` + `SHA256SUMS`. `screenplay-tables.json` (the screenplay infrastructure tables and the `line_type` vocabulary). The manifest lists **41 files** in all: these four documents, the generated artifacts, the sixteen canonical query results and the eleven blessed negative reports under `fixtures/`. |
| `docs/` | `conventions.md` (the design record — why the format is the way it is), `schema-changelog.md`, `story-structure-design-record.md`. |

## Getting started

```sh
cd scf-app && npm install && npm run dev
```

The app opens with a demo project; no file is written until you save.

## Tests

```sh
cd scf-core && npm test    # semantics + conformance against the fixture
cd scf-app  && npm test    # editor, import pipeline, query runners
```

Validate a file:

```sh
cd scf-core && npm run scf-check -- ../fixtures/hollow_creek.scf
```

Exit 0 means no errors; 1 means errors; 2 means the file could not be
read. `--json` emits the serialised report, `--quiet` the exit code
alone.

Both suites run green on a clean checkout.

Conformance artifacts, all checked on every test run:

| | |
|---|---|
| `fixtures/hollow_creek.scf` | The reference fixture. |
| `fixtures/negative/` | Eleven deliberately-broken cases with blessed reports, plus `CASES.json` so anyone can rebuild them. |
| `fixtures/expectations/` | The sixteen canonical queries' normative results, plus rendered markdown for eight of them. The markdown is a convenience and is a contract for none. |

`corpus/private` is not checked in, and the blocks that need it
(`screenplay.test.ts` stage 3 payoff, `fountain.test.ts` private tier)
skip themselves when it is absent — a machine that has the private tier
picks up the extra coverage automatically.

## Continuous integration

`.github/workflows/ci.yml`, three jobs:

| Job | What fails it |
|---|---|
| `artifacts` | A generated file nobody regenerated: `registry.json`, `scf-schema.sql`, `screenplay-tables.json`, `finding-catalog.json`, the negative reports, the corpus expectations, `ARTIFACTS.md`, `SHA256SUMS`. |
| `core` | Format semantics — typecheck, 500+ tests, and `scf-check` against the fixture. |
| `app` | The editor — typecheck, tests (including the blessed query expectations), production build. |

Every artifact step runs in `--check` mode and never in write mode. CI
must fail on a stale artifact rather than quietly regenerate it and
pass: a pipeline that rewrites what it is verifying verifies nothing.

## Changing the format

`docs/conventions.md` §8. Short version: edit `schema/entity_registry.py`,
regenerate, lint, bump the version and record it in the changelog. If the
change touches anything normative, update `spec/scf-spec.md` and the
affected row in `spec/stability.md` in the same commit.

The two documents have distinct jobs and must not overlap: the spec
states rules and nothing else, the design record explains them and
states no rules. A rule found only in `docs/conventions.md` is a defect.

## Contributing and governance

| | |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, and which of the three routes a change takes |
| [`proposals/`](proposals/) | Changes to the **format** get argued here before they get built |
| [`GOVERNANCE.md`](GOVERNANCE.md) | Who decides, what they weigh, and how a decision is recorded |
| [`SECURITY.md`](SECURITY.md) | What is in scope, and how to report privately |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |

A **defect** in the specification is an issue, not a proposal. Three
independent implementations have been written against this format and
their authors found dozens of them; every one was worth having quickly
and without ceremony. Proposals are for changes where the answer is
arguable and the argument is the valuable part.

## Licensing

Code is Apache-2.0 ([`LICENSE`](LICENSE)). **Prose is CC BY 4.0** — the
specification is written to be implemented by other people, and a
document nobody may quote is a document nobody adopts.

The boundary runs between written documents and generated data, and is
stated once in [`spec/LICENSE`](spec/LICENSE). Generated artifacts carry
the licence of the code that produces them; so do the fixtures, because
an attribution burden on a conformance fixture is a burden on
conformance. Neither licence is copyleft: nothing here obliges you to
open your implementation.

Names are covered separately in [`NOTICE`](NOTICE). Short version: say
your software reads, writes or conforms to SCF as much as you like —
just do not imply this project endorses it.

## History

A first implementation (a Python/FastAPI editor) established the schema
and the resolution semantics, and was held to conformance parity with
this one while both existed. It is retired; nothing here depends on it.
The conformance suites and the Hollow Creek fixture carry the contract
forward.
