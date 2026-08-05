/**
 * setup.ts — shared conformance-test scaffolding.
 *
 * Opens the checked-in Hollow Creek fixture (the format's conformance
 * target, shared with the Python suites) read-only and provides the same
 * id lookups the Python tests use.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import registryJson from "../registry/registry.json" with { type: "json" };
import { loadRegistry, type Registry, type RegistryJson } from "../src/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import type { ScfContext } from "../src/resolution.ts";
import type { SqlValue } from "../src/db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_PATH = process.env["SCF_FIXTURE"] ??
  join(HERE, "..", "..", "fixtures", "hollow_creek.scf");

export const registry: Registry =
  loadRegistry(registryJson as unknown as RegistryJson);

export interface Fixture {
  ctx: ScfContext;
  close: () => void;
  oneId: (table: string, name: string) => Promise<number>;
  sceneByNumber: (n: number) => Promise<number>;
}

export function openFixture(): Fixture {
  const db: NodeDatabase = openNodeDatabase(FIXTURE_PATH,
                                            { readOnly: true });
  const ctx: ScfContext = { exec: db.exec, registry };

  const oneId = async (table: string, name: string): Promise<number> => {
    const r = await db.exec(
      `SELECT id FROM "${table}" WHERE name LIKE ?`, [`%${name}%`]);
    const id = r[0]?.["id"];
    if (typeof id !== "number") {
      throw new Error(`no ${table} matching ${name}`);
    }
    return id;
  };

  const sceneByNumber = async (n: number): Promise<number> => {
    const r = await db.exec(
      "SELECT id FROM scene WHERE scene_number=?", [n]);
    const id = r[0]?.["id"];
    if (typeof id !== "number") throw new Error(`no scene #${n}`);
    return id;
  };

  return { ctx, close: db.close, oneId, sceneByNumber };
}

export function str(v: SqlValue | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}
