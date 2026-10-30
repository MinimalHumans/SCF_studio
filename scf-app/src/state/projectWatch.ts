// SPDX-License-Identifier: Apache-2.0
/**
 * projectWatch.ts — knowing a backgrounded tab changed, without loading it.
 *
 * A project tab that is not the live one holds no form state, no asset
 * caches, nothing `store.ts` owns — but the host already shares one
 * `Film` across every connection that has it open (core.ts), and a
 * read-only `open` just attaches to that without taking a write
 * session. So each backgrounded tab gets its own small, read-only
 * connection whose only job is to hear the film's `revision` and
 * `reload` events — an MCP write or an external edit shows up as the
 * tab's dot exactly the way the live project's does, with none of the
 * live project's state kept around for a file nobody is looking at.
 *
 * Disposing the connection also lets the host close the file if
 * nothing else has it open (core.ts: "the last one to leave closes it").
 */

import { connectHost } from "../host/connection.ts";
import type { HostClient } from "@scf-host/client.ts";
import { useProjectTabs } from "./projectTabs.ts";

const watchers = new Map<string, HostClient>();

export const UNREACHABLE = "Could not reopen this file — it may have " +
  "moved or been deleted.";

/** Start watching `path` in the background. Safe to call repeatedly;
 *  does nothing if it is already watched. Marks the tab's `problem`
 *  on failure (a file that moved, or a host that is briefly down) and
 *  clears it on success, so every path into "background this tab" —
 *  switching away from it, or restoring it after a restart — reports
 *  the same way without each caller checking for itself. */
export async function watchProject(path: string): Promise<void> {
  if (watchers.has(path)) return;
  try {
    const client = await connectHost({ name: "window:watch" });
    if (watchers.has(path)) { await client.dispose(); return; }
    await client.open(path, { readOnly: true });
    watchers.set(path, client);
    useProjectTabs.getState().setProblem(path, null);
    client.subscribe((event) => {
      useProjectTabs.getState().setExternalDot(path, {
        by: event.event === "revision" ? event.by : "another program",
      });
    });
  } catch (e) {
    useProjectTabs.getState().setProblem(path, UNREACHABLE);
    console.warn(`[projectWatch] could not watch ${path}:`, e);
  }
}

/** Stop watching `path`, if it was. */
export async function unwatchProject(path: string): Promise<void> {
  const client = watchers.get(path);
  if (client === undefined) return;
  watchers.delete(path);
  await client.dispose().catch(() => undefined);
}
