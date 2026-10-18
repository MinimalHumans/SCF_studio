// SPDX-License-Identifier: Apache-2.0
/**
 * registryFile.ts — how a client finds a running host.
 *
 * One small JSON file in a per-user directory: where the host listens,
 * the token it expects, and its pid. The file is the capability — anyone
 * who can read it can drive the host — so it is written user-only
 * (mode 0600; on Windows the user's profile directory carries the
 * protection).
 *
 * A host that was killed leaves its file behind. `readHostEntry` checks
 * the pid and removes a dead entry rather than sending a client to a
 * port nothing listens on. A pid can be reused, so the caller still
 * pings before trusting the entry.
 */

import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostEntry {
  pid: number;
  port: number;
  token: string;
  version: string;
  protocol: number;
  startedAt: string;
}

export function defaultHostDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["SCF_HOST_DIR"] ?? join(homedir(), ".scf-host");
}

const FILE = "host.json";

export function writeHostEntry(dir: string, entry: HostEntry): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `${FILE}.${String(process.pid)}.tmp`);
  writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  // Rename, so a client never reads half a file.
  renameSync(tmp, join(dir, FILE));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists and is someone else's.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The running host's entry, or null. A dead host's entry is removed. */
export function readHostEntry(dir: string): HostEntry | null {
  let entry: HostEntry;
  try {
    entry = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as HostEntry;
  } catch {
    return null;
  }
  if (typeof entry.pid !== "number" || !alive(entry.pid)) {
    rmSync(join(dir, FILE), { force: true });
    return null;
  }
  return entry;
}

/** Remove the entry, but only if it is ours. */
export function removeHostEntry(dir: string, pid = process.pid): void {
  try {
    const entry = JSON.parse(
      readFileSync(join(dir, FILE), "utf8")) as HostEntry;
    if (entry.pid === pid) rmSync(join(dir, FILE), { force: true });
  } catch {
    // already gone
  }
}
