// SPDX-License-Identifier: Apache-2.0
/**
 * host.ts — start a complete host: core, socket, discovery file.
 *
 * Used by the `scf-host` command and, in development, by the Vite
 * plugin. Everything is a parameter so a test can run a host in a temp
 * directory on a free port.
 */

import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  loadRegistry, type Registry, type RegistryJson,
} from "@minimalhumans/scf-core";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };
import { createHostCore } from "./hostCore.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import {
  removeHostEntry, writeHostEntry, defaultHostDir,
} from "./registryFile.ts";
import { startHostServer, type HostServer } from "./server.ts";

export function defaultRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env["SCF_HOST_ROOTS"];
  if (configured !== undefined && configured !== "") {
    return configured.split(delimiter).filter((r) => r !== "");
  }
  return [homedir()];
}

export interface StartHostOptions {
  port?: number;
  token?: string;
  allowedOrigins?: readonly string[];
  version?: string;
  /** Where to publish the discovery file; `false` to publish none. */
  hostDir?: string | false;
  registry?: Registry;
  /**
   * Folders clients may browse and create files under. Defaults to
   * `SCF_HOST_ROOTS` (a path-delimited list), then the user's home.
   */
  roots?: readonly string[];
  /** Called when a client asks the host to exit (and is alone). */
  onShutdown?: () => void;
  /** Exit policy hook: called when the last client leaves. */
  onIdle?: () => void;
}

export interface RunningHost extends HostServer {
  stop(): Promise<void>;
}

export async function startHost(
    options: StartHostOptions = {}): Promise<RunningHost> {
  const version = options.version ?? "0.1.0";
  const registry = options.registry ??
    loadRegistry(registryJson as unknown as RegistryJson);
  const roots = options.roots ?? defaultRoots();
  const dir = options.hostDir === false
    ? null : (options.hostDir ?? defaultHostDir());
  // Snapshots and the journal live beside the discovery file, so one
  // directory holds everything a host leaves behind.
  const core = createHostCore({
    registry, version, roots,
    ...(options.onShutdown === undefined
      ? {} : { onShutdown: options.onShutdown }),
    ...(dir === null ? {} : {
      snapshotDir: join(dir, "snapshots"), journalDir: join(dir, "journal"),
    }),
  });
  const server = await startHostServer({
    core, version,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.allowedOrigins === undefined
      ? {} : { allowedOrigins: options.allowedOrigins }),
    ...(options.onIdle === undefined ? {} : { onIdle: options.onIdle }),
  });
  if (dir !== null) {
    writeHostEntry(dir, {
      pid: process.pid, port: server.port, token: server.token, version,
      protocol: PROTOCOL_VERSION, startedAt: new Date().toISOString(),
    });
  }
  return {
    ...server,
    get clientCount() { return server.clientCount; },
    stop: async () => {
      if (dir !== null) removeHostEntry(dir);
      await server.close();
    },
  };
}
