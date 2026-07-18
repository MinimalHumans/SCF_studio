# scf-app

The SCF editor, second implementation — **Part 1: entity browser/editor**.
React + Vite + TypeScript + Zustand, local-first, no server, Chromium-first
(static hosting, Scriptyard model). All format knowledge comes from
`scf-core`; the app never hand-defines an entity.

```
npm install
npm run dev        # http://localhost:5173 — Chromium
npm run typecheck
npm run build      # static bundle in dist/
```

`scf-core` is consumed as TypeScript source via a Vite alias
(`@scf-core -> ../scf-core/src`) — no build step for the core package
until it publishes. Keep the two directories siblings.

## Architecture

```
main thread                          worker
───────────                          ──────
FsAccessAdapter (FileAdapter)        wa-sqlite (async build)
  open/save/saveAs/sibling-dir       OriginPrivateFileSystemVFS (OPFS)
        │  bytes                          │
        ▼                                 ▼
OPFS working copy (working.scf)  ◄──  SQLite database
        ▲                                 ▲
        │ postMessage {sql, params} → rows │
Zustand store ── exec (scf-core SqlExec seam)
        │
React UI (registry-driven)
```

- **Open**: picked file's bytes → OPFS working copy → worker opens it →
  `initDatabase` (same CREATE/ALTER/uuid/stamp as Python; no 1.x
  migrations by design). **Save**: worker closes → bytes read from OPFS →
  written back through the `FileAdapter` → reopen. Single-writer contract.
- **`FileAdapter`** is the desktop-wrapper insurance (decision 9): the
  Tauri implementation later is a packaging job, not a refactor.
- The demo project is the bundled conformance fixture
  (`public/hollow_creek.scf`) — Hollow Creek ships as the demo throughout.

## What Part 1 delivers here

- **Form generator** — one component tree from `registry.json`: text /
  auto-growing textarea / select (combobox for long option lists) /
  multiselect / integer / float / boolean / reference (search +
  create-inline) / JSON with typed sub-editors (string-list chips,
  key-value grid, raw escape hatch, shape-detected). Tabs from
  `FieldDef.tab`, required markers, **help text inline** (v1 buried it in
  tooltips). Dirty-state + undo at the form level (Zustand). Whole-row
  UPDATEs; inserts stamp `uuid`; updates write `updated_at` faithfully
  (decision 10).
- **Both navigation modes** — subject-oriented (default: pick Eleanor /
  the kitchen / the locket → everything addressed to it, grouped
  global → moment from Phase A scope metadata) and the tier/category
  tree for schema-oriented work.
- **Scene spine** — position-keyed sections in the subject view render
  the story-position strip with keyed scenes marked: the first UI
  expression of the position patterns.
- **Cross-links everywhere** — reference fields navigate; reverse links
  ("what points here") computed generically from the registry's
  reference graph.
- **Client-side search** over every entity's name field (v1's
  server-rendered search does not port).

## Deferred within Part 1 (next passes)

- **Position-aware timeline editing** — the spine currently *shows*
  in-force spans' keyed positions; visualizing the span itself
  (until_resolved reach, latest-wins runs) and editing from the strip is
  the follow-up.
- **Readiness woven in** — the Q14 panel and in-context blockers
  (character page / scene page) hook straight into
  `scf-core/readiness.ts`; UI not yet built. Part 4 hosts the full page.
- **Junction lightweight editors** — scene cast/props inline,
  `motif_appearance` from either end.
- **Shared panel/density primitives** — extraction into the internal
  package (decision 8) once Scriptyard/Arboretum alignment is looked at
  together; styles are plain CSS here until then.

## Test status — read this

- The **worker's exec loop, `initDatabase`, insert/update paths, and a
  resolution call are smoke-tested against the real wa-sqlite WASM build**
  (Node, MemoryAsyncVFS) — the SQLite API usage is verified.
- **Not yet exercised**: OPFS in an actual browser, File System Access
  open/save round-trip, worker messaging under React StrictMode, and all
  rendering. First manual run should walk: open demo → browse Eleanor →
  edit a field → save project → reopen. Chromium only.
