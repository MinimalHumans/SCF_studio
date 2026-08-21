<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-app

The SCF editor: React + Vite + TypeScript + Zustand, local-first, no
server, Chromium-first. All format knowledge comes from `scf-core`; the
app never hand-defines an entity.

```sh
npm install
npm run dev        # http://localhost:5173 — Chromium
npm run typecheck
npm test
npm run build      # static bundle in dist/
```

`scf-core` is consumed as TypeScript source via a Vite alias
(`@scf-core -> ../scf-core/src`), so keep the directories siblings.

## Where the work happens

Six tabs, in the order the work is usually done:

| Tab | Surface | Owns |
|---|---|---|
| **Script** | `ScriptView`, `SceneRail` | The screenplay. CodeMirror 6 over a line-identity model; headings become scenes and `#` sections become acts and sequences, at commit. |
| **Structure** | `StructureView` | Act and sequence boundaries. Three verbs only — start a span at a scene, move it, unanchor it — because membership is derived, not edited. |
| **Shoot** | `ShootView` | Coverage: beats and shots against a read-only scene spine. The script owns structure; this owns what gets shot. |
| **Schema** | `CategoryTree`, `EntityList` | Every entity type, with row counts. |
| **Subjects** | `SubjectNav`, `SubjectView` | One thing and everything addressed to it. |
| **Queries** | `ui/queries/` | The 16 canonical queries, each with view / JSON / copy-as-context. |

## Architecture

```
main thread                              worker
───────────                              ──────
FsAccessAdapter (files/fileAdapter.ts)   @sqlite.org/sqlite-wasm
  open / save / saveAs                     opfs-sahpool VFS
        │  bytes                                │
        ▼                                       ▼
OPFS working copy  ◄────────────────────   SQLite database
        │  postMessage {sql, params} → rows
        ▼
Zustand store (state/store.ts) ── exec: scf-core's SqlExec seam
        │
React UI (registry-driven)
```

- **Edits stream continuously into the OPFS working copy**, which is why
  a crash or a refresh loses nothing. **Save** exports a live snapshot
  and writes it through the `FileAdapter` to the user's `.scf`. The
  distinction matters in the UI: the Save button carries an accent light
  while the working database is ahead of the file.
- **Reload resumes.** The OPFS copy always survived; the file handle now
  survives too, in IndexedDB (`files/handleStore.ts`). Chromium re-asks
  for write permission once after a reload — unavoidable, and correct.
  An explicit Close sets `scf:auto-resume=0` so closed stays closed.
- **`FileAdapter`** is the desktop-wrapper seam: a Tauri build later is
  packaging, not a refactor.

## Patterns worth knowing before changing anything

- **Display labels are derived, never stored.** `state/displayName.ts`
  is the single place: scenes lead with their number, shots with their
  shot number, and a link entity whose `nameField` is hidden gets a
  label composed from the rows it points at. Adding a column to a list
  query is usually the fix when a row reads as `Thing #12`.
- **References resolve one query per table, not per row** — `useRefNames`.
- **Structure is derived from boundaries** (`@scf-core/structure.ts`).
  Anything drawing acts and sequences as nested must group by
  `actOutline()`, because a sequence may cross an act boundary.
- **`useQuery(sql, params)` re-runs on the store's `revision`.** Any
  write must bump it or the UI will not notice.
- **Findings, never enforcement.** Duplicates, dangling boundaries and
  contradictions are reported; nothing is rejected on write.

## Testing

`npm test` runs Vitest against the checked-in fixture
(`../fixtures/hollow_creek.scf`) using the Node SQLite driver.

**A test must not import a view.** Importing anything that reaches
`state/store.ts` constructs the SQLite worker, which fails outside a
browser. Logic that deserves a test lives in a module the view imports —
`editor/shootOps.ts`, `state/displayName.ts`, `state/subjectStats.ts`,
`state/undoDelete.ts` — not in the component.

## Conventions

The format's rules, and the reasoning behind them, are in
`../docs/conventions.md`. Read §2 (derived versus stored) and §4
(structure) before touching labels or the outline views.
