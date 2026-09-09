// SPDX-License-Identifier: Apache-2.0
/**
 * config.ts — where the `.scf` and its root mappings come from, at
 * startup.
 *
 * `--scf`/`--root` are now a DEFAULT, not a requirement — projectCache.ts
 * lets every tool call name its own `.scf` and be cached, so one server
 * process can serve any number of films without a client config edit
 * and restart per project. These flags still matter for the common
 * case: point them at the film you work with most, and every tool
 * works with no `scfPath` argument at all, exactly as before.
 *
 * A `--config` file is optional, for a project with several roots that
 * would be tedious to repeat as flags every time. Root mapping is
 * intentionally not part of the `.scf` itself (spec/scf-mcp-design.md
 * §5.1, spec §0.3/§8.2): the file is portable, where its bytes live on
 * this machine is not.
 */

import { readFileSync } from "node:fs";

export type RootMap = Record<string, string>;

export interface ServerConfig {
  scfPath: string | undefined;
  roots: RootMap;
}

interface ConfigFile {
  scf?: string;
  roots?: RootMap;
}

function usage(message?: string): never {
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: scf-mcp [--scf <path>] [--root name=path ...] " +
    "[--config <path>]\n" +
    "  --scf/--root set the default project; every tool also accepts " +
    "its own scfPath.\n");
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

  return { scfPath, roots };
}
