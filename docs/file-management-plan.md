<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# File management in the desktop editor — implementation plan

**Status: completed.** Implemented and verified across Steps 0–5 (Docker
dev image, app.db shared store, native dialogs with unconfined machine
access, path-based asset resolution, pairing & suggestions on open, and
documentation).

## 1. Why

The editor now ships as a desktop app (Tauri), but its file handling is
still shaped by the browser it started as:

- **The host confines paths to "roots".** `host_setup`
  (`scf-app/src-tauri/src/lib.rs:44`) defaults the only root to the
  user's home folder, and `scf-host` refuses `list`, `create` and
  `saveAs` outside it (`scf-host/src/core.ts`, `requireInRoots`). On
  Windows that puts every other drive letter, and every network drive,
  out of reach. The chooser has no way to change drives.
- **The file chooser is a stand-in.** `ChooserDialog`, `hostChooser.ts`
  and `projectChooser.ts` exist because a browser cannot hand a host a
  file path. A desktop app has a native dialog.
- **The asset root is a browser folder handle.** `attachRoot` calls
  `window.showDirectoryPicker`, handles are remembered in IndexedDB
  (`handleStore.ts`), and the root is only accepted if it holds the
  `.scf` at its top level (`classifyRootPairing`). That ties the project
  file to the asset folder, puts SQLite's `-wal`/`-shm` files in the
  user's media folder, and cannot be shared with the MCP.
- **The MCP does it differently.** It takes a `roots` map per session
  and persists only `recentFiles` (`mcp-config.json`).

## 2. Decisions

These were settled in discussion and are not reopened by this plan.

1. **The desktop app has full machine access.** No folder confinement,
   including other drives and network drives.
2. **Native OS dialogs** replace the custom chooser. The browser folder
   handle is dropped entirely.
3. **The project file and the asset root are independent.** They may be
   the same folder or not; the user decides. Defaults for the pickers
   are the last folders used, not app data and not the home folder.
4. **The pairing is per machine and app-level.** One store, read and
   written by both the editor and the MCP. Never stored inside the
   `.scf` (the file stays portable).
5. **History is permanent** until the user forgets an entry. Rows are
   tiny; nothing is pruned automatically.
6. **The project `uuid` is the identity** a mapping is matched on. The
   path is the primary key of a record; the title is a weaker hint.
7. **Auto-assign on UUID match; no automatic assignment from a guess.**
   A path match is applied silently (exact file opened before). A UUID
   match is the project's own identity across copies, versions and
   locations: when opening an unmapped path, a matching row's asset root
   is auto-assigned silently. Anything found only by title or base name
   is a weak guess and is offered in the suggestion dialog, never applied
   automatically.
8. **Forgetting is frictionless.** Every remembered entry has an ✕, as
   in a browser's history. These are conveniences and are easy to
   rebuild.
9. **Save As carries the asset root** to the new file.
10. **Storage is SQLite** (`app.db` in the app data directory), not an
    OS preference store (see §3.1).
11. **Asset access is consolidated in one host module, read-only for
    now.** It is the future media translator for a multi-user host.
12. **Thumbnails stay with the browser for now.** Host-side thumbnail
    generation is deferred until the media loader exists.
13. **No filesystem search** for asset folders. Revisit with user
    stories.
14. **Builds and tests run in Docker**, not in the WSL checkout.

## 3. Design

### 3.1 The store: `app.db`

An OS preference store (`QSettings` and its equivalents: the registry,
a plist, an `.ini`) was considered and rejected. This is a growing,
queryable table that two processes write, not a handful of preferences;
the registry is a poor home for it, can be locked down or roamed on
managed machines, and the standalone `scf-mcp` (a Node process) would
need native code to read it. SQLite is already a dependency of every
other component and handles concurrent writers.

**Location.** `app_data_dir()/app.db` (the directory `host_setup`
already returns as `data_dir`). The standalone MCP derives the same path
from the app identifier `com.minimalhumans.scf-editor`.

**Schema** (`PRAGMA user_version` carries the migration number; WAL mode
and a busy timeout are set on open):

```sql
CREATE TABLE project (
  path_key     TEXT PRIMARY KEY,   -- canonical path; lower-cased on Windows
  scf_path     TEXT NOT NULL,      -- the path as the user would recognise it
  uuid         TEXT,               -- the project row's uuid, when known
  title        TEXT,               -- the project's working title (project.name)
  base_name    TEXT,               -- file name without extension or version suffix
  asset_root   TEXT,               -- absolute folder path, or NULL
  last_opened  TEXT NOT NULL       -- ISO 8601, UTC
);
CREATE INDEX project_uuid  ON project (uuid);
CREATE INDEX project_title ON project (title COLLATE NOCASE);

CREATE TABLE pref (
  key   TEXT PRIMARY KEY,          -- lastProjectFolder, lastAssetFolder, ...
  value TEXT NOT NULL
);
```

More than one row may share a `uuid` (a versioned copy elsewhere, a
Save As). That is expected and cheap.

**Access.** One TypeScript module (`appStore.ts`, in `scf-host` so both
consumers can import it) over a small `exec`/`query` interface, with two
implementations: the window's existing Tauri SQL commands
(`scf-app/src-tauri/src/sql.rs`, `tauriSql.ts`) and the Node driver used
by the standalone `scf-mcp`. Step 1 starts by confirming the Tauri SQL
commands can open a database that is not a film.

**Corruption.** If `app.db` cannot be opened or fails an integrity
check, move it aside as `app.db.bak` and start empty. History is never
silently dropped without leaving the old file.

**Migration.** On first run, import `recentFiles` from
`mcp-config.json` as `project` rows with no uuid, title or asset root
(they are filled in the next time each file is opened). Leave the old
file untouched.

### 3.2 Resolving the asset root when a project opens

On every `open` (editor or MCP):

1. Read the film's project row (`uuid`, `name`) through the session. This
   is cheap and read-only.
2. Look up `path_key` for the canonical path.
   - **Found, with an `asset_root`:** attach it silently. Check the
     folder exists. If it does not, keep the entry, show "assets: not
     found at X", and offer Choose… (see §3.5).
   - **Found, no `asset_root`:** the project opens unmapped; the topbar
     offers Choose…
3. **Not found or unmapped:** check for existing mappings with an asset
   root attached:
   1. rows with the same `uuid` (strong identity): auto-assign the asset
      root silently and persist it for this path.
   2. rows with an exact (case-insensitive) `title` match, or the same
      `base_name` with its version suffix stripped by the same rule as
      `suggestSaveAsName` (weak): show the suggestion dialog (§3.5).
      Choosing one copies its `asset_root` to this path. Choosing nothing
      opens the project unmapped.
4. Update `uuid`, `title`, `base_name` and `last_opened` on every open.

After any attach, run the existing asset resolution check and show the
result ("38 of 40 assets found") so a wrong choice is visible.

**Save As** writes a new row for the new path with the same `uuid`,
`title` and `asset_root`.

**New project / the demo** create a row with no asset root.

### 3.3 Native dialogs and no confinement

- Add `tauri-plugin-dialog` (Cargo, `package.json`, `lib.rs`, and the
  permissions in `capabilities/default.json`).
- Three pickers: open a project (filter `*.scf`), save/new project
  (suggested name), choose asset folder (directory).
- Each starts in the matching `pref` folder
  (`lastProjectFolder`, `lastAssetFolder`), and updates it after use.
- Remove roots from the app's host: `host_setup` stops returning
  `roots`, and `scf-host` treats "no roots configured" as unrestricted.
  `SCF_HOST_ROOTS` keeps working as an opt-in restriction for the
  standalone host, CI and the tests.
- Remove the host's `list` method and the chooser UI once nothing uses
  them.

The drive-letter problem is solved by the native dialog: it switches
drives, shows network locations and takes UNC paths.

### 3.4 One place for asset access (read-only)

A host module, `assets`, is the only code that reads asset bytes:

- `stat(root, identifier)`, `exists(root, identifier)`,
  `read(root, identifier, range?)`.
- Takes `@project/...` identifiers, resolves them against the project's
  asset root, and rejects any path that escapes the root (`escapesRoot`
  already exists in `scf-core`).
- Unmapped root → `unaddressed`; mapped root, nothing there → `missing`
  (the distinction `scf-mcp-design.md` §5.2 requires).

Consumers:

- **Editor:** the asset locator, previews and thumbnails read through the
  host (`fs_stat` already exists in `files.rs`; add a ranged read). The
  browser still decodes images, as today.
- **MCP:** the locator in `windowMcp.ts` and `nodeLocator.ts` read
  through the same module.

Read-only for now. Writes (imports, relinking files on disk) are not in
scope. This is the seam a multi-user host later replaces with a media
translator.

### 3.5 UI

- **Start screen:** a "Recent projects" list from `project`, ordered by
  `last_opened`: title, path, asset root. Missing files and missing
  roots are marked, not hidden. Each row has an ✕ that forgets the
  entry, with no confirmation. A "Clear history" action sits at the end
  of the list.
- **Topbar:** shows the asset root, with Change… (native folder
  dialog), Open in file manager, and Forget mapping.
- **Suggestion dialog** (opening a project with no entry): lists the
  candidates, strong matches first, then weak, most recent first. Each
  shows title, the project file it came from, and the asset folder. A
  row can be chosen ("Use this folder") or dismissed with an ✕ (forgets
  that history entry). There is also "Choose a different folder…" and
  "Open without assets".
- **Demo:** unchanged apart from using the native save dialog.

## 4. What gets removed

- Browser folder handle code: `files/fileAdapter.ts`,
  `files/handleStore.ts`, the handle-based parts of
  `files/assetLocator.ts`, `files/objectUrlCache.ts` (re-keyed or
  replaced; see below), and their tests.
- `projectRoot`, `rootMode`, `rootPermission`, `rootVerified`,
  `attachError` and the related actions in `state/store.ts` — replaced
  by `assetRoot: string | null` and a status.
- The chooser: `ui/ChooserDialog.tsx`, `files/hostChooser.ts`,
  `files/projectChooser.ts`, the host `list` method.
- The `at-root` / `below-root` / `outside-root` gate
  (`classifyRootPairing`). The check that the folder is *this project's*
  becomes the resolution result shown after attaching.
- `localStorage` `scf:last-session`: replaced by the history.

Thumbnail and object-URL caches that were keyed by root name stay as they
are for now, keyed by the root *path* instead. Moving thumbnails to the
host is deferred (decision 12).

## 5. Implementation steps

Each step leaves the app working and ends with its tests passing.

### Step 0 — Docker build and test image
- `docker/dev.Dockerfile`: Node (`.nvmrc`), Rust stable, Tauri's Linux
  build dependencies.
- A script to build `scf-core`, `scf-host`, `scf-mcp`, run their tests,
  build the page, and `cargo check`/build the Tauri shell.
- **Done when:** one command runs the same checks as `ci.yml` locally.
- Windows-only behaviour (NSIS, signing, WebView2, UNC paths) is not
  covered here; see §7.

### Step 1 — The store
- `appStore.ts` with the Tauri and Node implementations, schema and
  migration, atomic open, corruption handling.
- Import `recentFiles` from `mcp-config.json`.
- MCP: `open` and `recent_files` read and write `project`; `set_root`
  writes `asset_root`. An explicit `roots` argument still wins for the
  session and is saved.
- **Tests:** schema creation and migration; path-key normalisation
  (Windows case); two connections writing; corrupt-file recovery; MCP
  fallback to the stored root.

### Step 2 — Native dialogs, no confinement
- Add the dialog plugin; wire open / save-as / new / choose-folder.
- Remove roots from the app host; keep `SCF_HOST_ROOTS` opt-in.
- Last-folder prefs for the project and asset pickers.
- **Tests:** host with no roots accepts any path; with roots still
  refuses; folder prefs updated after use.

### Step 3 — Path-based asset root and the assets module
- The host `assets` module and its consumers (editor, MCP).
- Replace the folder-handle state in `store.ts` with `assetRoot`.
- Attach through the native folder dialog; write the `project` row.
- Delete the browser-handle code (§4).
- **Tests:** identifier resolution; `..` escape rejected; `unaddressed`
  vs `missing`; editor and MCP resolve the same file for the same
  mapping.

### Step 4 — Pairing on open, history UI and suggestions
- Open-time lookup and suggestion flow (§3.2), Save As carry-over.
- Start-screen history with ✕ and Clear; topbar controls; suggestion
  dialog.
- **Tests:** path hit attaches silently; uuid hit is offered and not
  applied; title / base-name hit is offered; most-recent ordering; the
  ✕ removes a row; a moved root is reported and the entry kept; Save As
  copies the root.

### Step 5 — Documents and clean-up
- Rewrite `conventions.md` §9 ("the project folder is a workflow") for
  independent file and root; update `scf-write-ownership.md` §4 and §7
  (roots, chooser), `scf-mcp-design.md` §5.2 (the stored pairing),
  `editor-mvp.md`, `developing.md` (dialogs, Docker), and the README
  notes on files.
- Remove dead code and tests left from the old model.

## 6. Risks and things to verify early

- **uuid across versions.** Confirm in step 1 that the project row's
  `uuid` survives Save As and a file copied between machines, and that
  *New project* mints a new one. The design rests on it.
- **Tauri SQL commands.** Confirm they can open `app.db` (not a film)
  with WAL and a busy timeout, before step 1's schema work.
- **Asset reads on WebView2.** Check that previews of large media can be
  read in ranges through the host without copying whole files into the
  page.
- **Network drives.** An unreachable share can make `read_dir`/`stat`
  hang. Asset checks need a timeout and a clear "not reachable" state.
- **Two writers.** The editor and the standalone MCP can write
  `app.db` at once; WAL plus a busy timeout is the design, and step 1
  tests it.
- **Linux dialogs.** The dialog plugin needs a desktop portal or GTK in
  the AppImage; verify on a real Linux desktop.

## 7. Testing and verification

- **Docker (Linux):** unit tests for every package, the page build, the
  Tauri shell build, and the store and host behaviour. A headless run
  of the Linux shell is possible (Xvfb) but cannot exercise native
  dialogs.
- **Windows (manual, then CI):** drive letters, a mapped network drive
  and a UNC path in both dialogs; a `.scf` on one drive with assets on
  another; a project versioned elsewhere and opened for the first time
  (suggestion offered, nothing applied); Save As keeps the root; ✕ and
  Clear history; app restart keeps the history; installer and portable
  copy both work; signed installer still verifies.
- **Regression:** the fixture parity, query expectations and round-trip
  tests are untouched by this work and must still pass.

## 8. Out of scope

- Host-side thumbnail generation and the media translator.
- Writing to the asset root.
- Searching the filesystem for asset folders.
- The multi-user host.
- Putting any path or mapping inside the `.scf`.
