<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-host

The one process that opens `.scf` files. The editor window and the MCP are
both clients of it, so a film open in both is one session with one write
queue; see [`docs/scf-write-ownership.md`](../docs/scf-write-ownership.md)
for why and what was decided.

```
npm start            # run a host in the foreground (needs `npm run build`)
npm test
```

In development you do not start it: `npm run dev` in `scf-app` runs a host
inside the dev server. The MCP finds the running host, or starts one
if none is (`src/ensureHost.ts`); a host started so exits by itself a
while after its last client leaves. The desktop app needs no host
process: its window runs the same core (`src/core.ts`) on the shell's
files and SQLite, and serves the MCP itself.

## What a client can ask

A request is `{id, method, params}` over a loopback WebSocket
(`src/protocol.ts` has the types; they import nothing from Node).

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

- `src/hostCore.ts` — the host without a transport: `connect()`, then
  `handle(method, params)`. A WebSocket, a test, or one day Tauri's
  `invoke()` all drive this object.
- `src/server.ts` — the loopback door: `127.0.0.1` only, `Host` and
  `Origin` checks, a constant-time token check, then one JSON request per
  frame.
- `src/client.ts` — `HostClient` (`@minimalhumans/scf-host/client`), browser
  and Node. It talks to a `HostTransport`; the WebSocket is one
  implementation, and `connectInProcess` another, for a client in the
  same page as its core. `src/nodeConnect.ts` finds a running host;
  `src/ensureHost.ts` starts one if none is.
- `src/registryFile.ts` — the user-only discovery file (port, token, pid) in
  `~/.scf-host` or `$SCF_HOST_DIR`, with snapshots, the journal and
  `host.log`.
- `src/serve.ts` — the `scf-host` command (`--idle-exit` for a host started
  on demand).

## Settings

| | |
|---|---|
| `SCF_HOST_DIR` | Where the host keeps its files. Default `~/.scf-host`. |
| `SCF_HOST_ROOTS` | Folders clients may browse and create files in (path-delimited). Default: the user's home. The dev server adds the repository's `fixtures/` and `templates/`. |
| `SCF_HOST_IDLE_EXIT_MS`, `SCF_HOST_START_TIMEOUT_MS` | For a host started on demand (by the MCP): when it exits unused, and how long to wait for it to come up (raise it on a slow disk). |

## Limits

Session keys are paths, so under WSL `F:\…` and `/mnt/f/…` are different
sessions. Opening an existing film by path is not confined to the roots
(a tool is given paths); browsing and creating are.
