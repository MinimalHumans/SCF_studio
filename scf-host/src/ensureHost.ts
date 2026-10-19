// SPDX-License-Identifier: Apache-2.0
/**
 * ensureHost.ts — find the running SCF host, or start one.
 *
 * Every `.scf` is opened by one host process (docs/scf-write-ownership.md),
 * and every client that is not the dev server finds it the same way: the
 * MCP on each tool call, the desktop app when its window connects. If a
 * host is running this answers with it, so a film open in the app and in
 * a conversation is one session with one write queue. If nothing is
 * running, this starts a host and leaves it: it exits by itself when no
 * client has been connected for a while (`--idle-exit`), so nobody has
 * to stop it and nothing is left behind for good.
 *
 * Starting is guarded. Two clients starting at the same moment (two
 * conversations, say, or the app and a conversation) must not both
 * spawn: one takes a lock directory (`mkdir` is atomic), the other waits
 * for the first host to appear. The lock is only advice to wait — a
 * crashed starter leaves one, so a lock older than the start timeout is
 * taken over.
 *
 * The host's log is `host.log` in its directory; a start that times out
 * says so, because "could not connect" with no place to look is not an
 * error message.
 */

import { spawn } from "node:child_process";
import {
  closeSync, mkdirSync, openSync, rmSync, statSync,
} from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultHostDir, readHostEntry, type HostEntry,
} from "./registryFile.ts";


export interface EnsureHostOptions {
  /** Where the host keeps its discovery file; the user's by default. */
  hostDir?: string;
  /** How long to wait for a freshly started host. */
  startTimeoutMs?: number;
  /** Idle time after which a host started here exits. */
  idleExitMs?: number;
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const delay = (ms: number): Promise<void> =>
  new Promise((r) => { setTimeout(r, ms); });

/** Is the entry's host actually answering? (A pid can be reused.) */
async function answers(entry: HostEntry): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${String(entry.port)}/ping`,
                            { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * How to run a host, after the executable: `serve` beside this module,
 * built or source, under the same Node flags as this process, so a
 * client run from source starts a host that runs from source too.
 */
function hostArgs(): string[] {
  const here = fileURLToPath(import.meta.url);
  return [...process.execArgv,
          join(here, "..", `serve${extname(here)}`)];
}

function startHostProcess(dir: string, idleExitMs: number): void {
  mkdirSync(dir, { recursive: true });
  // Mode 0600, and only stderr: stdout carries the host's token.
  const log = openSync(join(dir, "host.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [
      ...hostArgs(),
      "--dir", dir, "--idle-exit", String(idleExitMs),
    ], { detached: true, windowsHide: true, stdio: ["ignore", "ignore", log],
         env: process.env });
    child.unref();
  } finally {
    closeSync(log);
  }
}

async function waitForHost(
    dir: string, until: number): Promise<HostEntry | null> {
  while (Date.now() < until) {
    const entry = readHostEntry(dir);
    if (entry !== null && await answers(entry)) return entry;
    await delay(150);
  }
  return null;
}

/** The running host's entry, starting a host first if none is. */
export async function ensureHost(
    options: EnsureHostOptions = {}): Promise<HostEntry> {
  const dir = options.hostDir ?? defaultHostDir();
  const timeout = options.startTimeoutMs ??
    envNumber("SCF_HOST_START_TIMEOUT_MS", 45_000);
  const idleExit = options.idleExitMs ??
    envNumber("SCF_HOST_IDLE_EXIT_MS", 300_000);

  const running = readHostEntry(dir);
  if (running !== null && await answers(running)) return running;

  const lock = join(dir, "start.lock");
  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + timeout;
  let starter = false;
  while (Date.now() < deadline && !starter) {
    try {
      mkdirSync(lock);
      starter = true;
    } catch {
      // Someone else is starting one: wait for it rather than race.
      const entry = await waitForHost(dir, Date.now() + 1000);
      if (entry !== null) return entry;
      try {
        if (Date.now() - statSync(lock).mtimeMs > timeout) {
          rmSync(lock, { recursive: true, force: true });   // abandoned
        }
      } catch { /* released meanwhile */ }
    }
  }
  try {
    if (starter) {
      // Recheck under the lock: a host may have come up while waiting.
      const again = readHostEntry(dir);
      if (again !== null && await answers(again)) return again;
      startHostProcess(dir, idleExit);
    }
    const entry = await waitForHost(dir, deadline);
    if (entry !== null) return entry;
  } finally {
    if (starter) rmSync(lock, { recursive: true, force: true });
  }
  throw new Error(
    `the SCF host did not start within ${String(Math.round(timeout / 1000))}` +
    `s. Its log is ${join(dir, "host.log")}. On a slow disk, raise ` +
    "SCF_HOST_START_TIMEOUT_MS.");
}
