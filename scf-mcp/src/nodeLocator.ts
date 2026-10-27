// SPDX-License-Identifier: Apache-2.0
/**
 * nodeLocator.ts — a FileLocator over the shared assets module
 * (scf-host `assets.ts`), on Node. The window uses the same module
 * over its own Tauri-backed platform instead (`windowMcp.ts`).
 */

import { PROJECT_ROOT, type FileLocator } from "@minimalhumans/scf-core";
import { createAssetAccess, nodePlatform } from "@minimalhumans/scf-host";
import type { RootMap } from "./config.ts";

const access = createAssetAccess(nodePlatform);

export function makeNodeLocator(roots: RootMap): FileLocator {
  return access.locate(roots[PROJECT_ROOT] ?? null);
}
