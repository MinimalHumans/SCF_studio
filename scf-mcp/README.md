<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# @minimalhumans/scf-mcp

An [MCP](https://modelcontextprotocol.io) server over a Story Context
Framework (`.scf`) file, so an AI assistant can answer questions about a
film — and assemble a shot prompt — without being handed a schema and
told to write SQL.

It is a local stdio process. Nothing is hosted, and the film never
leaves your machine except as the answers your assistant asks for.

**It reads.** There are no write tools: SCF is the ground truth of the
film, not the workflow for making it.

## Running it from a checkout

From a fresh clone, no build is needed:

```sh
cd scf-mcp && npm ci       # once
node scripts/start.mjs --scf ../fixtures/hollow_creek.scf
```

`scripts/start.mjs` runs `src/server.ts` directly under Node's type
stripping and resolves `@minimalhumans/scf-core` to its `src/` through
the `scf-source` export condition, so there is no `dist/` to build and
none to go stale after a `git pull`. It takes the same arguments as
`scf-mcp` below. It needs Node 22.6 or newer and `scf-core` as a
sibling directory; if dependencies are missing it says so on stderr and
exits. It installs nothing itself.

### Connecting a client

Point the client at `scripts/start.mjs`, not at `dist/server.js`. Both
clients take the same arguments, and `--scf` and `--root` are optional:
without `--scf` the assistant opens a film with the `open` tool.

#### Claude Code

```sh
claude mcp add scf -- node /absolute/path/to/SCF_studio/scf-mcp/scripts/start.mjs \
  --scf /absolute/path/to/film.scf \
  --root project=/absolute/path/to/project/assets
```

Everything after `--` is the server's command line. The default scope
is local, private to you in this project, which is what you want: the
paths are specific to your machine, so do not commit a project-level
`.mcp.json` with them in it.

`claude mcp list` shows whether the server connects, and `/mcp` does
the same inside a session. `claude mcp remove scf` undoes it. Claude
Code starts the server from your shell, so a plain `node` normally
works; if it resolves to the wrong version, give an absolute path as
below.

#### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config,
or `~/Library/Application Support/Claude/` on macOS,
`%APPDATA%\Claude\` on Windows) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "scf": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/SCF_studio/scf-mcp/scripts/start.mjs",
        "--scf", "/absolute/path/to/film.scf",
        "--root", "project=/absolute/path/to/project/assets"
      ]
    }
  }
}
```

- **Use absolute paths, including to Node.** Claude Desktop does not
  read your shell profile, so `node` from nvm or a version manager is
  usually not on its PATH, or is the wrong version. `which node`
  (macOS/Linux) or `where node` (Windows) gives the path.
- **Repository inside WSL, Claude Desktop on Windows:** use
  `"command": "wsl.exe"` and put `node` and the Linux paths first in
  `args`.
- **Logs** are in `~/Library/Logs/Claude/` on macOS and
  `%APPDATA%\Claude\logs\` on Windows (`mcp-server-scf.log`). The
  launcher's own messages appear there.

#### When it does not start

| Message | Cause |
|---|---|
| `dependencies are not installed` | Run `npm ci` in `scf-mcp`. |
| `Node … cannot run TypeScript source` | The Node the client launched is older than 22.6. Use an absolute path to a newer one. |
| `scf-core source not found` | `scf-mcp` was moved away from its sibling `scf-core` directory. |
| `Cannot find module … dist/server.js` | The client still points at the built server. Point it at `scripts/start.mjs`. |

## Running the built package

```sh
scf-mcp [--scf <path>] [--root name=path ...] [--config <path>]
```

All three are optional. With none, the assistant opens a film itself
with the `open` tool. `--scf` opens one at startup, so a single-film
setup needs no call before querying. `--root` maps an asset root named
in the file (`@root/…`) to a folder on this machine — where a film's
media lives is a property of the machine, not of the file (spec §0.3,
§8.2). `--config` reads the same settings from a JSON file
(`{ "scf": "…", "roots": { "name": "path" } }`) for a project with
several roots.

An MCP client starts it as a command, for example:

```json
{
  "mcpServers": {
    "scf": { "command": "scf-mcp", "args": ["--scf", "/path/to/film.scf"] }
  }
}
```

## Tools

| Tool | What it answers |
|---|---|
| `open` | Open, or switch to, a film, with optional root mappings. |
| `recent_files` | Films this or a past session opened — a hint for `open`. |
| `find` | A label (scene number, shot code, name) to its uuid. |
| `list` | Every row of an entity type, optionally filtered, in story order where rows have one. |
| `where_used` | Which rows point at this one. |
| `shot_context`, `shot_media`, `shot_readiness` | A shot prompt in three calls: the frame, what to attach, what is thin. |
| one tool per canonical query | The specification's §12 queries, each with its own typed parameters. |
| `readiness` | Q14, for pre-flight before writing a prompt. |

`scf-mcp/src/server.ts` lists them authoritatively.

## Status

`0.x`. It depends on `@minimalhumans/scf-core`, which carries the
format's 1.0 promise; this package does not yet make one. The design
record is
[`docs/scf-mcp-design.md`](https://github.com/MinimalHumans/SCF_studio/blob/main/docs/scf-mcp-design.md).

Apache-2.0. See `LICENSE` and `NOTICE`.
