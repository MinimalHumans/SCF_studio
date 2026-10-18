// SPDX-License-Identifier: Apache-2.0
/**
 * scf.ts — the one executable the desktop app ships beside its window.
 *
 *   scf host [options]   the SCF host (scf-host/src/serve.ts); the app
 *                        starts this one
 *   scf mcp [options]    the MCP server (scf-mcp/src/server.ts), for an
 *                        assistant to start; it starts `scf host` itself
 *                        when no host is running
 *
 * One executable rather than two because each carries a whole Node.
 * Built by tools/buildSidecar.mjs; the options are the commands' own.
 */

const [command] = process.argv.splice(2, 1);

if (command === "host") void import("../../scf-host/src/serve.ts");
else if (command === "mcp") void import("../../scf-mcp/src/server.ts");
else {
  process.stderr.write(
    "usage: scf host [options]   run the SCF host\n" +
    "       scf mcp [options]    run the SCF MCP server (stdio)\n");
  process.exit(2);
}
