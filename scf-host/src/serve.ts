#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The `scf-host` command: run a host in the foreground.
 *
 *   scf-host [--port N] [--origin URL]... [--dir PATH] [--idle-exit MS]
 *            [--replace-idle] [--exit-with-stdin]
 *
 * With `--idle-exit`, a host that has had no client for that long exits.
 * One started on demand by a tool uses it, so it does not outlive the
 * work; one started by the editor's dev server does not, and stays for
 * as long as the dev server does.
 *
 * The desktop app starts its host with the last two. `--replace-idle`
 * asks a host already running to make way, as the dev server does,
 * because the app's window is not on its allow list. `--exit-with-stdin`
 * ties the host to its parent: when the parent's end of stdin closes —
 * on exit or on a crash — the host exits as soon as it has no clients,
 * so an MCP using it is not cut off mid-conversation.
 *
 * Prints one line of JSON ({port, token}) once it is listening, so a
 * parent that spawned it can connect without reading the discovery file.
 */

import { startHost } from "./host.ts";
import { replaceIdleHost } from "./nodeConnect.ts";
import { defaultHostDir } from "./registryFile.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const origins: string[] = [];
  let port: number | undefined;
  let dir: string | undefined;
  let idleExit: number | undefined;
  let replaceIdle = false;
  let exitWithStdin = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--port" && v !== undefined) { port = Number(v); i += 1; }
    else if (a === "--origin" && v !== undefined) { origins.push(v); i += 1; }
    else if (a === "--dir" && v !== undefined) { dir = v; i += 1; }
    else if (a === "--idle-exit" && v !== undefined) {
      idleExit = Number(v); i += 1;
    }
    else if (a === "--replace-idle") replaceIdle = true;
    else if (a === "--exit-with-stdin") exitWithStdin = true;
    else {
      process.stderr.write(`scf-host: unknown argument ${String(a)}\n`);
      process.exit(2);
    }
  }

  if (replaceIdle) {
    await replaceIdleHost(dir ?? defaultHostDir(), { name: "scf-host" });
  }

  let orphaned = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const host = await startHost({
    ...(port === undefined ? {} : { port }),
    ...(dir === undefined ? {} : { hostDir: dir }),
    allowedOrigins: origins,
    onShutdown: () => { stop(); },
    onIdle: () => {
      if (orphaned) { stop(); return; }
      if (idleExit === undefined) return;
      // Re-armed each time the last client leaves; at the deadline a
      // client that has arrived since keeps the host alive.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (host.clientCount === 0) stop();
      }, idleExit);
    },
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
  if (exitWithStdin) {
    // `close` follows both a clean end and a broken pipe.
    process.stdin.on("error", () => {});
    process.stdin.on("close", () => {
      orphaned = true;
      if (host.clientCount === 0) stop();
    });
    process.stdin.resume();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  process.stderr.write(
    `scf-host: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
