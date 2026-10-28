// SPDX-License-Identifier: Apache-2.0
export * from "./protocol.ts";
export {
  openAppStore,
  type AppDb, type AppStore, type AppStoreFs, type OpenAppDb,
  type OpenAppStoreOptions, type ProjectRow, type ProjectSuggestion,
  type SuggestionInput, type TouchProjectFields,
} from "./appStore.ts";
export {
  actorKindOf, firstUuidIn, openAuditStore,
  type AuditActor, type AuditEvent, type AuditEventInput, type AuditFilter,
  type AuditScope, type AuditStore, type AuditVerification,
} from "./auditStore.ts";
export {
  createAssetAccess, type AssetAccess, type ByteRange,
} from "./assets.ts";
export { openNodeAppStore } from "./nodeAppStore.ts";
export { openNodeAuditStore } from "./nodeAuditStore.ts";
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
export {
  HostClient, HostClientError, connectInProcess,
  type CallOptions, type HostClientOptions, type HostTransport,
  type OpOptions,
} from "./client.ts";
