#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * server.ts — scf-mcp as a stdio process in Node.
 *
 * The tools are mcpServer.ts; this gives them Node (nodePlatform.ts)
 * and stdin/stdout.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, USAGE, parseConfig } from "./config.ts";
import { createScfMcpServer } from "./mcpServer.ts";
import { makeNodePlatform } from "./nodePlatform.ts";

// Started from a function, not with top-level awaits, so the desktop
// app can bundle this as CommonJS (scf-app/tools/buildSidecar.mjs).
async function start(): Promise<void> {
  const platform = makeNodePlatform();
  const config = await parseConfig(process.argv.slice(2), {
    readOnly: process.env["SCF_MCP_READ_ONLY"] === "1",
    readText: platform.readText, resolve: platform.resolve,
  });
  const server = await createScfMcpServer(platform, config, {
    elicit: process.env["SCF_MCP_ELICIT"] !== "0",
  });
  await server.connect(new StdioServerTransport());
}

start().catch((e: unknown) => {
  if (e instanceof ConfigError) {
    process.stderr.write(`${e.message}\n${USAGE}`);
  } else {
    process.stderr.write(
      `scf-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  process.exit(1);
});
