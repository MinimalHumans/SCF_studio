// SPDX-License-Identifier: Apache-2.0
/**
 * hostLink.ts — find the SCF host, or start one.
 *
 * Every `.scf` is opened by one host process (docs/scf-write-ownership.md);
 * this server is one of its clients. If the editor is running, its host
 * is already there and this connects to it, so a film both are looking
 * at is one session with one write queue. If nothing is running, this
 * starts a host and leaves it: it exits by itself when no client has
 * been connected for a while (`--idle-exit`), so a tool does not leave a
 * process behind for good.
 *
 * Starting is guarded. Two servers starting at the same moment (two
 * conversations, say) must not both spawn: one takes a lock directory
 * (`mkdir` is atomic), the other waits for the first host to appear.
 * The lock is only advice to wait — a crashed starter leaves one, so a
 * lock older than the start timeout is taken over.
 *
 * The host's log is `host.log` in its directory; a start that times out
 * says so, because "could not connect" with no place to look is not an
 * error message.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  closeSync, mkdirSync, openSync, rmSync, statSync,
} from "node:fs";
import { join } from "node:path";
import { HostClientError, type HostClient }
  from "@minimalhumans/scf-host/client";
import { connectToEntry } from "@minimalhumans/scf-host/node";
import {
  defaultHostDir, readHostEntry, type HostEntry,
} from "@minimalhumans/scf-host/registryFile";

const require = createRequire(import.meta.url);
// Loaded like `node:sqlite` in scf-core: a builtin Vite does not know.
const { isSea } = require("node:sea") as { isSea: () => boolean };

export interface HostLinkOptions {
  /** Where the host keeps its discovery file; the user's by default. */
  hostDir?: string;
  /** How long to wait for a freshly started host. */
  startTimeoutMs?: number;
  /** Idle time after which a host this server started exits. */
  idleExitMs?: number;
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

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * How to run a host, after the executable: the host's entry point,
 * built or source, under the same Node flags as this process, so a
 * server run from source starts a host that runs from source too. In
 * the desktop app this process is the bundled `scf` executable
 * (scf-app/tools/buildSidecar.mjs), which is the host as well.
 */
function hostArgs(): string[] {
  if (isSea()) return ["host"];
  return [...process.execArgv,
          require.resolve("@minimalhumans/scf-host/serve")];
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
    options: HostLinkOptions = {}): Promise<HostEntry> {
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

/**
 * A new connection to the host, under `name` (how the host attributes
 * this connection's writes). One per tool call: a connection is the
 * unit that holds a film open, and a call must not leave one behind.
 */
export async function connectHost(
    name: string, options: HostLinkOptions = {}): Promise<HostClient> {
  const entry = await ensureHost(options);
  try {
    return await connectToEntry(entry, { name });
  } catch (e) {
    if (e instanceof HostClientError) throw e;
    throw new Error(`could not connect to the SCF host: ${String(e)}`);
  }
}
