<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# scf-host

The one process that opens `.scf` files. The app window and the MCP are
clients of it; see [`docs/scf-write-ownership.md`](../docs/scf-write-ownership.md)
for why.

- **`src/hostCore.ts`** — the host without a transport: a session map, a
  read-only `query`, and `op` calls into the named-op table in `scf-core`.
  A file is open only while a client has it open. Drive it with
  `connect()` → `handle(method, params)`; this is the seam a Tauri shell
  would call instead of a socket.
- **`src/server.ts`** — the loopback WebSocket door: `127.0.0.1` only,
  `Host` and `Origin` checks, a constant-time token check, then one JSON
  request per frame.
- **`src/protocol.ts`** — the wire types. No Node imports, so any client
  can depend on it (`@minimalhumans/scf-host/protocol`).
- **`src/registryFile.ts`** — the user-only discovery file clients read
  to find the port and token.

```
npm start            # run a host in the foreground
npm test
```

Clients send intents (`op` with a name and arguments), never write SQL.
`query` accepts a single SELECT on a read-only connection.
