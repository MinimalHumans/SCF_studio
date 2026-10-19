// SPDX-License-Identifier: Apache-2.0
/**
 * The `locate` command: where the running host is, starting one first if
 * none is (`ensureHost`), as one line of JSON, `{port, token}`.
 *
 * For a client that cannot run `ensureHost` itself — the desktop app's
 * shell, which asks on each connect of its window, so a host that has
 * exited since is replaced by a fresh one. A host started here exits by
 * itself once no client has been connected for a while.
 */

import { ensureHost } from "./ensureHost.ts";

ensureHost().then((entry) => {
  process.stdout.write(
    `${JSON.stringify({ port: entry.port, token: entry.token })}\n`);
}, (e: unknown) => {
  process.stderr.write(
    `scf-host: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
