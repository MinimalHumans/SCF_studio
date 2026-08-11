/**
 * relationships.test.ts — the both-columns rule, made executable.
 *
 * The rule conventions §5 states is that a consumer reading only
 * `character_a_id` finds half of a character's relationships and cannot
 * tell. The first test is therefore the important one: a character who
 * appears only in the B column must still be found.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  relationshipFindings, relationshipsFor,
} from "../src/relationships.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { FIXTURE_PATH, registry } from "./setup.ts";

let fixture: NodeDatabase;

beforeAll(() => {
  fixture = openNodeDatabase(FIXTURE_PATH, { readOnly: true });
});

afterAll(() => {
  fixture.close();
});

async function idOf(db: NodeDatabase, name: string): Promise<number> {
  const rows = await db.exec(
    "SELECT id FROM character WHERE name = ?", [name]);
  return Number(rows[0]?.["id"]);
}

describe("relationshipsFor on the fixture", () => {
  test("finds relationships from BOTH columns", async () => {
    const rows = await fixture.exec(
      "SELECT character_a_id, character_b_id FROM character_relationship");
    const bOnly = new Set(rows.map((r) => Number(r["character_b_id"])));
    for (const r of rows) bOnly.delete(Number(r["character_a_id"]));
    const [target] = [...bOnly];
    expect(target, "fixture has a character only in the B column")
      .toBeDefined();

    const views = await relationshipsFor(
      fixture.exec, registry, target as number);
    expect(views.length).toBeGreaterThan(0);
    // Reading character_a_id alone would have returned nothing.
    const naive = await fixture.exec(
      "SELECT id FROM character_relationship WHERE character_a_id = ?",
      [target as number]);
    expect(naive).toHaveLength(0);
  });

  test("normalises self and other regardless of column order", async () => {
    const rows = await fixture.exec(
      "SELECT character_a_id FROM character_relationship LIMIT 1");
    const self = Number(rows[0]?.["character_a_id"]);
    for (const v of await relationshipsFor(fixture.exec, registry, self)) {
      expect(v.selfId).toBe(self);
      expect(v.otherId).not.toBe(self);
      expect(v.otherName).not.toBeNull();
    }
  });

  test("a directed row read from B is incoming, from A is outgoing",
    async () => {
      const [row] = await fixture.exec(
        "SELECT id, character_a_id, character_b_id FROM " +
        "character_relationship WHERE directionality = 'a_to_b' LIMIT 1");
      expect(row).toBeDefined();
      const a = Number(row?.["character_a_id"]);
      const b = Number(row?.["character_b_id"]);

      const fromA = (await relationshipsFor(fixture.exec, registry, a))
        .find((v) => v.id === Number(row?.["id"]));
      const fromB = (await relationshipsFor(fixture.exec, registry, b))
        .find((v) => v.id === Number(row?.["id"]));

      expect(fromA?.direction).toBe("outgoing");
      expect(fromA?.reversed).toBe(false);
      expect(fromB?.direction).toBe("incoming");
      expect(fromB?.reversed).toBe(true);
    });

  test("a mutual row reads the same from either side", async () => {
    const [row] = await fixture.exec(
      "SELECT id, character_a_id, character_b_id FROM " +
      "character_relationship WHERE directionality = 'mutual' LIMIT 1");
    const a = Number(row?.["character_a_id"]);
    const b = Number(row?.["character_b_id"]);
    const fromA = (await relationshipsFor(fixture.exec, registry, a))
      .find((v) => v.id === Number(row?.["id"]));
    const fromB = (await relationshipsFor(fixture.exec, registry, b))
      .find((v) => v.id === Number(row?.["id"]));
    expect(fromA?.direction).toBe("mutual");
    expect(fromB?.direction).toBe("mutual");
  });

  test("the authored row travels with the view", async () => {
    const [row] = await fixture.exec(
      "SELECT character_a_id FROM character_relationship LIMIT 1");
    const [view] = await relationshipsFor(
      fixture.exec, registry, Number(row?.["character_a_id"]));
    expect(view?.row["relationship_type"]).toBeDefined();
    expect(view?.row).not.toHaveProperty("_a_name");
  });

  test("a character with no relationships gets an empty list", async () => {
    expect(await relationshipsFor(fixture.exec, registry, 999999))
      .toEqual([]);
  });

  test("the fixture reports no relationship findings", async () => {
    const findings = await relationshipFindings(fixture.exec, registry);
    expect(findings.map((f) => f.message)).toEqual([]);
  });
});

describe("relationshipFindings on damaged data", () => {
  let db: NodeDatabase;
  let ada = 0;
  let bo = 0;
  let cy = 0;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "rel-test" });
    for (const name of ["Ada", "Bo", "Cy"]) {
      await db.exec(
        "INSERT INTO character (name, uuid) VALUES (?, ?)",
        [name, newUuid()]);
    }
    ada = await idOf(db, "Ada");
    bo = await idOf(db, "Bo");
    cy = await idOf(db, "Cy");
  });

  afterAll(() => db.close());

  const rel = async (
    a: number, b: number, directionality: string | null,
  ): Promise<void> => {
    await db.exec(
      "INSERT INTO character_relationship " +
      "(character_a_id, character_b_id, directionality, uuid) " +
      "VALUES (?, ?, ?, ?)", [a, b, directionality, newUuid()]);
  };

  const clear = async (): Promise<void> => {
    await db.exec("DELETE FROM character_relationship");
  };

  test("one mutual pair entered twice is a duplicate", async () => {
    await clear();
    await rel(ada, bo, "mutual");
    await rel(bo, ada, "mutual");
    const findings = await relationshipFindings(db.exec, registry);
    expect(findings.map((f) => f.kind)).toEqual(["duplicate-pair"]);
    expect(findings[0]?.rowIds).toHaveLength(2);
  });

  test("opposite directed rows are two facts, not a duplicate",
    async () => {
      await clear();
      await rel(ada, bo, "a_to_b");
      await rel(bo, ada, "a_to_b");
      expect(await relationshipFindings(db.exec, registry)).toEqual([]);
    });

  test("the same direction twice IS a duplicate", async () => {
    await clear();
    await rel(ada, bo, "a_to_b");
    await rel(ada, bo, "a_to_b");
    const findings = await relationshipFindings(db.exec, registry);
    expect(findings.map((f) => f.kind)).toEqual(["duplicate-pair"]);
  });

  test("mutual and directed on one pair is a contradiction", async () => {
    await clear();
    await rel(ada, bo, "mutual");
    await rel(ada, bo, "a_to_b");
    const kinds = (await relationshipFindings(db.exec, registry))
      .map((f) => f.kind);
    expect(kinds).toContain("contradictory-pair");
    expect(kinds).not.toContain("duplicate-pair");
  });

  test("a missing directionality is reported, not guessed", async () => {
    await clear();
    await rel(ada, cy, null);
    const findings = await relationshipFindings(db.exec, registry);
    expect(findings.map((f) => f.kind)).toEqual(["missing-directionality"]);

    const [view] = await relationshipsFor(db.exec, registry, ada);
    expect(view?.direction).toBe("unspecified");
  });

  test("a character related to itself is reported", async () => {
    await clear();
    await rel(ada, ada, "mutual");
    const findings = await relationshipFindings(db.exec, registry);
    expect(findings.map((f) => f.kind)).toEqual(["self-pair"]);
  });

  test("an endpoint that does not exist is reported", async () => {
    await clear();
    await rel(ada, 424242, "mutual");
    const findings = await relationshipFindings(db.exec, registry);
    expect(findings.map((f) => f.kind)).toEqual(["missing-endpoint"]);
  });

  test("distinct pairs do not collide", async () => {
    await clear();
    await rel(ada, bo, "mutual");
    await rel(ada, cy, "mutual");
    await rel(bo, cy, "mutual");
    expect(await relationshipFindings(db.exec, registry)).toEqual([]);
    expect(await relationshipsFor(db.exec, registry, ada)).toHaveLength(2);
  });
});
