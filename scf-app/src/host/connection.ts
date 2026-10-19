// SPDX-License-Identifier: Apache-2.0
/**
 * connection.ts — the window connects to its host.
 *
 * The host is the window's own (`windowHost.ts`), started by the first
 * connect, so there is nothing to find; the connect is retried only in
 * case starting it fails for a moment. Outside the desktop shell there
 * is no host at all — its files and SQLite are the shell's — so a page
 * in a plain browser says so at once instead of waiting.
 */

import { HostClient, type HostTransport } from "@scf-host/client.ts";
import { withRetry, type RetryOptions } from "./retry.ts";

/** The host is not there (yet), as opposed to never going to be. */
export class HostUnavailableError extends Error {
  constructor(message: string, readonly refused: boolean) {
    super(message);
    this.name = "HostUnavailableError";
  }
}

export interface ConnectOptions {
  name?: string;
  retry?: RetryOptions;
  /** Where the transport comes from: the window's host, unless a test
   *  gives another. */
  transport?: () => Promise<HostTransport>;
}

function inDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function openWindowHost(): Promise<HostTransport> {
  if (!inDesktopApp()) {
    throw new HostUnavailableError(
      "the editor runs in its desktop app: `npm run dev` in scf-app " +
      "opens it", true);
  }
  const { windowHostTransport } = await import("./windowHost.ts");
  return windowHostTransport();
}

/** Connect, retrying while the host comes up. */
export async function connectHost(
    options: ConnectOptions = {}): Promise<HostClient> {
  const open = options.transport ?? openWindowHost;
  return withRetry(
    async () => HostClient.connect(
      await open(), { name: options.name ?? "window" }),
    {
      shouldRetry: (e) => !(e instanceof HostUnavailableError && e.refused),
      ...options.retry,
    });
}
