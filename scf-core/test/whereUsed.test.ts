// SPDX-License-Identifier: Apache-2.0
/**
 * whereUsed.test.ts — the reverse lookup, against the fixture.
 *
 * The cases here are the ones that cost a reader real time: a bundle
 * nothing binds, an asset in a bundle, and a row reached only through
 * a polymorphic column (§8.6's case, which a naive implementation
 * misses entirely).
 */

import { describe, expect, test } from "vitest";
import { whereUsed } from "../src/whereUsed.ts";
import { openFixture } from "./setup.ts";

async function used(entity: string, sql: string): Promise<
    Awaited<ReturnType<typeof whereUsed>>> {
  const fx = openFixture();
  try {
    const [row] = await fx.ctx.exec(sql);
    return await whereUsed(fx.ctx, entity, String(row?.["uuid"]));
  } finally {
    fx.close();
  }
}

describe("whereUsed", () => {
  test("the costume bundle is reached through costume_asset_binding",
       async () => {
    // Until schema 2.16 this bundle was reached by nothing: costume had
    // references and no binding entity, so a bundle of them could not
    // be bound at all. The reverse lookup is how that was visible.
    const usage = await used("bundle",
      "SELECT uuid FROM bundle WHERE name = 'Ada''s Shawl'");
    expect(new Set(usage.map((u) => u.entity))).toEqual(
      new Set(["bundle_asset", "costume_asset_binding"]));
    const binding = usage.find((u) => u.entity === "costume_asset_binding");
    expect(binding?.fields["costume_uuid"]).toBeTypeOf("string");
  });

  test("a bound bundle names its binding and the subject it reaches",
       async () => {
    const usage = await used("bundle",
      "SELECT uuid FROM bundle WHERE name = 'Kitchen - Day Ref'");
    const binding = usage.find((u) => u.entity === "location_asset_binding");
    expect(binding).toBeDefined();
    expect(binding?.fields["location_uuid"]).toBeTypeOf("string");
  });

  test("a junction carries no label, so it carries its endpoints",
       async () => {
    const usage = await used("asset",
      "SELECT uuid FROM asset " +
      "WHERE identifier LIKE '%marcus_in_the_kitchen%'");
    const member = usage.find((u) => u.entity === "bundle_asset");
    expect(member?.label).toBeNull();
    expect(member?.fields["bundle_uuid"]).toBeTypeOf("string");
  });

  test("a polymorphic reference counts as a use (§8.6)", async () => {
    const usage = await used("asset",
      "SELECT a.uuid FROM asset a JOIN asset_relationship r " +
      "ON r.entity_id = a.id AND r.entity_type = 'asset' LIMIT 1");
    const poly = usage.find((u) => u.polymorphic);
    expect(poly?.entity).toBe("asset_relationship");
  });

  test("an unknown entity, and an unknown uuid, both say so", async () => {
    const fx = openFixture();
    try {
      await expect(whereUsed(fx.ctx, "nonesuch", "x"))
        .rejects.toThrow(/unknown entity type/);
      await expect(whereUsed(fx.ctx, "asset", "not-a-uuid"))
        .rejects.toThrow(/no asset with uuid/);
    } finally {
      fx.close();
    }
  });
});
