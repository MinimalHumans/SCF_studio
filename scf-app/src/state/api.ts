// SPDX-License-Identifier: Apache-2.0
/**
 * api.ts — how the window writes.
 *
 * Every change to the film goes through `call(name, ...args)`: a name
 * from scf-core's call table and that function's own arguments, as
 * plain data. The window holds no write function and issues no write
 * SQL; the host runs the call as one write against the film, in order
 * with everyone else's, and answers with the result.
 *
 * Errors that carry meaning to the UI are rebuilt here from what the
 * host reports, so a caller can still ask `e instanceof SharedSetError`
 * and get the answer it would have got when the write ran in the page.
 */

import type {
  CallArgs, CallName, CallResult,
} from "@scf-core/ops/calls.ts";
import { ScopeError, SharedSetError } from "@scf-core/ops/mediaOps.ts";
import { HostClientError } from "@scf-host/client.ts";
import { getHost } from "../host/hostClient.ts";
import { useStore } from "./store.ts";

/** What the host's error was, as the class the UI knows it by. */
export function reviveError(e: unknown): unknown {
  if (!(e instanceof HostClientError)) return e;
  if (e.code === "external_change") {
    useStore.setState({ externalChange: true });
  } else if (e.code === "disconnected") {
    useStore.setState({ hostLost: true });
  } else if (e.code === "failed") {
    if (e.remoteName === "SharedSetError") {
      const shared = e.data?.["sharedWith"];
      return new SharedSetError(
        Array.isArray(shared) ? shared.map(String) : []);
    }
    if (e.remoteName === "ScopeError") return new ScopeError(e.message);
  }
  return e;
}

export async function call<K extends CallName>(
    name: K, ...args: CallArgs<K>): Promise<CallResult<K>> {
  const host = await getHost();
  try {
    const result = await host.call(name, args);
    // The host has already told every window; this is the one that made
    // the change, which may hear its own event after the answer.
    useStore.setState((st) => ({
      revision: Math.max(st.revision, host.revision),
    }));
    return result;
  } catch (e) {
    // A write that threw may still have changed rows, and the host
    // reports that as an event; nothing to undo here.
    throw reviveError(e);
  }
}
