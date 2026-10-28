<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# UI rework: project tabs, tool tabs, status bar

**Status: design, nothing built.** Covers the title-strip tab model, the
bottom status bar, and the app-scoped services behind the tool tabs
(media queue, settings, audit log). Windows first; macOS keeps its
native menu.

## 1. What the code does today

Facts the design rests on, read from the tree:

- **The host already holds many films.** `HostCore.films` is a
  `Map<path, Film>` (`scf-host/src/core.ts`). A *connection* has one
  film (`ConnectionImpl.film`), and several connections can share one
  film, which is how the MCP and the window already coexist. So "one
  host connection per project tab" needs no host change.
- **The window is single-film everywhere else.** `state/store.ts` is
  one Zustand store holding the film's path, revision, asset root,
  form draft, selection, per-section tab memory, `shootView`, undo and
  external-edit state. `hostClient.ts` is one shared `getHost()`;
  `exec` in the store, `call` in `state/api.ts`, the asset locator in
  `ui/queries/runners.ts`, and the object-URL and thumbnail caches in
  `files/` are module singletons that assume that one film.
- **Chrome is one flat header.** `Workbench.tsx` renders `HostBanner`,
  a `topbar` (project name, schema label, `RootStatus`, Identity
  toggle, `SearchBox`, `SaveControls`, Close project), then
  `ActivityBar` and the rail. The window has native decorations
  (`tauri.conf.json` sets none of `decorations`).
- **Single-window guard.** `guardSingleTab()` holds a Web Lock so a
  second *browser page* cannot edit the same film. Tabs inside one page
  do not conflict with it.
- **A write journal exists** in the host (`JournalEntry`: time,
  revision, `by`, op/call name, truncated args, ok/error; JSONL per
  film in `journalDir`, last 200 in memory). It is the seed of the
  audit log, not the log (section 7).

## 2. Tab model

| | Project tab | Tool tab |
|---|---|---|
| Scope | one open SCF file | app |
| Count | many, one per file; opening an already-open file focuses it | singleton per tool: Media queue, Audit log, Settings |
| Owns | host connection, folder state, save state, external-edit state, nav memory | nothing project-specific; may filter by project |
| Sidebar | the activity bar and rail for that project | none, or the tool's own nav (Settings sections) |

Project identity is the host's canonical path (`platform.real`), so two
spellings of one path cannot open twice.

## 3. State split

Two layers replace the one store.

**App store** (one, Zustand): the ordered tab list, the active tab id,
settings (section 6), media-queue view state, window lifecycle,
`hostStatus`. Persisted tab list replaces `lastSession` and the
`scf:auto-resume` flag: the reload path reopens every project tab, not
one.

**Project context** (one per project tab): `createProjectStore(client,
path)` returns the current store's project-scoped slice, bound to its own
`HostClient`, delivered through a React context. Components keep a hook
with today's call shape (`useProject(selector)`), so the migration is
mostly an import change. In the project slice: `revision`, `assetRoot`,
`assetRootStatus`, `environmentRevision`, `externalChange`,
`externalEdit`, `hostLost`, `draft`, `navMode` and every selection/tab
field, `shootView`, `undo`/`lastChange`, `suggestions`.

Module singletons that become per-context (this list is from the
imports of `store.ts` and is not exhaustive; finding the rest is the
first task of the refactor): `getHost`/`exec`, `call` (`api.ts`), the
asset locator, the object-URL cache, the thumbnail cache. Each is keyed
by context id or moved onto the context. Anything left global that holds
film bytes is a cross-project leak.

`HostBanner`, `RootStatus`, `SaveControls` and the search become readers
of the active project context. `HostBanner`'s "connection lost" and
"file changed on disk" move onto the tab (dot, section 5) with the
banner shown only inside the active tab.

## 4. Inactive tabs: unmount, keep the store

Decision: an inactive project tab **unmounts its view tree but keeps
its project context and host connection.** "Rehydrate" means re-render
from the context, not re-open from the host.

- Memory: CodeMirror documents and decoded thumbnails dominate. They go
  with the unmount; object URLs for the tab are revoked on deactivate and
  rebuilt on activate (the thumbnail cache already supports clearing).
- Restored for free: section, selected character/location/prop and their
  subtabs, "as of scene", `shootView` expansion and scroll, asset prefix.
  These already live in the store because tab switches unmount today
  (see the comments on `schemaCollapsed` and `shootView`), so the pattern
  is established.
- **Must flush before unmount:** the Script view commits its document
  whole, and the form `draft` is unsaved by definition. Switching away
  runs the same commit the view runs on blur; if a draft is dirty it
  stays in the context and the tab shows the dirty dot. Do not discard
  either on switch. This is the one place the choice can lose data.
- An inactive tab still receives host events, so its `revision` and
  external-edit state stay current and its dot updates while hidden.
- A tab that is closed (or whose connection is lost and not restored)
  disposes its context: revoke URLs, `client.dispose()`.

Revisit "keep mounted" only if scroll/selection restore inside
CodeMirror proves unreliable.

## 5. Title strip

`[menu] [Project A ●] [Project B] [+] ...drag region... [palette] [gear] [window controls]`

- **Window chrome.** Needs `decorations: false` on the main window and
  our own minimize/maximize/close, a `data-tauri-drag-region` spacer,
  and Tauri capability entries for the window commands. Snap Layouts on
  the maximize button and resize borders have to be checked on Windows
  11 before committing to this; if they regress, the fallback is
  `titleBarOverlay`-style native controls with our content to their
  left.
- **Menu (hamburger).** File: Open, Save as, Close project, Attach
  folder. View: Media queue, Audit log, Developer (Identity). Help:
  About with schema and build (what `topbar-schema` shows now). macOS:
  native menu, same command ids.
- **One command registry** feeds the hamburger, the palette and the
  shortcuts, so a command is defined once.
- **Tab dot**, one glyph slot, in priority order: problem (folder not
  found, connection lost) as a warning glyph; external edit pending;
  dirty. Folder-not-found moves from the topbar's `RootStatus` to here
  and to the status bar's left side.
- **Tab behaviour, built first:** overflow scroll with the `+` pinned,
  drag reorder, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, middle-click close,
  confirm on close when the project has non-terminal media jobs or a
  dirty draft. `Alt+digit` section shortcuts stay and act on the active
  project.
- **Palette (Ctrl+K)** replaces `SearchBox`. Scope: commands, tool tabs,
  open projects, and entity search within the active project. Entity
  search reuses the existing query; the palette is only the new host.
- **Gear** opens the Settings tool tab. Not in any sidebar.

## 6. Status bar

Left: active project's folder state, empty when healthy. Centre/right:
queue summary (`3 active · 12 queued`, active-job progress), click
opens the Queue tab; media-server connection state beside it,
disconnected in the warning colour. Far right: save state of the active
project. All three read the active context or the app store; the bar
itself has no state.

## 7. Services

### Media server

Separate process, so ffmpeg work cannot stall the editor and survives a
window reload. Run as a Tauri sidecar, supervised by the shell, speaking
a local authenticated socket (the CSP already allows
`ws://127.0.0.1:*`; `src-tauri/src/token.rs` and `pipe.rs` are the
existing token and pipe mechanisms and should be read before inventing a
new one). The UI subscribes to an event stream and sends commands:
pause, cancel, retry, reprioritize.

Job record: `id, project, asset, operation, state, progress, started,
ended, error, thread_slot`. The queue persists across restarts; the
server owns the store. Cache is keyed by content hash and shared across
projects. Concurrency limit and ffmpeg path live in Settings and are
pushed to the server live, so the server needs a `configure` command and
must apply it without a restart.

The project column must be a path or uuid the host can resolve, not a
tab id, since tabs do not survive restarts.

### Settings

A typed config file in the app data dir, defaults in code, resolved
values shown. Sections: General, Storage, Media (ffmpeg detect and test,
threads, hardware accel), Audit (retention, export), Developer
(Identity toggle, verbose logging). Per-project overrides, such as the
asset root, stay in the project (`app.db` keeps the pairing today).
**Every settings write and cache purge emits an audit event from the
first commit that adds it.**

### Audit log

Captured in the host, not the UI, so MCP edits, external edits and media
server actions are all seen. Fields: monotonic id, timestamp, actor
(`user | agent | external | media`), project, action, target uuid,
before/after summary. Append-only with a hash chain
(`hash = H(prev_hash ‖ canonical(event))`).

What the existing journal lacks, to be added in the host's write path:
a target uuid and before/after summary (it keeps a truncated arg
string), an actor *kind* (it has only the client name in `by`), a
record of external edits (the host already fingerprints the file to
detect them, so it knows when one happened), and durability past 200
entries in memory.

**Decision: the log stays out of the `.scf`.** The format is
approaching 1.0 and the log is a local audit trail, not film data, so
every event, project and app alike, lives in app data on this machine.
It does not travel with Save As or a shared file. Putting it in the file
may be revisited after 1.0.

**Storage: SQLite (`audit.db` in app data), with JSONL as the export.**

- The log is browsed by scope, actor, time and *entity*. "Everything that
  happened to this character" is an index on `target_uuid`; over a text
  file it is a full scan and a parse.
- The hash chain needs a serialised read-last-then-append. `app.db`
  already has two writers (the window and the standalone MCP both open
  it, per `appStore.ts`), so two processes can append at once. A
  transaction (`BEGIN IMMEDIATE`) makes that safe; appending to a file
  from two processes does not.
- The seam exists: `AppDb`/`OpenAppDb` in `scf-host/src/appStore.ts` is
  already implemented for both the window (Tauri SQL) and Node. The audit
  store is a second database behind the same seam, so it adds no driver.
- A separate file from `app.db`, so retention, "clear" and export never
  touch the project pairings, and a corrupt log cannot take `app.db`
  with it.
- Plain text is kept as the *export* format (one JSON event per line,
  chain fields included), which gives the greppable, portable copy
  without making it the store. The existing per-film JSONL journal in
  `journalDir` stays as it is; the audit store supersedes it for
  browsing but does not need it removed.

Schema sketch:

```
audit_event(
  id          INTEGER PRIMARY KEY,   -- monotonic, the chain order
  at          TEXT NOT NULL,         -- ISO 8601 UTC
  actor_kind  TEXT NOT NULL,         -- user | agent | external | media
  actor_name  TEXT,                  -- "window", "mcp: Claude Desktop"
  scope       TEXT NOT NULL,         -- project | app
  project_uuid TEXT, project_path TEXT,
  action      TEXT NOT NULL,
  target_entity TEXT, target_uuid TEXT,
  summary     TEXT,                  -- before/after, cut short
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL          -- H(prev_hash || canonical row)
)
INDEX (target_uuid, id)  INDEX (project_uuid, id)  INDEX (at)
```

Project key is the uuid with the path alongside, because one uuid can
sit at several paths (a Save As copy) and a path can be replaced.

What the existing journal lacks, to be added in the host's write path: a
target uuid and before/after summary (it keeps a truncated arg string),
an actor *kind* (it has only the client name in `by`), a record of
external edits (the host fingerprints the file to detect them, so it
knows when one happened), and durability beyond 200 in-memory entries.

Retention (Settings > Audit) prunes by age from the front of the chain;
the oldest remaining event records the hash it chains from, so pruning
does not read as tampering.

Tamper evidence detects edits to the chain; it does not prevent them,
and anyone who can write app data can rewrite the whole thing. The UI
should say "tamper-evident", not "secure".

## 8. Order of work

Each step ships and leaves the app working.

1. **Audit log in the host** (the first order of business): the
   `audit.db` store, the event writer in the host's write path, and
   settings/cache events from the first commit that adds them. No UI
   dependency, so it comes before the refactor; the viewer tab arrives
   with the title strip.
2. **Project context refactor.** Extract the per-project slice and the
   singletons into `createProjectStore`; run with exactly one context so
   behaviour is unchanged. All existing tests must pass untouched except
   import changes. This is the risk; everything else is additive.
3. **Command registry and palette**, replacing `SearchBox`. Independent
   of tabs.
4. **Title strip shell**: custom chrome, hamburger, tab strip with a
   single project tab, tool-tab host with Settings as the first tool tab,
   bottom status bar (folder and save state only).
5. **Multiple project tabs**: open-in-new-tab, focus-if-open, the
   section 4 unmount/flush rules, per-tab dots, close confirm, and
   reopen-all on reload.
6. **Audit viewer tab.**
7. **Media server sidecar**, queue tab and status-bar summary.

Steps 1 and 3 do not depend on the refactor.

## 9. Open questions

- Windows 11 snap layouts and resize borders with `decorations: false`.
- Whether one `HostClient` per tab is enough, or the `window` client
  name needs the tab in it so the journal can tell two of this app's own
  tabs apart (today every window write is `by: "window"`).
- macOS and Linux: same strip with native menu, or the hamburger on all
  three for consistency.
