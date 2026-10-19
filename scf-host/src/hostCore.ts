// SPDX-License-Identifier: Apache-2.0
/**
 * hostCore.ts — the host core (core.ts) on Node's files and SQLite.
 *
 * What the `scf-host` process, the dev server and the tests run. The
 * desktop app's window runs `core.ts` on a platform of its own.
 */

import {
  createHostCore as createOn, type HostCore,
  type HostCoreOptions as CoreOptions,
} from "./core.ts";
import { nodePlatform, realPath } from "./nodePlatform.ts";

export {
  HostFailure, type HostConnection, type HostCore,
} from "./core.ts";

export type HostCoreOptions = Omit<CoreOptions, "platform">;

/** A path is a session key, so two spellings of one file must agree. */
export function canonicalPath(path: string): string {
  return realPath(path);
}

export function createHostCore(options: HostCoreOptions): HostCore {
  return createOn({ ...options, platform: nodePlatform });
}
