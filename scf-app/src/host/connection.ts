// SPDX-License-Identifier: Apache-2.0
/**
 * connection.ts — the page finds the host and connects to it.
 *
 * Two steps, each retried: ask the dev server where the host is
 * (`/__scf-host`), then open the socket. The retry covers a host that
 * is still starting; it does not cover a refusal. A 403 from the
 * endpoint means this page is not allowed the token, which no amount of
 * waiting changes, so that stops at once with its own message.
 *
 * The transport is the only thing here that knows it is a WebSocket.
 *
 * In the desktop app (inside Tauri, `tauri dev` included) there is no
 * host to find: the window runs its own (`windowHost.ts`) and connects
 * to it in-process. The dev server's host is for the page in a browser.
 */

import {
  HostClient, connectWebSocket, type HostTransport,
} from "@scf-host/client.ts";
import { withRetry, type RetryOptions } from "./retry.ts";

export const HOST_ENDPOINT = "/__scf-host";

export interface HostLocation {
  url: string;
  token: string;
}

/** The host is not there (yet), as opposed to refusing us. */
export class HostUnavailableError extends Error {
  constructor(message: string, readonly refused: boolean) {
    super(message);
    this.name = "HostUnavailableError";
  }
}

export async function locateHost(
    fetchImpl: typeof fetch = fetch): Promise<HostLocation> {
  let res: Response;
  try {
    res = await fetchImpl(HOST_ENDPOINT, { cache: "no-store" });
  } catch {
    throw new HostUnavailableError(
      "could not reach the dev server", false);
  }
  if (res.status === 403) {
    throw new HostUnavailableError(
      "the host refused this page — it is not on the host's allow list",
      true);
  }
  if (!res.ok) {
    throw new HostUnavailableError(
      `the host is not ready (${String(res.status)})`, false);
  }
  const body = await res.json().catch(() => null) as
    Partial<HostLocation> | null;
  if (typeof body?.url !== "string" || typeof body.token !== "string") {
    // Production builds and plain `vite preview` have no endpoint and
    // fall through to index.html, which is not JSON.
    throw new HostUnavailableError(
      "this page was not started with an SCF host", true);
  }
  return { url: body.url, token: body.token };
}

export type TransportOpener = (where: HostLocation) => Promise<HostTransport>;

const openWebSocket: TransportOpener = (where) =>
  connectWebSocket(`${where.url}?token=${encodeURIComponent(where.token)}`);

export interface ConnectOptions {
  name?: string;
  retry?: RetryOptions;
  /** For tests. */
  locate?: () => Promise<HostLocation>;
  openTransport?: TransportOpener;
}

function inDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function openWindowHost(): Promise<HostTransport> {
  const { windowHostTransport } = await import("./windowHost.ts");
  return windowHostTransport();
}

/** Connect, retrying while the host comes up. */
export async function connectHost(
    options: ConnectOptions = {}): Promise<HostClient> {
  const locate = options.locate ?? locateHost;
  const open = options.openTransport ?? openWebSocket;
  const desktop = inDesktopApp() && options.locate === undefined &&
    options.openTransport === undefined;
  return withRetry(async () => {
    // Located again on every attempt: a host that restarted has a new
    // port and token.
    const transport = desktop
      ? await openWindowHost() : await open(await locate());
    return HostClient.connect(transport, { name: options.name ?? "window" });
  }, {
    shouldRetry: (e) => !(e instanceof HostUnavailableError && e.refused),
    ...options.retry,
  });
}
