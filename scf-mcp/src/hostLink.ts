// SPDX-License-Identifier: Apache-2.0
/**
 * hostLink.ts — this server's connection to the SCF host.
 *
 * Every `.scf` is opened by one host process; this server is one of its
 * clients, and finds it, or starts it, with scf-host's `ensureHost`. If
 * the editor is running, its host is the one found, so a film both are
 * looking at is one session with one write queue.
 */

import { HostClientError, type HostClient }
  from "@minimalhumans/scf-host/client";
import {
  connectToEntry, ensureHost, type EnsureHostOptions,
} from "@minimalhumans/scf-host/node";

/**
 * A new connection to the host, under `name` (how the host attributes
 * this connection's writes). One per tool call: a connection is the
 * unit that holds a film open, and a call must not leave one behind.
 */
export async function connectHost(
    name: string, options: EnsureHostOptions = {}): Promise<HostClient> {
  const entry = await ensureHost(options);
  try {
    return await connectToEntry(entry, { name });
  } catch (e) {
    if (e instanceof HostClientError) throw e;
    throw new Error(`could not connect to the SCF host: ${String(e)}`);
  }
}
