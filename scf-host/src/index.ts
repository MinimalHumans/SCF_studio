// SPDX-License-Identifier: Apache-2.0
export * from "./protocol.ts";
export {
  HostFailure, canonicalPath, createHostCore,
  type HostConnection, type HostCore, type HostCoreOptions,
} from "./hostCore.ts";
export {
  createHostCore as createHostCoreOn,
  type HostCoreOptions as HostCoreOnOptions,
} from "./core.ts";
export {
  fromBase64, toBase64,
  type HostPlatform, type PathOps, type PlatformDatabase,
  type PlatformDirEntry,
} from "./platform.ts";
export { posixPaths, windowsPaths } from "./paths.ts";
export { nodePlatform } from "./nodePlatform.ts";
export { refuseQuery } from "./readGuard.ts";
export { startHostServer, type HostServer, type HostServerOptions }
  from "./server.ts";
export {
  defaultHostDir, readHostEntry, removeHostEntry, writeHostEntry,
  type HostEntry,
} from "./registryFile.ts";
export { startHost, type RunningHost, type StartHostOptions } from "./host.ts";
export {
  HostClient, HostClientError, connectInProcess, connectWebSocket,
  type CallOptions, type HostClientOptions, type HostTransport,
  type OpOptions,
  type WebSocketConstructor, type WebSocketLike,
} from "./client.ts";
