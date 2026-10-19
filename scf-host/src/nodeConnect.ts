// SPDX-License-Identifier: Apache-2.0
/**
 * nodeConnect.ts — a Node client finds the running host and connects.
 * Not for the browser: it reads the discovery file.
 */

import WebSocket from "ws";
import {
  HostClient, HostClientError, connectWebSocket, type WebSocketConstructor,
  type HostClientOptions,
} from "./client.ts";
import {
  defaultHostDir, readHostEntry, type HostEntry,
} from "./registryFile.ts";

export { ensureHost, type EnsureHostOptions } from "./ensureHost.ts";

export interface ConnectOptions extends HostClientOptions {
  /** Discovery directory; defaults to the user's. */
  hostDir?: string;
}

/** Connect to the host a discovery entry describes. */
export async function connectToEntry(
    entry: HostEntry, options: HostClientOptions): Promise<HostClient> {
  const url = `ws://127.0.0.1:${String(entry.port)}/?token=${
    encodeURIComponent(entry.token)}`;
  const transport = await connectWebSocket(
    url, WebSocket as unknown as WebSocketConstructor);
  return HostClient.connect(transport, options);
}

/** Connect to the host that is already running, or fail saying so. */
export async function connectToHost(
    options: ConnectOptions): Promise<HostClient> {
  const entry = readHostEntry(options.hostDir ?? defaultHostDir());
  if (entry === null) {
    throw new HostClientError("disconnected", "no SCF host is running");
  }
  return connectToEntry(entry, options);
}

/**
 * Make way for a new host that must allow an origin the running one
 * does not: a host a tool started is idle and will exit by itself soon,
 * so ask it to go now. One with clients — the MCP mid-conversation,
 * another editor — is not ours to stop, and that fails saying so.
 */
export async function replaceIdleHost(
    dir: string, options: HostClientOptions): Promise<void> {
  const other = readHostEntry(dir);
  if (other === null) return;
  try {
    const client = await connectToEntry(other, options);
    await client.shutdown();
    await client.dispose();
  } catch {
    throw new Error(
      `An SCF host is already running (pid ${String(other.pid)}, ` +
      `port ${String(other.port)}) and is in use, so it cannot be ` +
      "replaced. Stop it, or wait until nothing is using it, and try " +
      "again.");
  }
  for (let i = 0; i < 100; i += 1) {
    if (readHostEntry(dir) === null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("The running SCF host was asked to exit and has not yet.");
}
