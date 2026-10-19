// SPDX-License-Identifier: Apache-2.0
/**
 * scf.ts — the one executable the desktop app ships beside its window.
 *
 *   scf host [options]   the SCF host (scf-host/src/serve.ts)
 *   scf locate           where the running host is, starting one if none
 *                        is (scf-host/src/locate.ts); the app asks this
 *   scf mcp [options]    the MCP server (scf-mcp/src/server.ts), for an
 *                        assistant to start
 *
 * The app and the MCP find a host the same way, so whichever comes first
 * starts it and the other joins.
 *
 * One executable rather than two because each carries a whole Node.
 * Built by tools/buildSidecar.mjs; the options are the commands' own.
 */

const [command] = process.argv.splice(2, 1);

if (command === "host") void import("../../scf-host/src/serve.ts");
else if (command === "locate") void import("../../scf-host/src/locate.ts");
else if (command === "mcp") void import("../../scf-mcp/src/server.ts");
else {
  process.stderr.write(
    "usage: scf host [options]   run the SCF host\n" +
    "       scf locate           print the running host, starting one\n" +
    "       scf mcp [options]    run the SCF MCP server (stdio)\n");
  process.exit(2);
}
