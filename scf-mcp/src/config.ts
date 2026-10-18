// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts — where the `.scf` and its root mappings come from, at
 * startup.
 *
 * `--scf`/`--root` are optional, not required — the `open` tool can
 * load a film at runtime instead, so a client isn't stuck editing its
 * MCP config and restarting to point at a different file. Passing them
 * just opens that film before the client asks for anything, so a
 * single-film setup needs no tool call at all before querying.
 *
 * A `--config` file is optional, for a project with several roots that
 * would be tedious to repeat as flags every time. Root mapping is
 * intentionally not part of the `.scf` itself (docs/scf-mcp-design.md
 * §5.1, spec §0.3/§8.2): the file is portable, where its bytes live on
 * this machine is not.
 */

import { readFileSync } from "node:fs";

export type RootMap = Record<string, string>;

export interface ServerConfig {
  scfPath: string | undefined;
  roots: RootMap;
  /** No write tool is offered, and films are opened read-only. */
  readOnly: boolean;
}

interface ConfigFile {
  scf?: string;
  roots?: RootMap;
  readOnly?: boolean;
}

function usage(message?: string): never {
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: scf-mcp [--scf <path>] [--root name=path ...] " +
    "[--config <path>] [--read-only]\n" +
    "  --read-only offers no write tools (also SCF_MCP_READ_ONLY=1).\n" +
    "  --scf/--root set the default project; every tool also accepts " +
    "its own scfPath.\n");
  process.exit(1);
}

export function parseConfig(argv: readonly string[]): ServerConfig {
  let scfPath: string | undefined;
  let configPath: string | undefined;
  let readOnly = process.env["SCF_MCP_READ_ONLY"] === "1";
  const roots: RootMap = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scf") {
      scfPath = argv[++i];
    } else if (arg === "--root") {
      const spec = argv[++i];
      const eq = spec?.indexOf("=") ?? -1;
      if (spec === undefined || eq <= 0) {
        usage(`--root expects name=path, got ${spec ?? "nothing"}`);
      }
      roots[spec.slice(0, eq)] = spec.slice(eq + 1);
    } else if (arg === "--read-only") {
      readOnly = true;
    } else if (arg === "--config") {
      configPath = argv[++i];
    } else {
      usage(`unrecognised argument: ${arg}`);
    }
  }

  if (configPath !== undefined) {
    const raw: ConfigFile = JSON.parse(readFileSync(configPath, "utf8"));
    scfPath ??= raw.scf;
    readOnly ||= raw.readOnly === true;
    for (const [name, path] of Object.entries(raw.roots ?? {})) {
      roots[name] ??= path;
    }
  }

  return { scfPath, roots, readOnly };
}
