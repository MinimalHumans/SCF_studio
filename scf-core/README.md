# scf-core

The SCF (Story Craft Format) core library: **format + executable semantics +
conformance target**, UI-free. This is the foundation of the second
implementation (`docs/design/20260715_SCF_Second_Implementation.md`) — the
web app, the query page, the screenplay editor, and the future MCP server
are all clients of this package.

Structured publishable from day one; **unpublished until the format
settles** (design decision 6).

## What's here

| Module | Contents |
|---|---|
| `registry/registry.json` | **Generated artifact — never hand-edit.** Emitted from `scf-editor/entity_registry.py` (the source of truth) by `scf-editor/scripts/generate_registry_json.py`. All 99 entities, every field, the full Phase A ontology. |
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
app supplies a **wa-sqlite/OPFS** implementation; Node (conformance CI,
scripts, the MCP server) supplies `node:sqlite` via `scf-core/node`. Async
was chosen because wa-sqlite's OPFS VFS is async-facing — sync drivers wrap
for free, the reverse refactor would not. Driver errors must surface as
rejections, never synchronous throws.

## Conformance

```
npm test              # everything
npm run conformance   # the two parity suites only
```

- `test/conformance.canonical.test.ts` — every assertion from
  `scripts/test_canonical_queries.py`
- `test/conformance.readiness.test.ts` — every assertion from
  `scripts/test_readiness.py`
- `test/initDatabase.test.ts` — schema parity: a fresh TS-created database
  matches the fixture's column sets, uuid indexes, and 2.3 stamp

All run against the shared checked-in fixture
`scf-editor/fixtures/hollow_creek.scf` (override with `SCF_FIXTURE=`).
**CI must run both implementations' suites; drift fails the build.** The
registry side of that contract:

```
python scf-editor/scripts/generate_registry_json.py --check
```

## Deliberately not here

- **UI.** Nothing in this package imports React or touches the DOM.
- **1.x migrations.** They stay in the Python editor; working files are
  disposable, the fixture is 2.x-native.
- **The wa-sqlite adapter.** It is an implementation of `SqlExec` that
  needs a browser to exist; it lands with the app shell (Part 1), not
  here. `initDatabase` and the semantics are driver-agnostic and already
  proven through the Node driver.
- **Screenplay infrastructure tables** (`screenplay_lines`, versions,
  prop tags, …). They are Part 3's storage and will join `initDatabase`
  when Part 3's row model lands; `registry.json` already carries their
  names in `uuidExtraTables` so 2.3 identity extends to them on contact.
