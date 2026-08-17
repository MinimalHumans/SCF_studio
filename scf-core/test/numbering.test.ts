/**
 * Spec §4.3 — the numbering policy, across schema 2.11's rename.
 *
 * `scene_numbering` governed act, sequence and scene numbers and shot
 * codes while being named after one of the four. 2.11 renames it to
 * `numbering_policy` through §11.4's deprecation window rather than as a
 * break, which means for one version two columns describe one fact — and
 * every rule about which one wins has to be tested, because the failure
 * mode is silent and expensive: a reader that saw a stale `derived` on a
 * locked project would renumber a shot list that is already on paper.
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

describe("precedence between the two columns", () => {
  test("the current column wins", () => {
    expect(numberingPolicyOf({
      numbering_policy: "fixed", scene_numbering: "derived",
    })).toBe("fixed");
  });

  test("the deprecated column is read when the current one is absent",
       () => {
    // Every file written before 2.11 looks like this, and there are
    // more of them than there are files written after it.
    expect(numberingPolicyOf({ scene_numbering: "fixed" })).toBe("fixed");
    expect(numberingPolicyOf({
      numbering_policy: null, scene_numbering: "fixed",
    })).toBe("fixed");
    expect(numberingPolicyOf({
      numbering_policy: "", scene_numbering: "fixed",
    })).toBe("fixed");
  });

  test("neither present means derived", () => {
    expect(numberingPolicyOf({})).toBe(DEFAULT_NUMBERING_POLICY);
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

describe("writing mirrors into the deprecated column", () => {
  test("both columns are set, so an older reader is not misled",
       async () => {
    // The mirroring is a deliberate, time-boxed exception to §3.1. A
    // reader that only knows `scene_numbering` must not see `derived`
    // on a project someone just locked.
    db = await fresh();
    await db.exec("INSERT INTO project (name, uuid) VALUES ('P', 'p1')");
    await setNumberingPolicy(db.exec, "fixed");

    const rows = await db.exec(
      "SELECT numbering_policy, scene_numbering FROM project");
    expect(rows[0]?.["numbering_policy"]).toBe("fixed");
    expect(rows[0]?.["scene_numbering"]).toBe("fixed");
  });

  test("and back again", async () => {
    db = await fresh();
    await db.exec("INSERT INTO project (name, uuid) VALUES ('P', 'p1')");
    await setNumberingPolicy(db.exec, "fixed");
    await setNumberingPolicy(db.exec, "derived");

    const rows = await db.exec(
      "SELECT numbering_policy, scene_numbering FROM project");
    expect(rows[0]?.["numbering_policy"]).toBe("derived");
    expect(rows[0]?.["scene_numbering"]).toBe("derived");
    expect(await numberingPolicy(db.exec)).toBe("derived");
  });
});

describe("the deprecation window is real", () => {
  test("both columns exist in schema 2.11", async () => {
    // When 2.12 removes `scene_numbering`, this test fails and points
    // at the mirroring in setNumberingPolicy, which goes with it.
    db = await fresh();
    const cols = (await db.exec("PRAGMA table_info(project)"))
      .map((r) => String(r["name"]));
    expect(cols).toContain("numbering_policy");
    expect(cols).toContain("scene_numbering");
  });
});
