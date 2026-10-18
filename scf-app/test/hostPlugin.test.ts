// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { request } from "node:http";
import WebSocket from "ws";
import {
  HOST_ENDPOINT, devOrigins, devRoots, scfHostPlugin, type HostConnectionInfo,
} from "../tools/scfHostPlugin";

/** A raw GET, so the test controls every header the browser would send. */
function get(port: number, path: string,
             headers: Record<string, string> = {}):
    Promise<{ status: number; body: string; cors: boolean }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => { body += d.toString(); });
      res.on("end", () => resolve({
        status: res.statusCode ?? 0, body,
        cors: res.headers["access-control-allow-origin"] !== undefined,
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the dev-server host plugin", () => {
  let server: ViteDevServer | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  async function dev(): Promise<{ port: number; info: HostConnectionInfo }> {
    dir = mkdtempSync(join(tmpdir(), "scf-dev-host-"));
    server = await createServer({
      configFile: false,
      root: join(__dirname, ".."),
      logLevel: "silent",
      server: { port: 0, strictPort: false, host: "127.0.0.1" },
      plugins: [scfHostPlugin({ hostDir: dir })],
    });
    await server.listen();
    const port = (server.httpServer!.address() as { port: number }).port;
    // The host starts when the server is listening; wait for the endpoint.
    for (let i = 0; i < 100; i += 1) {
      const r = await get(port, HOST_ENDPOINT, { host: `127.0.0.1:${String(port)}` });
      if (r.status === 200) {
        return { port, info: JSON.parse(r.body) as HostConnectionInfo };
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error("the host never came up");
  }

  test("starting the dev server starts a host the page can reach",
      async () => {
    const { port, info } = await dev();
    const origin = devOrigins(port)[1]!;
    const ok = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${info.url}?token=${info.token}`,
                              { headers: { Origin: origin } });
      s.once("open", () => { s.close(); resolve(true); });
      s.once("error", () => { resolve(false); });
    });
    expect(ok).toBe(true);
  }, 60_000);

  test("the page may browse home and the repository's sample folders",
      () => {
    const roots = devRoots({});
    expect(roots.some((r) => r.endsWith("fixtures"))).toBe(true);
    expect(roots.some((r) => r.endsWith("templates"))).toBe(true);
    expect(devRoots({ SCF_HOST_ROOTS: ["/a", "/b"].join(delimiter) }))
      .toEqual(["/a", "/b"]);
  });

  test("another site cannot read the token", async () => {
    const { port } = await dev();
    const host = `127.0.0.1:${String(port)}`;
    for (const headers of [
      { host, origin: "https://evil.example" },
      { host, "sec-fetch-site": "cross-site" },
      { host: "evil.example" },
    ]) {
      const r = await get(port, HOST_ENDPOINT, headers);
      expect(r.status).toBe(403);
      expect(r.body).toBe("");
      expect(r.cors).toBe(false);
    }
  }, 60_000);

  test("the page's own request is served without CORS headers", async () => {
    const { port } = await dev();
    const r = await get(port, HOST_ENDPOINT, {
      host: `127.0.0.1:${String(port)}`, "sec-fetch-site": "same-origin" });
    expect(r.status).toBe(200);
    expect(r.cors).toBe(false);
  }, 60_000);

  test("stopping the dev server stops the host", async () => {
    const { info } = await dev();
    await server!.close();
    server = undefined;
    const gone = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${info.url}?token=${info.token}`);
      s.once("open", () => { s.close(); resolve(false); });
      s.once("error", () => { resolve(true); });
    });
    expect(gone).toBe(true);
  }, 60_000);
});
