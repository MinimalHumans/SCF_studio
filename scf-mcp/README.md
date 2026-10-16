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

## Quick start

You need Node 22.6 or newer and a full clone of the repository
(`scf-mcp` expects its sibling `scf-core` directory).

```sh
cd scf-mcp && npm ci
claude mcp add scf -- node "$(pwd)/scripts/start.mjs"
claude mcp list        # scf should show as connected
```

That is the whole setup. Ask your assistant to open a film and it will
use the `open` tool; nothing else needs configuring. There is no build
step, and nothing goes stale after a `git pull`.

To try it on the sample film, ask: *"Open
`/absolute/path/to/SCF_studio/fixtures/hollow_creek.scf` and list its
scenes."*

`claude mcp remove scf` undoes it.

## Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config)
and restart Claude Desktop:

```json
{
  "mcpServers": {
    "scf": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/SCF_studio/scf-mcp/scripts/start.mjs"]
    }
  }
}
```

Use absolute paths, including to Node. Claude Desktop does not read your
shell profile, so a bare `node` is usually missing or the wrong version.
`which node` (macOS/Linux) or `where node` (Windows) gives the path.

## Optional settings

None of these are needed to get started. Add them to the command line
(after `start.mjs`) only when you want them.

| Setting | Use it when |
|---|---|
| `--scf <path>` | You work on one film and want it open at startup instead of asking the assistant to open it. |
| `--root name=path` | The film refers to media as `@name/…` and you want those files resolved to a folder on this machine. Repeat for several roots. |
| `--config <path>` | You have several roots and prefer a JSON file: `{ "scf": "…", "roots": { "name": "path" } }`. |

For example, with Claude Code:

```sh
claude mcp add scf -- node /absolute/path/to/SCF_studio/scf-mcp/scripts/start.mjs \
  --scf /absolute/path/to/film.scf
```

Where a film's media lives is a property of the machine, not of the
file, which is why roots are set here (spec §0.3, §8.2). Because these
paths are specific to your machine, do not commit a project-level
`.mcp.json` that contains them.

## When it does not start

| Message or symptom | Cause |
|---|---|
| `dependencies are not installed` | Run `npm ci` in `scf-mcp`. |
| `Node … cannot run TypeScript source` | The Node the client launched is older than 22.6. Use an absolute path to a newer one. |
| `scf-core source not found` | `scf-mcp` was moved away from its sibling `scf-core` directory. Use a full clone. |
| `Cannot find module … dist/server.js` | The client still points at the built server. Point it at `scripts/start.mjs`. |
| Works in a terminal, fails in Claude Desktop | Desktop is using a different `node`. Use the absolute path from `which node` / `where node`. |

Claude Desktop logs are in `~/Library/Logs/Claude/` on macOS and
`%APPDATA%\Claude\logs\` on Windows (`mcp-server-scf.log`). If the
repository is inside WSL and Claude Desktop is on Windows, use
`"command": "wsl.exe"` and put `node` and the Linux paths first in
`args`.

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
format's 1.0 promise; this package does not yet make one. It is not yet
published to npm, so run it from a checkout as above. The design record
is
[`docs/scf-mcp-design.md`](https://github.com/MinimalHumans/SCF_studio/blob/main/docs/scf-mcp-design.md).

Apache-2.0. See `LICENSE` and `NOTICE`.
