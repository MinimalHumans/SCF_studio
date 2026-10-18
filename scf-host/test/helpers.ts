// SPDX-License-Identifier: Apache-2.0
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initDatabase, loadRegistry, type Registry, type RegistryJson,
} from "@minimalhumans/scf-core";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";
import registryJson from "@minimalhumans/scf-core/registry.json" with { type: "json" };

export const registry: Registry =
  loadRegistry(registryJson as unknown as RegistryJson);

/** Building the schema on disk is slow; do it once and copy. */
export interface Workspace {
  /** A fresh copy of an empty film; each call returns a new file. */
  newFilm(name?: string): string;
  dir: string;
  dispose(): void;
}

export async function makeWorkspace(): Promise<Workspace> {
  const dir = mkdtempSync(join(tmpdir(), "scf-host-"));
  const template = join(dir, "template.scf");
  const seed = openNodeDatabase(template);
  await initDatabase(seed.exec, registry);
  seed.close();
  let n = 0;
  return {
    dir,
    newFilm: (name = `film${String(++n)}`) => {
      const p = join(dir, `${name}.scf`);
      copyFileSync(template, p);
      return p;
    },
    dispose: () => { rmSync(dir, { recursive: true, force: true }); },
  };
}
