// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts — where the `.scf` and its root mappings come from.
 *
 * CLI flags are primary: every MCP client configures a stdio server as
 * a command plus an args array, so `--scf`/`--root` need no file the
 * user has to author and keep in sync with that config by hand. A
 * `--config` file is optional, for a project with several roots that
 * would be tedious to repeat as flags every time. Root mapping is
 * intentionally not part of the `.scf` itself (spec/scf-mcp-design.md
 * §5.1, spec §0.3/§8.2): the file is portable, where its bytes live on
 * this machine is not.
 */

import { readFileSync } from "node:fs";

export type RootMap = Record<string, string>;

export interface ServerConfig {
  scfPath: string;
  roots: RootMap;
}

interface ConfigFile {
  scf?: string;
  roots?: RootMap;
}

function usage(message?: string): never {
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: scf-mcp --scf <path> [--root name=path ...] [--config <path>]\n");
  process.exit(1);
}

export function parseConfig(argv: readonly string[]): ServerConfig {
  let scfPath: string | undefined;
  let configPath: string | undefined;
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
    } else if (arg === "--config") {
      configPath = argv[++i];
    } else {
      usage(`unrecognised argument: ${arg}`);
    }
  }

  if (configPath !== undefined) {
    const raw: ConfigFile = JSON.parse(readFileSync(configPath, "utf8"));
    scfPath ??= raw.scf;
    for (const [name, path] of Object.entries(raw.roots ?? {})) {
      roots[name] ??= path;
    }
  }

  if (scfPath === undefined) usage("--scf is required");
  return { scfPath, roots };
}
