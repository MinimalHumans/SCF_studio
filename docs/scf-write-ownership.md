<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# One host for every `.scf` — design note

**Status: decided in outline, partly built.** First written 2026-10-12;
rewritten 2026-10-18 after the decisions in §2. Supersedes the
"`scf-mcp` has no write tools" line in
[`scf-mcp-design.md`](scf-mcp-design.md) §1 once built.

---

## 1. The problem

The app and the MCP both reach SQLite through `SqlExec`, but treated the
file differently and shared no write logic.

| | App (before) | MCP (before) |
|---|---|---|
| Driver | sqlite-wasm in a worker, on OPFS | `node:sqlite`, read-only, per call |
| Live DB | an OPFS **working copy** | the `.scf` on disk |
| Persistence | `exportBytes()` → whole-file overwrite on Save | none |
| Write logic | in the views and `*Ops` modules | none |

Two consequences: no shared invariants (scene cascade, shot renumbering,
numbering policy…), and two writers clobbering each other (the app's Save
replaces the whole file).

## 2. Decisions

1. **One host process owns every open file.** It is the only process that
   opens a `.scf`. The window and the MCP are both clients of it.
2. **The host is required.** No browser-only mode, no OPFS working copy,
   no second code path. `npm run dev` starts the host together with Vite,
   so the development experience does not change.
3. **Write-through.** Every committed write is durable in the file
   immediately. There is no Save for a host-backed project; undo is the
   safety net.
4. **The host owns writes; clients send intent.** Reads are SQL on a
   read-only connection. Writes are **named ops** from a registry in
   `scf-core`, run by the host. No client sends write SQL.
5. **Tauri is out of scope.** It will later wrap the same host and add a
   native file dialog; nothing here should make that harder.

### Why writes are ops and not SQL

If the host only proxied `exec`, each client would run its own
`BEGIN … COMMIT` over a shared connection, and interleaved transactions
would let one client's rollback undo another's work. With the host
running ops, a transaction never spans a network round trip, and the
revision token, the integrity gate and provenance live in one place. It
is also the existing rule ("nothing outside `scf-core/src/ops` issues
write SQL", pinned by `scf-app/test/noInlineWrites.test.ts`) enforced at
runtime.

## 3. Shape

```
 window (Vite page) ─┐                    ┌─ Session(film A)  openNodeSession
 MCP shim (stdio)   ─┼─ loopback + token ─┤  Session(film B)  one write queue each
 scripts / CLI      ─┘      host          └─ op registry (scf-core)
```

- **Protocol.** Request/response over a loopback WebSocket (events need a
  push channel): `open(path)`, `query(sql, params)`, `op(name, args,
  expectedRevision?)`, `close`, plus `revision` events to every client of
  a file. `query` rejects anything that is not a single read statement
  and runs on a read-only connection.
- **Op registry** (`scf-core`). A name → handler map with argument
  validation, so the MCP's tools and the window's calls are the same
  table. `Session.write` already serialises and counts.
- **Client library.** One `HostClient` for browser and Node, exposing
  `SqlExec` for reads and `call(op, args)` for writes, so views and tools
  keep their shape.
- **Current film is per client connection.** An MCP `open` never changes
  what the window shows. Two clients on the same file share one session
  and one write queue.

### 3.1 Development

`npm run dev` in `scf-app` starts the host and Vite as one command. A
Vite plugin (`scf-app/tools/scfHostPlugin.ts`) starts the host
**inside the dev server's process**, loading `scf-host` and `scf-core`
from TypeScript source, so there is no build step and an edit takes
effect on restart like any other. The host's lifetime is the dev
server's, including on Ctrl-C. Direct use of a bare host is the
`scf-host` command.

The plugin allow-lists the dev server's own origin and serves the
connection details (`{url, token}`) at `/__scf-host`. Vite's dev server
sends permissive CORS headers, so that endpoint answers only a request
the browser marks same-origin, with a matching `Host`, and sets no CORS
header; another site cannot read the token. The host also writes the
discovery file, so an MCP started during development shares this host.
If a host is already running the plugin refuses to start a second.

### 3.2 Startup from an MCP call

If no host is running, the MCP shim starts one: read the registry
directory for `{pid, port, token, version}`; a dead pid is stale and is
deleted; take a start lock so concurrent shims do not both spawn; spawn
the same binary in serve mode, detached; wait for the registry entry and
a ping; on timeout, fail naming the host's log file. A host with no
clients for N minutes flushes and exits; one started by the window stays
while the window is open.

### 3.3 Version skew

The shim compares versions on connect. An old idle host is asked to exit
and is respawned; a busy one produces a clear error rather than a
mismatched protocol.

## 4. Choosing a file

A browser cannot hand a host a file path. Until Tauri provides a native
dialog:

- The window gets a **host-side file chooser**: the host lists
  directories and `*.scf` under a configured set of roots, plus a recent
  list. The user picks; the host opens by path.
- The MCP already works in paths.
- The host canonicalises paths at the boundary (see §8, WSL) and the
  canonical path is the session key.

The **asset folder** keeps today's File System Access handle for now;
resolving assets through the host (and dropping the handle store, object
URL cache and locator) is a follow-on, not part of the first cut.

## 5. Safety

File-level contention disappears with one connection per file. Logical
conflicts do not: an agent reads shot 10A, the user renumbers, the agent
writes against stale assumptions.

- **Expected-revision token** on every write; reject if the session has
  moved. `Session.revision` is the source.
- **One transaction per op.** Ops are already `withTransaction`; none may
  nest.
- **Plan → confirm → apply** for destructive ops, reusing
  `planSceneRemoval`, `planCommitStructure`.
- **Integrity gate.** Run `scanIntegrity` inside the transaction and roll
  back if the write adds findings the file did not already have.
- **Snapshot** the file before the first write of a host session.
- **Provenance.** Undo entries and the change journal record the client
  (window, MCP agent id): "Added shot 10B (via MCP)".
- **Out-of-band edits.** `Session.hasExternalChange()` (mtime and size)
  is checked before each write; on a change the host refuses and tells
  the client, never overwrites.

## 6. Keeping the window unsurprising

- **Data only, never navigation.** An agent's write arrives as a
  `revision` event and refreshes lists exactly as a local edit does.
  Selection, tab and scroll are window-local and unreachable.
- **Presence.** A small indicator shows an agent is connected.
- **Drafts.** If the user has an unsaved form draft on a row an agent
  just changed, warn at commit rather than overwrite silently.

## 7. Security

The host exposes a local write endpoint and a filesystem listing, so it
is not "just localhost":

- Bind `127.0.0.1` only. A random per-session token, held in a
  user-only registry file, is required on every connection.
- Check the `Origin` header on the WebSocket upgrade against the Vite
  dev origin; a web page the user happens to visit must not be able to
  reach the host.
- The file chooser lists only under configured roots and never follows a
  path outside them.
- Every write is attributable to a client (§5).

## 8. Platform notes

- **WSL.** The repo lives on `/mnt/f`. A shim in WSL and a host on
  Windows (or the reverse) share neither unix sockets, pids nor the
  registry directory, and the same file is `F:\…` on one side and
  `/mnt/f/…` on the other. Require shim and host to be the same OS, or
  use loopback TCP with a canonical-path rule at the boundary. Settle
  this before routing is built; session keys are paths.
- **Process startup is slow on `/mnt/f`.** The MCP smoke suite already
  needs ~8 s for two sequential server starts here, so host start-up
  timeouts must be generous and configurable.

## 9. Edge cases to settle

1. A cloud-sync client replaces the `.scf` under a running host (§5,
   external change).
2. A second host on the same path (two users, a network share): the
   start lock covers one machine only; take a per-file advisory lock in
   the session.
3. Host crash with queued writes: acknowledge only after COMMIT.
4. Stale registration after a hard kill: pid liveness check, then
   respawn; the file is safe because SQLite transactions are atomic.
5. Existing OPFS "Resume" copies from earlier sessions are abandoned;
   say so once on first run.

## 10. Order of work

Done on branch `fileio`:

- ✅ Write logic in `scf-core/src/ops/` (scenes, shoot, elements, media,
  structure, record create/update/delete, title page, script features,
  import, integrity); the app issues no write SQL.
- ✅ `Session` (`scf-core/src/session.ts`): revision, dirty, persist
  watermark, external-change token, serialised writes; `openNodeSession`
  is the file-backed driver.

- ✅ **Op registry** (`scf-core/src/ops/opTable.ts`): named ops,
  validated plain-data arguments, `callOp` with an expected-revision
  check. Covers records, shots, beats and title page so far; ops that
  take live objects get plain-data wrappers as the window needs them.
- ✅ **`scf-host`**: transport-free core, WebSocket server with token,
  `Host` and `Origin` checks, discovery file. Tested with a real socket.
- ✅ **`HostClient`** (`@minimalhumans/scf-host/client`) over a
  `HostTransport`; WebSocket adapter, plus a Node `connectToHost`. A
  Tauri `invoke()` adapter implements the same four-method interface.
- ✅ **Dev integration**: the Vite plugin above.

To do:

5. **Window migration**: replace the SQLite worker, OPFS copy and Save
   with the host; add the file chooser; delete the worker driver and
   working-copy code; update README ("local-first, no server" becomes
   "local-first, one local host").
6. **MCP**: tools become `HostClient` calls; add write tools with §5.
7. **Phase 4 reads**: promote the app-only queries to core so the host
   serves one read surface.
8. **Docs**: update `scf-mcp-design.md` §1 and `conventions.md` §9, which
   describe the MCP and the filesystem as read-only, and the
   "no server" claims in the READMEs.
