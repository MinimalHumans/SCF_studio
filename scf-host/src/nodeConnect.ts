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
import { defaultHostDir, readHostEntry } from "./registryFile.ts";

export interface ConnectOptions extends HostClientOptions {
  /** Discovery directory; defaults to the user's. */
  hostDir?: string;
}

/** Connect to the host that is already running, or fail saying so. */
export async function connectToHost(
    options: ConnectOptions): Promise<HostClient> {
  const entry = readHostEntry(options.hostDir ?? defaultHostDir());
  if (entry === null) {
    throw new HostClientError("disconnected", "no SCF host is running");
  }
  const url = `ws://127.0.0.1:${String(entry.port)}/?token=${entry.token}`;
  const transport = await connectWebSocket(
    url, WebSocket as unknown as WebSocketConstructor);
  return HostClient.connect(transport, options);
}
