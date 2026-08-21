// SPDX-License-Identifier: Apache-2.0
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
  /** Scene numbers are labels (§4.2); a number is accepted for
   *  readability and bound as text. */
  sceneByNumber: (n: number | string) => Promise<number>;
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

  /**
   * A scene number is a LABEL (spec §4.2), so it is bound as text.
   * Binding it as a number matched nothing once the column became TEXT:
   * the driver binds JS numbers as doubles, so 12 arrived as "12.0".
   * Callers may still pass 12 for readability.
   */
  const sceneByNumber = async (n: number | string): Promise<number> => {
    const r = await db.exec(
      "SELECT id FROM scene WHERE scene_number=?", [String(n)]);
    const id = r[0]?.["id"];
    if (typeof id !== "number") throw new Error(`no scene #${String(n)}`);
    return id;
  };

  return { ctx, close: db.close, oneId, sceneByNumber };
}

export function str(v: SqlValue | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}
