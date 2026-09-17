// SPDX-License-Identifier: Apache-2.0
/**
 * fixtureReferences.test.ts — every reference in the fixture lands.
 *
 * Re-authoring assets in the app once deleted the two rows §8.6's
 * polymorphic case depends on and left the relationship pointing at
 * neither. Nothing failed: `scf-check` is clean on a dangling reference,
 * and every published result is byte-identical with or without the case
 * it was meant to exercise. This pins the class rather than the row.
 */

import { describe, expect, test } from "vitest";
import { q } from "../src/db.ts";
import { openFixture, registry } from "./setup.ts";

describe("the fixture's references", () => {
  test("every reference column resolves to a row", async () => {
    const fx = openFixture();
    const dangling: string[] = [];
    try {
      const exec = fx.ctx.exec;
      const tables = new Set((await exec(
        "SELECT name FROM sqlite_master WHERE type = 'table'"))
        .map((r) => String(r["name"])));
      for (const entity of registry.order) {
        const def = registry.entities.get(entity);
        if (def === undefined || !tables.has(entity)) continue;
        for (const f of def.fields) {
          const poly = f.polymorphicType;
          if (poly === undefined && f.referenceEntity === undefined) continue;
          const found = await exec(
            `SELECT id, ${q(f.name)} AS ref` +
            (poly !== undefined ? `, ${q(poly)} AS target` : "") +
            ` FROM ${q(entity)} WHERE ${q(f.name)} IS NOT NULL`);
          for (const row of found) {
            const target = poly !== undefined
              ? String(row["target"] ?? "") : String(f.referenceEntity);
            if (!tables.has(target)) {
              dangling.push(`${entity}#${row["id"]}.${f.name} -> ${target}?`);
              continue;
            }
            const hit = await exec(
              `SELECT 1 FROM ${q(target)} WHERE id = ?`, [row["ref"] ?? null]);
            if (hit.length === 0) {
              dangling.push(
                `${entity}#${row["id"]}.${f.name} -> ${target}#${row["ref"]}`);
            }
          }
        }
      }
    } finally {
      fx.close();
    }
    expect(dangling).toEqual([]);
  });

  test("§8.6's case exists: an asset reached ONLY polymorphically", async () => {
    const fx = openFixture();
    try {
      const exec = fx.ctx.exec;
      const plain = new Set<number>();
      const poly = new Set<number>();
      for (const entity of registry.order) {
        const def = registry.entities.get(entity);
        if (def === undefined) continue;
        for (const f of def.fields) {
          // An asset's own version columns do not count as use (§8.6).
          if (entity === "asset") continue;
          if (f.polymorphicType !== undefined) {
            for (const r of await exec(
              `SELECT ${q(f.name)} AS ref FROM ${q(entity)} ` +
              `WHERE ${q(f.polymorphicType)} = 'asset'`)) {
              poly.add(Number(r["ref"]));
            }
          } else if (f.referenceEntity === "asset") {
            for (const r of await exec(
              `SELECT ${q(f.name)} AS ref FROM ${q(entity)} ` +
              `WHERE ${q(f.name)} IS NOT NULL`)) {
              plain.add(Number(r["ref"]));
            }
          }
        }
      }
      const exists = new Set((await exec("SELECT id FROM asset"))
        .map((r) => Number(r["id"])));
      const onlyPoly = [...poly]
        .filter((id) => exists.has(id) && !plain.has(id));
      expect(onlyPoly.length).toBeGreaterThan(0);
    } finally {
      fx.close();
    }
  });
});
