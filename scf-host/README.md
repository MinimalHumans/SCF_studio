<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-host

The one owner of each open `.scf`. The editor and every agent's MCP
server are clients of it, so a film open in both is one session with one
write queue; see [`docs/scf-write-ownership.md`](../docs/scf-write-ownership.md)
for why and what was decided.

It is a core, not a process: the desktop app's window runs it
(`scf-app/src/host/windowHost.ts`) on the files and SQLite its shell
provides, and its clients reach it in-process. Here it also runs on
Node's (`src/nodePlatform.ts`), which is what the tests use.

```
npm test
```

## What a client can ask

A request is a method and its params (`src/protocol.ts` has the types;
they import nothing from Node).

| Method | Does |
|---|---|
| `hello`, `status`, `ops` | Name the client; what is open; the op table with JSON Schemas. |
| `open`, `close`, `reload` | The connection's current film. Opened by path, held only while some client has it. `reload` re-reads after an outside edit. |
| `create`, `saveAs`, `list` | A new film (empty, or from bytes), a copy, folders and `.scf` files. Confined to the host's **roots**. |
| `query` | One SELECT (or a schema pragma) on a read-only connection. |
| `op` | A write from the curated table in `scf-core` (`ops/opTable.ts`): named, schema-checked arguments, an expected revision, **the integrity gate on by default**, `dryRun` to see what it would do. For tools. |
| `call` | A write from the editor's table (`ops/calls.ts`): a function by name with its own positional arguments. |
| `journal` | Recent writes to the open film and which client made each. |
| `shutdown` | Exit, refused while any other client is connected. |

Every write is serialised per film, bumps a **revision**, is announced to
every client of the film, and is **journalled** with the client's name.
Revisions keep rising when a film is closed and reopened. A write made by
`op` is preceded by a **snapshot** of the file (once per ten minutes per
film, last ten kept) and held to the **integrity gate**; if the snapshot
cannot be taken, the write is refused.

## Pieces

- `src/core.ts` — the host: `connect()`, then `handle(method, params)`.
  Imports nothing from Node; its files, SQLite and paths come from a
  `HostPlatform` (`src/platform.ts`).
- `src/paths.ts` — path spelling for Windows and POSIX without
  `node:path`, for the window.
- `src/nodePlatform.ts`, `src/hostCore.ts` — the same core on Node, for
  tests.
- `src/client.ts` — `HostClient` (`@minimalhumans/scf-host/client`),
  browser and Node. It talks to a `HostTransport`; `connectInProcess`
  is the one there is, a client in the same page as its core.

## Settings

The window's host takes its roots from `SCF_HOST_ROOTS` (a
path-delimited list), or else the user's home, plus the checkout's
`fixtures/` and `templates/` in a debug build. Snapshots and the journal
are kept in the app's data folder.

## Limits

Session keys are paths, so under WSL `F:\…` and `/mnt/f/…` are different
sessions. Opening an existing film by path is not confined to the roots
(a tool is given paths); browsing and creating are.
