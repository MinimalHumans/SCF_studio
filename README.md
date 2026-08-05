# SCF Studio

Tooling for the **Story Context Framework** — a description of a film's
intent, dense enough that a human or a machine can answer a specific
question about a specific moment: what a character sounds like in this
scene, what is in force here, what a shot is for.

An `.scf` file is a SQLite database. The schema is generated from one
declaration; every consumer reads the generated registry.

| Directory | What it holds |
|---|---|
| `schema/` | **The source of truth for the format.** Entity and field declarations, the version, the registry generator and linter. |
| `scf-core/` | The semantics, in TypeScript: resolution, structure, readiness, screenplay parsing, proposals. Environment-agnostic. |
| `scf-app/` | The editor — a browser application over the same core, SQLite in OPFS, CodeMirror screenplay editor, canonical query pages. |
| `fixtures/` | `hollow_creek.scf`, the conformance fixture and demo project, with the scripts that build it. |
| `corpus/` | Screenplay parsing corpus. The public tier is checked in; `corpus/private` is not. |
| `docs/` | `conventions.md` (what the format means and why), `schema-changelog.md`. |

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

`scf-core/test/screenplay.test.ts` needs `corpus/private`, which is not
checked in; it fails to collect without it.

## Changing the format

`docs/conventions.md` §8. Short version: edit `schema/entity_registry.py`,
regenerate, lint, bump the version and record it in the changelog.

## History

A first implementation (a Python/FastAPI editor) established the schema
and the resolution semantics, and was held to conformance parity with
this one while both existed. It is retired; nothing here depends on it.
The conformance suites and the Hollow Creek fixture carry the contract
forward.
