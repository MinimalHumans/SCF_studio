// SPDX-License-Identifier: Apache-2.0
/**
 * scfHostPlugin.ts — `npm run dev` starts the SCF host.
 *
 * The page needs a host to open any file (docs/scf-write-ownership.md),
 * and the developer should not have to know that: starting the dev
 * server starts the host, and stopping it stops the host.
 *
 * The host runs inside the dev server's own process, loaded from
 * `scf-host`'s TypeScript through Vite's module loader. That is what
 * keeps the dev loop unchanged — there is no build step for `scf-core`
 * or `scf-host`, and an edit to either takes effect on restart, exactly
 * as an edit to the app does on reload.
 *
 * HOW THE PAGE GETS IN
 * The host refuses a browser unless its `Origin` is on the allow list
 * and it holds the token. This plugin allow-lists the dev server's own
 * origin and serves the token at `/__scf-host`. Vite's dev server sends
 * permissive CORS headers by default, so that endpoint is the one place
 * the token could leak to another site; it therefore answers only a
 * same-origin request, decided from the request's own headers, and
 * never sets a CORS header.
 *
 * The host also writes the usual discovery file, so an MCP started
 * while the dev server is up finds this host and shares the open films
 * with the window instead of starting a second one.
 */

import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCE = resolve(here, "../../scf-host/src");

export const HOST_ENDPOINT = "/__scf-host";

export interface HostConnectionInfo {
  url: string;
  token: string;
}

/**
 * Folders the dev host will let the page browse and create files in:
 * the user's home and the repository's own `fixtures/` and
 * `templates/`, so the sample films are one click away.
 * `SCF_HOST_ROOTS` (a path-delimited list) replaces the default.
 */
export function devRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env["SCF_HOST_ROOTS"];
  if (configured !== undefined && configured !== "") {
    return configured.split(delimiter).filter((r) => r !== "");
  }
  return [homedir(), resolve(here, "../../fixtures"),
          resolve(here, "../../templates")].filter((p) => existsSync(p));
}

export interface ScfHostPluginOptions {
  /** Where the discovery file goes; `false` to publish none (tests). */
  hostDir?: string | false;
  roots?: readonly string[];
}

interface Running {
  url: string;
  token: string;
  stop(): Promise<void>;
}

/** The origins a browser may reach this dev server by. */
export function devOrigins(port: number): string[] {
  const p = String(port);
  return [`http://localhost:${p}`, `http://127.0.0.1:${p}`,
          `http://[::1]:${p}`];
}

/**
 * Is this request from the page itself? A same-origin GET carries no
 * `Origin`, so absence is allowed — but then the browser must say it is
 * same-origin (`Sec-Fetch-Site`), and the `Host` must be ours. A
 * cross-origin page, or a DNS-rebound one, fails one of these.
 */
export function isSamePageRequest(req: IncomingMessage,
                                  origins: readonly string[]): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined && !origins.includes(origin)) return false;
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return false;
  const host = req.headers.host ?? "";
  return origins.some((o) => o.endsWith(`//${host}`));
}

export function scfHostPlugin(options: ScfHostPluginOptions = {}): Plugin {
  let running: Running | null = null;
  let origins: string[] = [];
  let done = false;

  async function stop(): Promise<void> {
    if (done) return;
    done = true;
    await running?.stop();
    running = null;
  }

  async function start(server: ViteDevServer, port: number): Promise<void> {
    origins = devOrigins(port);
    const mod = await server.ssrLoadModule(
      `${HOST_SOURCE}/host.ts`) as typeof import("../../scf-host/src/host.ts");
    const registryFile = await server.ssrLoadModule(
      `${HOST_SOURCE}/registryFile.ts`) as
      typeof import("../../scf-host/src/registryFile.ts");

    const dir = options.hostDir ?? registryFile.defaultHostDir();
    if (dir !== false) {
      // A running host does not allow this origin, so the page could
      // not use it.
      const connect = await server.ssrLoadModule(
        `${HOST_SOURCE}/nodeConnect.ts`) as
        typeof import("../../scf-host/src/nodeConnect.ts");
      await connect.replaceIdleHost(dir, { name: "dev-server" });
    }
    const host = await mod.startHost({
      allowedOrigins: origins,
      roots: options.roots ?? devRoots(),
      ...(options.hostDir === undefined ? {} : { hostDir: options.hostDir }),
    });
    // Ctrl-C ends the process without waiting for async cleanup; the
    // discovery file is removed synchronously so it is not left behind.
    const onExit = (): void => {
      if (dir !== false) registryFile.removeHostEntry(dir);
    };
    // Vite installs no signal handlers, and a signal's default action
    // skips "exit" listeners, so handle the signals too: clean up, then
    // re-raise so the process still ends the way it would have.
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const onSignal = (signal: NodeJS.Signals): void => {
      onExit();
      for (const s of signals) process.off(s, onSignal);
      process.kill(process.pid, signal);
    };
    process.once("exit", onExit);
    for (const s of signals) process.on(s, onSignal);
    running = {
      url: host.url, token: host.token,
      stop: async () => {
        process.off("exit", onExit);
        for (const s of signals) process.off(s, onSignal);
        await host.stop();
      },
    };
    server.config.logger.info(
      `  SCF host listening on 127.0.0.1:${String(host.port)}`);
  }

  return {
    name: "scf-host",
    apply: "serve",
    // The host's own sources are TypeScript with `.ts` import specifiers
    // and the `scf-source` export condition, the same as the app's.
    config: () => ({
      ssr: { resolve: { conditions: ["scf-source"] } },
    }),
    configureServer(server) {
      const http = server.httpServer;
      if (http === null) return;           // middleware mode: no host
      // Registered now, not when the host is up: otherwise a request that
      // arrives first falls through to the SPA fallback and gets HTML.
      server.middlewares.use(HOST_ENDPOINT, (req, res) => {
        if (req.method !== "GET" || !isSamePageRequest(req, origins)) {
          res.writeHead(403).end();
          return;
        }
        if (running === null) {
          res.writeHead(503, { "retry-after": "1" }).end();
          return;
        }
        const body: HostConnectionInfo =
          { url: running.url, token: running.token };
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(body));
      });
      http.once("close", () => { void stop(); });
      const begin = (): void => {
        const addr = http.address() as AddressInfo;
        start(server, addr.port).catch((e: unknown) => {
          server.config.logger.error(
            e instanceof Error ? e.message : String(e));
          void server.close();
        });
      };
      if (http.listening) begin();
      else http.once("listening", begin);
    },
    // `server.close()` awaits this, so the host's files are closed by the
    // time it resolves; Windows will not delete a file that is still open.
    closeBundle: stop,
  };
}
