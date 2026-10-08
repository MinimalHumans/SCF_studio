<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# @minimalhumans/scf-mcp

An [MCP](https://modelcontextprotocol.io) server over a Story Context
Format (`.scf`) file, so an AI assistant can answer questions about a
film — and assemble a shot prompt — without being handed a schema and
told to write SQL.

It is a local stdio process. Nothing is hosted, and the film never
leaves your machine except as the answers your assistant asks for.

**It reads.** There are no write tools: SCF is the ground truth of the
film, not the workflow for making it.

## Running it

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
