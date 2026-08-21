// SPDX-License-Identifier: Apache-2.0
/**
 * Spec §4.3 — the numbering policy, across schema 2.11's rename.
 *
 * `scene_numbering` governed act, sequence and scene numbers and shot
 * codes while being named after one of the four. 2.11 renamed it to
 * `numbering_policy`; 2.12 removed the old column.
 *
 * What is worth testing here is the resolution of ABSENCE. The policy
 * decides whether a shot list already on paper gets renumbered, so a
 * resolver that threw on a missing column, or that guessed `fixed`,
 * would be expensive in opposite directions. It stays total (§9.2) and
 * fails toward `derived`, which never silently freezes numbering that
 * should be tracking.
 */
import { afterEach, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import {
  DEFAULT_NUMBERING_POLICY, numberingPolicy, numberingPolicyOf,
  setNumberingPolicy,
} from "../src/numbering.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { openFixture, registry } from "./setup.ts";

let db: NodeDatabase | null = null;
afterEach(() => { db?.close(); db = null; });

const fresh = async (): Promise<NodeDatabase> => {
  const d = openNodeDatabase(":memory:");
  await initDatabase(d.exec, registry);
  return d;
};

describe("resolving the policy", () => {
  test("reads the column", () => {
    expect(numberingPolicyOf({ numbering_policy: "fixed" })).toBe("fixed");
    expect(numberingPolicyOf({ numbering_policy: "derived" }))
      .toBe("derived");
  });

  test("absent, empty or missing means derived", () => {
    expect(numberingPolicyOf({})).toBe(DEFAULT_NUMBERING_POLICY);
    expect(numberingPolicyOf({ numbering_policy: null })).toBe("derived");
    expect(numberingPolicyOf({ numbering_policy: "" })).toBe("derived");
    expect(numberingPolicyOf(undefined)).toBe("derived");
    expect(numberingPolicyOf(null)).toBe("derived");
  });

  test("an unrecognised value resolves rather than throwing", () => {
    // §9.2: resolvers stay total. `derived` is also the safe direction
    // to fail in — it never silently freezes numbering that should
    // track, and a project that wanted `fixed` will say so again.
    expect(numberingPolicyOf({ numbering_policy: "locked" }))
      .toBe("derived");
  });

  test("the removed column is ignored, not consulted", () => {
    // schema 2.12 dropped `scene_numbering`. A file that still carries
    // one is unknown content under §10.1: preserved, and ignored. It
    // must not be able to override the real column, or removing it
    // would have achieved nothing.
    expect(numberingPolicyOf({
      numbering_policy: "fixed", scene_numbering: "derived",
    })).toBe("fixed");
    expect(numberingPolicyOf({ scene_numbering: "fixed" }))
      .toBe("derived");
  });
});

describe("reading from a database", () => {
  test("a fresh project defaults to derived", async () => {
    db = await fresh();
    await db.exec("INSERT INTO project (name, uuid) VALUES ('P', 'p1')");
    expect(await numberingPolicy(db.exec)).toBe("derived");
  });

  test("a table that is not there does not throw", async () => {
    db = openNodeDatabase(":memory:");
    expect(await numberingPolicy(db.exec)).toBe("derived");
  });

  test("the conformance fixture is fixed", async () => {
    const fx = openFixture();
    expect(await numberingPolicy(fx.ctx.exec)).toBe("fixed");
    fx.close();
  });
});

describe("writing", () => {
  test("sets the policy", async () => {
    db = await fresh();
    await db.exec("INSERT INTO project (name, uuid) VALUES ('P', 'p1')");
    await setNumberingPolicy(db.exec, "fixed");
    expect(await numberingPolicy(db.exec)).toBe("fixed");

    await setNumberingPolicy(db.exec, "derived");
    expect(await numberingPolicy(db.exec)).toBe("derived");
  });

  test("writes one column, not two", async () => {
    // 2.11 mirrored into the deprecated column. 2.12 removed both the
    // column and the mirroring, so the format no longer stores this
    // fact twice anywhere.
    db = await fresh();
    const cols = (await db.exec("PRAGMA table_info(project)"))
      .map((r) => String(r["name"]));
    expect(cols).toContain("numbering_policy");
    expect(cols).not.toContain("scene_numbering");
  });
});
