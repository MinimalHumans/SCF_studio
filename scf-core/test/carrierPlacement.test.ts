// SPDX-License-Identifier: Apache-2.0
/**
 * carrierPlacement.test.ts — §12.11's placement rule, both halves.
 *
 * The rule replaced a list of four entity kinds with what the registry
 * declares, and the value of it is the line it draws: a LINK places a
 * subject in a scene, and an entity that merely names both DESCRIBES it
 * there. A blanket "any table naming a scene and the subject" rule
 * would pass the first test below and fail the second, so both are
 * needed to pin it.
 *
 * Mutating COPIES of the fixture, never the fixture.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, q10Result, type Registry, type ScfContext }
  from "../src/index.ts";
import { openNodeDatabase } from "../src/node.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const REGISTRY = join(HERE, "..", "registry", "registry.json");

let registry: Registry;
let sandbox: string;

beforeAll(() => {
  registry = loadRegistry(JSON.parse(readFileSync(REGISTRY, "utf8")));
  sandbox = mkdtempSync(join(tmpdir(), "scf-carrier-"));
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** A writable copy, optionally written to, then asked for Q10. */
async function carriersOf(
  label: string, write: string | null,
): Promise<Map<string, number>> {
  const path = join(sandbox, `${label}.scf`);
  copyFileSync(FIXTURE, path);
  const db = openNodeDatabase(path, { readOnly: false });
  try {
    if (write !== null) await db.exec(write);
    const ctx: ScfContext = { exec: db.exec, registry };
    const [theme] = await db.exec(
      "SELECT id, uuid FROM theme WHERE name = 'Forgiveness'");
    const result = await q10Result(
      ctx, String(theme?.["uuid"]), Number(theme?.["id"]));
    const out = new Map<string, number>();
    for (const c of result.result.carriers) {
      out.set(`${c.targetEntity}:${c.targetName ?? "?"}`,
              c.sceneUuids.length);
    }
    return out;
  } finally {
    db.close();
  }
}

describe("a carrier reaches the scenes it is placed in (§12.11)", () => {
  test("a prop reaches its scene_prop scenes, like a motif its appearances",
       async () => {
    const carriers = await carriersOf("baseline", null);
    expect(carriers.get("prop:Ada's locket")).toBe(3);
    expect(carriers.get("motif:Ada's locket")).toBe(3);
  });

  test("placing the prop in one more scene reaches one more scene",
       async () => {
    const carriers = await carriersOf("placed",
      "INSERT INTO scene_prop (scene_id, prop_id, uuid) " +
      "SELECT 1, 1, 'aaaaaaaa-0000-4000-8000-00000000c001' " +
      "WHERE NOT EXISTS (SELECT 1 FROM scene_prop " +
      "                  WHERE scene_id = 1 AND prop_id = 1)");
    expect(carriers.get("prop:Ada's locket")).toBe(4);
  });

  test("describing a character in a scene does NOT place them there",
       async () => {
    // performance_beat names a character and a scene and is not a link.
    // Marcus is in scene 10 by beat and not by cast link; his carrier
    // must not gain that scene.
    const before = await carriersOf("describe-before", null);
    const after = await carriersOf("describe-after",
      "DELETE FROM scene_character WHERE character_id = 2 AND scene_id = 9");
    expect(after.get("character:Marcus Cade"))
      .toBe((before.get("character:Marcus Cade") ?? 0) - 1);
  });

  test("a carrier reaching a cut scene reaches nowhere (§6.6.1)",
       async () => {
    // scene_prop is a link and carries no lifecycle_status of its own —
    // a link inherits its endpoints' (§6.6), so cutting the SCENE is
    // how a placement stops counting.
    const [scene] = [...(await placedScenes())];
    const carriers = await carriersOf("cut-scene",
      `UPDATE scene SET lifecycle_status = 'cut' WHERE id = ${scene ?? 0}`);
    expect(carriers.get("prop:Ada's locket")).toBe(2);
  });
});

/** The scene ids scene_prop places the locket in. */
async function placedScenes(): Promise<number[]> {
  const path = join(sandbox, "read.scf");
  copyFileSync(FIXTURE, path);
  const db = openNodeDatabase(path, { readOnly: true });
  try {
    return (await db.exec(
      "SELECT scene_id FROM scene_prop WHERE prop_id = 1 " +
      "AND scene_id IS NOT NULL ORDER BY scene_id"))
      .map((r) => Number(r["scene_id"]));
  } finally {
    db.close();
  }
}
