// SPDX-License-Identifier: Apache-2.0
/**
 * hostClient.ts — the window's one connection to the host.
 *
 * Connected lazily and shared, so the first caller pays for the
 * (retried) connect and every later one gets the same client. If the
 * connection drops the next call connects afresh; whoever holds the old
 * client sees `onClose` and decides what that means for the open film.
 */

import type { HostClient } from "@scf-host/client.ts";
import { connectHost, type ConnectOptions } from "./connection.ts";

let current: Promise<HostClient> | null = null;

export function getHost(options: ConnectOptions = {}): Promise<HostClient> {
  if (current === null) {
    const attempt = connectHost(options).then((client) => {
      client.onClose(() => {
        if (current === attempt) current = null;
      });
      return client;
    });
    // A failed connect must not be remembered, or every later call
    // would re-throw the first failure instead of trying again.
    attempt.catch(() => {
      if (current === attempt) current = null;
    });
    current = attempt;
  }
  return current;
}

/** Forget the connection (tests, and a deliberate disconnect). */
export async function dropHost(): Promise<void> {
  const c = current;
  current = null;
  if (c !== null) await (await c.catch(() => null))?.dispose();
}
