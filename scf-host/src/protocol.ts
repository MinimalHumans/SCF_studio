// SPDX-License-Identifier: Apache-2.0
/**
 * protocol.ts — what a client and the host say to each other.
 *
 * Plain data only, and no imports from Node, so the browser, the MCP and
 * a future Tauri shell can all depend on it. The host core
 * (`hostCore.ts`) answers these requests without knowing how they
 * arrived; a WebSocket frame, a stdio line and a Tauri `invoke()` are all
 * just a way to deliver a `HostRequest`.
 */

export const PROTOCOL_VERSION = 1;

export type ErrorCode =
  | "bad_request"      // malformed request or arguments
  | "unknown_method"
  | "unknown_op"
  | "no_film"          // a call that needs an open file, before `open`
  | "not_found"        // the path does not exist
  | "not_scf"          // the file is not a .scf
  | "bad_query"        // `query` was not a single read statement
  | "read_only"        // the connection opened the film read-only
  | "stale_revision"   // the caller's view of the file is out of date
  | "external_change"  // the file changed on disk under the host
  | "failed";          // the operation itself failed

export interface HostError {
  code: ErrorCode;
  message: string;
}

export interface HostRequest {
  id: number;
  method: string;
  params?: unknown;
}

export type HostResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: HostError };

/** Pushed to every client attached to a film. */
export type HostEvent =
  | { event: "revision"; path: string; revision: number; by: string }
  | { event: "reload"; path: string; revision: number };

export type SqlJson = string | number | null | { $b64: string };
export type JsonRow = Record<string, SqlJson>;

export interface OpInfo {
  name: string;
  summary: string;
  destructive: boolean;
  /** JSON Schema of the op's arguments. */
  args: Record<string, unknown>;
}

export interface FilmInfo {
  path: string;
  revision: number;
  clients: number;
}

/** Method name → [params, result]. The client library types its calls from this. */
export interface HostMethods {
  hello: [{ client: string; protocol?: number },
          { protocol: number; version: string }];
  open: [{ path: string; readOnly?: boolean; migrate?: boolean },
         { path: string; revision: number; readOnly: boolean }];
  close: [Record<string, never>, null];
  /** Re-read the file after an `external_change`. Revisions keep rising. */
  reload: [Record<string, never>, { revision: number }];
  query: [{ sql: string; params?: (string | number | null)[] },
          JsonRow[]];
  ops: [Record<string, never>, OpInfo[]];
  op: [{ name: string; args?: unknown; expectedRevision?: number },
       { result: unknown; revision: number }];
  status: [Record<string, never>, { films: FilmInfo[]; current: string | null }];
}

export type MethodName = keyof HostMethods;
