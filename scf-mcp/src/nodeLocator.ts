// SPDX-License-Identifier: Apache-2.0
/**
 * nodeLocator.ts — a FileLocator backed by the real filesystem.
 *
 * Preserves the `unaddressed`/`missing` distinction all the way to the
 * agent (spec/scf-mcp-design.md §5.1, spec §8.3): a root name this
 * server was never told about is `undefined` ("no root named @X is
 * configured"), a known root with nothing at the path is `null`
 * ("nothing there"), and no on-disk placeholder concept applies to a
 * plain local file — anything found is always `materialised`.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileLocator, LocatedFile } from "@minimalhumans/scf-core";
import type { RootMap } from "./config.ts";

export function makeNodeLocator(roots: RootMap): FileLocator {
  return async (root, path) => {
    if (root === null) return undefined;
    const base = roots[root];
    if (base === undefined) return undefined;

    try {
      const info = await stat(join(base, path));
      const located: LocatedFile = {
        materialised: true,
        sizeBytes: info.size,
        mtime: info.mtime.toISOString(),
      };
      return located;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  };
}
