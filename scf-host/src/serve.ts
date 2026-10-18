#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The `scf-host` command: run a host in the foreground.
 *
 *   scf-host [--port N] [--origin URL]... [--dir PATH] [--idle-exit MS]
 *
 * With `--idle-exit`, a host that has had no client for that long exits.
 * One started on demand by a tool uses it, so it does not outlive the
 * work; one started by the editor's dev server does not, and stays for
 * as long as the dev server does.
 *
 * Prints one line of JSON ({port, token}) once it is listening, so a
 * parent that spawned it can connect without reading the discovery file.
 */

import { startHost } from "./host.ts";

const args = process.argv.slice(2);
const origins: string[] = [];
let port: number | undefined;
let dir: string | undefined;
let idleExit: number | undefined;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  const v = args[i + 1];
  if (a === "--port" && v !== undefined) { port = Number(v); i += 1; }
  else if (a === "--origin" && v !== undefined) { origins.push(v); i += 1; }
  else if (a === "--dir" && v !== undefined) { dir = v; i += 1; }
  else if (a === "--idle-exit" && v !== undefined) {
    idleExit = Number(v); i += 1;
  }
  else {
    process.stderr.write(`scf-host: unknown argument ${String(a)}\n`);
    process.exit(2);
  }
}

let idleTimer: ReturnType<typeof setTimeout> | undefined;
const host = await startHost({
  ...(port === undefined ? {} : { port }),
  ...(dir === undefined ? {} : { hostDir: dir }),
  allowedOrigins: origins,
  onShutdown: () => { stop(); },
  ...(idleExit === undefined ? {} : {
    onIdle: () => {
      // Re-armed each time the last client leaves; at the deadline a
      // client that has arrived since keeps the host alive.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (host.clientCount === 0) stop();
      }, idleExit);
    },
  }),
});
process.stdout.write(
  `${JSON.stringify({ port: host.port, token: host.token })}\n`);

function stop(): void {
  void host.stop().then(() => { process.exit(0); });
}
if (idleExit !== undefined) {
  // A host nobody ever connected to is idle from the start.
  idleTimer = setTimeout(() => {
    if (host.clientCount === 0) stop();
  }, idleExit);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
