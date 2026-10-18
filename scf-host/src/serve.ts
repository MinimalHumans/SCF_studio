#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The `scf-host` command: run a host in the foreground.
 *
 *   scf-host [--port N] [--origin URL]... [--dir PATH]
 *
 * Prints one line of JSON ({port, token}) once it is listening, so a
 * parent that spawned it can connect without reading the discovery file.
 */

import { startHost } from "./host.ts";

const args = process.argv.slice(2);
const origins: string[] = [];
let port: number | undefined;
let dir: string | undefined;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  const v = args[i + 1];
  if (a === "--port" && v !== undefined) { port = Number(v); i += 1; }
  else if (a === "--origin" && v !== undefined) { origins.push(v); i += 1; }
  else if (a === "--dir" && v !== undefined) { dir = v; i += 1; }
  else {
    process.stderr.write(`scf-host: unknown argument ${String(a)}\n`);
    process.exit(2);
  }
}

const host = await startHost({
  ...(port === undefined ? {} : { port }),
  ...(dir === undefined ? {} : { hostDir: dir }),
  allowedOrigins: origins,
});
process.stdout.write(
  `${JSON.stringify({ port: host.port, token: host.token })}\n`);

const stop = (): void => {
  void host.stop().then(() => { process.exit(0); });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
