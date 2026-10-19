<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-app

The SCF editor: React + Vite + TypeScript + Zustand, in a Tauri desktop
shell (`src-tauri/`). All format knowledge comes from `scf-core`; the
app never hand-defines an entity.

There is no host process. The window runs the host core
(`../scf-host/src/core.ts`) itself (`src/host/windowHost.ts`), on SQLite
and files the shell provides (`src-tauri/src/sql.rs`, `files.rs`), and
it serves the MCP (`src/mcp/windowMcp.ts`): an assistant is pointed at
`scf mcp` (see `../scf-mcp/README.md`), a small Rust pipe shipped beside
the app (`src-tauri/src/bin/scf.rs`) that the shell relays to the window
(`mcp_relay.rs`), so an assistant and the editor share one host. The
pipe starts the app with its window hidden when it is not running; such
an app exits a little after its last assistant leaves, unless someone
has opened the window. Closing the window while an assistant is
connected only hides it.

## Developing

Needs Node 22+ and Rust (stable).

```sh
npm ci
npm run dev          # the editor, in its window, with hot reload
npm test             # vitest: components, and the window on a host in-process
npm run typecheck
npm run tauri build  # installer in src-tauri/target/release/bundle/
```

`npm run dev` is `tauri dev`: Vite serves the page (`npm run dev:page`)
and the shell loads it, so a change under `src/` reloads in place, and
one under `src-tauri/` rebuilds and restarts the shell. The first run
compiles the shell, which takes a minute; later ones take seconds. The
page needs the shell (its files and SQLite are the shell's), so it does
not work in a browser tab.

- **DevTools**: right-click › Inspect, or F12, in the window (debug
  builds only).
- **Beside an installed copy**: the dev app has its own identifier
  (`src-tauri/tauri.dev.json`), so its own data folder, settings and MCP
  pipe, and its window says "(dev)". Both can run at once.
- **Folders**: the host lists your home, and in a debug build the
  checkout's `fixtures/` and `templates/` as well; `SCF_HOST_ROOTS` (a
  path-delimited list) replaces them.
- **An assistant on the dev app**: build the pipe once with `cargo build
  --bin scf` in `src-tauri/`, then point the assistant at
  `src-tauri/target/debug/scf.exe mcp` (`scf` elsewhere). A debug pipe
  only connects to a running `npm run dev`; it does not start one.
  A page reload keeps the assistant connected, with its film still open;
  a rebuild of the shell restarts the app, and the assistant has to
  reconnect.

`scf-core`, `scf-host` and `scf-mcp` are consumed as TypeScript source
via Vite aliases (`@scf-core -> ../scf-core/src` and so on), so keep the
directories siblings.

## Where the work happens

Sections in an always-visible activity bar on the left, grouped in the
order the work is usually done — the project, the story, then who and
what is in it, then the tools, then what leaves the app. `Alt+1` … `Alt+0` switch between the ten
below Project, which has no shortcut so that adding it renumbered
nothing.

| Group | Section | Surface | Owns |
|---|---|---|---|
| — | **Project** | `workspace/ProjectWorkspace.tsx` | The baseline of the film: the `project` row (logline, synopsis, vision), the screenplay's title page (which the Fountain export writes), `technical_specs`, and the project folder. Fields save as you type. |
| Story | **Script** | `ScriptView`, `SceneRail` | The screenplay. CodeMirror 6 over a line-identity model; headings become scenes and `#` sections become acts and sequences, at commit. |
| Story | **Structure** | `StructureView` | Act and sequence boundaries. Three verbs only — start a span at a scene, move it, unanchor it — because membership is derived, not edited. |
| Story | **Shoot** | `ShootView` | Coverage: beats and shots against a read-only scene spine. The script owns structure; this owns what gets shot. Remembers what is expanded and where you were, across a trip to a record. |
| Story | (both) | `ScriptReader` | The screenplay, read-only, beside Structure and Shoot; clicking a scene in either brings it up. |
| Narrative elements | **Characters** | `ui/workspace/`, `scf-core/src/ops/elementOps.ts` | Everything about one character in subtabs, written as the writer works. Authors by intent; `elementOps.ts` turns each intent into ordinary rows. Profile, Look and Voice (reference boards: point at a file in the project folder, say what it is for, and `scf-core/src/ops/mediaOps.ts` writes the bundle, binding, anchor or relationship — nothing is copied, per conventions §9), Wardrobe (costumes with their own boards, worn-in scenes, wardrobe stages, makeup by scene), Physicality (motion board, habits, shifts, places), Relationships (a map from the character's side, direction as the writer reads it), Arc, and Scenes & Lines (presence and speech read from the script by the §3.4 heading walk, scene links with role and variant, every speech opening the Script at its cue by line uuid, shots, props carried, themes) are built — every character tab. Identity tiles carry two small editors (`AnchorScope.tsx`): drag a box over the image to mark the face (`region_box`), or mark in and out on a waveform for the voice (`audio_offset_*`). Clicking a character chip in the Script opens their workspace. Every board carries exceptions — a scene range, a state, a variant — ordered by precedence, and an "as of scene" control in the header shows what is in force there using Q13's own resolution, the last two on one story strip (`StoryStrip`, `state/storyStrip.ts`) that draws latest-wins stages across the scenes. |
| Narrative elements | **Locations**, **Props** | `LocationWorkspace`, `PropWorkspace`, `SubjectShell`, `SubjectRail` | The same shell, rail, boards, exceptions and "as of scene" as Characters (`state/subjectKinds.ts` names what differs). Locations: Profile, Look (board, design, color), Sound (board, sound profile), Variants (each with its own references, bound as a variant exception), Scenes (the variant §12.17 picks per scene). Props: Profile, Look (board, surface), Variants, Through the story (states and custody on the strip), Scenes (links with significance and version, script tags). |
| Tools | **Subjects** | `SubjectNav`, `SubjectView` | One thing and everything addressed to it. |
| Tools | **Queries** | `ui/queries/` | The 16 canonical queries, each with view / JSON / copy-as-context. |
| Tools | **Schema** | `CategoryTree`, `EntityList` | Every entity type, with row counts. The complete record editor; every workspace section links back to it. |
| Tools | **Assets** | `AssetBrowser`, `BundleAssets`, `AssetPreview` | Bundles, bindings and anchors, and whether an identifier resolves to bytes. |
| Presentation | **Shot list** | `ShotlistView`, `scf-core/src/shotlist.ts` | Read-only. The shots as a printable shot list — frame, code, size, angle, lens, move, seconds, action, Done — with column, page and layout options, printed or saved as PDF through the browser. See [`editor-mvp.md` §7g](../docs/editor-mvp.md). |
| Presentation | **Screenplay** | `ScreenplayView`, `state/screenplayLayout.ts` | Read-only. The committed script as industry pages — title page, Courier grid, scene numbers, (MORE)/(CONT'D) — exported as FDX, Fountain, or PDF via print. |
| Presentation | **Gallery** | `GalleryView`, `scf-core/src/gallery.ts` | Read-only. Every asset as a masonry wall, sorted by importance (derived from what each asset reaches and how much of the film that is), alphabetically, newest or at random, with a viewer stepped by the arrow keys. |
| Presentation | **Storyboard** | `StoryboardView`, `scf-core/src/storyboard.ts`, `ShotFrame` | Read-only. Each shot's storyboard panel (else start frame) in shot order, at the project's aspect ratio. Board (scenes as rows or columns, captions below or over the frame) and Lightbox (contact sheet, and a full-screen viewer stepped with the arrow keys). |

## Architecture

```
browser window                             host process (scf-host)
──────────────                             ───────────────────────
React UI (registry-driven)
   │ reads:  exec(sql)  ───────────────►   read-only connection
   │ writes: call(name, ...args) ──────►   scf-core call table, one write
   │                                       queue per file, then the .scf
Zustand store (state/store.ts)             ◄── revision events (also for
   │                                           the MCP's writes)
HostClient (@scf-host/client)  ── WebSocket on 127.0.0.1, token + Origin
```

- **Write-through.** Every change is in the `.scf` as soon as it is
  made. There is no Save button; **Save as…** copies the film to a new
  path and carries on there. Undo is the safety net.
- **The window holds no write function and issues no write SQL.**
  Everything that changes the film is a named call from
  `scf-core/src/ops/calls.ts`, made through `call()` in
  `state/api.ts`; a test (`test/noInlineWrites.test.ts`) pins both.
- **Reload resumes.** The film's path is in browser storage, and the
  host still has the file, so a refresh walks straight back in. An
  explicit Close sets `scf:auto-resume=0` so closed stays closed.
- **Choosing a file** goes through `ProjectChooser`
  (`files/projectChooser.ts`): today a dialog listing folders from the
  host (`ChooserDialog`), later the operating system's own dialog. The
  **asset folder** is still acquired in the browser (`FileAdapter`,
  `files/fileAdapter.ts`) as a read-only directory handle, remembered
  per project path in IndexedDB (`files/handleStore.ts`); Chromium
  re-asks for permission after a reload, which is unavoidable and
  correct.
- **One window at a time.** A second tab is refused (a Web Lock):
  two windows would each commit their own copy of the script over the
  other's.
- **Transport is swappable.** `HostClient` talks to a `HostTransport`;
  the WebSocket is one implementation, and a desktop shell would supply
  another without touching a view.

## Patterns worth knowing before changing anything

- **Display labels are derived, never stored.** `scf-core/src/displayName.ts`
  is the single place: scenes lead with their number, shots with their
  shot number, and a link entity whose `nameField` is hidden gets a
  label composed from the rows it points at. Adding a column to a list
  query is usually the fix when a row reads as `Thing #12`.
- **References resolve one query per table, not per row** — `useRefNames`.
- **Structure is derived from boundaries** (`@scf-core/structure.ts`).
  Anything drawing acts and sequences as nested must group by
  `actOutline()`, because a sequence may cross an act boundary.
- **`useQuery(sql, params)` re-runs on the store's `revision`.** That is
  the host's revision: it moves after any write by any client, so a
  change the MCP makes shows up here exactly like a local edit. Writes
  go through `call()`, which keeps it current; do not write around it.
- **Findings, never enforcement.** Duplicates, dangling boundaries and
  contradictions are reported; nothing is rejected on write.

## Testing

`npm test` runs Vitest against the checked-in fixture
(`../fixtures/hollow_creek.scf`) using the Node SQLite driver.

**A test must not import a view.** Importing anything that reaches
`state/store.ts` connects to a host, and needs a browser's globals.
`test/windowOnHost.test.ts` shows the one sanctioned way to do it: a
real host started through the dev-server plugin, with the file chooser
stubbed. Logic that deserves a test lives in a module the view imports —
`scf-core/src/ops/shootOps.ts`, `scf-core/src/displayName.ts`, `scf-core/src/subjectStats.ts`,
`scf-core/src/ops/undoDelete.ts` — not in the component.

## Where it is going

[`../docs/editor-mvp.md`](../docs/editor-mvp.md) is the editor's design
record: what the four work packages of the second-implementation plan
were, which have landed, and what is left before MVP. Read it before
starting anything that sounds like a new surface — and add to it rather
than starting a new document, which is how the last one got lost.

[`../docs/narrative-workspaces.md`](../docs/narrative-workspaces.md) is
the design record for the Characters, Locations and Props workspaces:
the intent-to-rows wiring, what was decided, what was built, and what is
still open.

## Conventions

The format's rules are in `../spec/scf-spec.md`; the reasoning behind
them is in `../docs/conventions.md`. Read conventions §2 (derived versus
stored) and §4 (structure) before touching labels or the outline views.
