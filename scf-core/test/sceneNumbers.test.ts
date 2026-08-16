/**
 * Spec §4.2. The last describe block is the one that matters most: the
 * TypeScript comparison and its SQL twin must order the same list the
 * same way, because §4.1's ordering bug came from exactly that kind of
 * drift between two implementations of one rule.
 */
import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import {
  compareSceneNumbers, parseSceneNumber, runIndex, sceneNumberOrderJoin,
  sceneNumberOrderTerms, sceneNumberSortKey,
} from "../src/sceneNumbers.ts";

describe("runIndex is bijective base-26", () => {
  test("A is 1, Z is 26, AA is 27", () => {
    expect(runIndex("A")).toBe(1);
    expect(runIndex("Z")).toBe(26);
    expect(runIndex("AA")).toBe(27);
    expect(runIndex("AB")).toBe(28);
    expect(runIndex("")).toBe(0);
  });
});

describe("parseSceneNumber", () => {
  test("bare digits", () => {
    expect(parseSceneNumber(12)).toEqual(
      { prefix: "", digits: 12, suffix: "" });
    expect(parseSceneNumber("101")).toEqual(
      { prefix: "", digits: 101, suffix: "" });
  });

  test("suffix marks a scene inserted after", () => {
    expect(parseSceneNumber("12A")).toEqual(
      { prefix: "", digits: 12, suffix: "A" });
  });

  test("prefix marks a scene inserted before", () => {
    expect(parseSceneNumber("A12")).toEqual(
      { prefix: "A", digits: 12, suffix: "" });
  });

  test("both runs, and case is normalised", () => {
    expect(parseSceneNumber("a12b")).toEqual(
      { prefix: "A", digits: 12, suffix: "B" });
  });

  test("leading zeros are consumed", () => {
    expect(parseSceneNumber("012A")?.digits).toBe(12);
  });

  test("anything else is opaque, not an error", () => {
    // §4.2.3 — valid data, simply outside the ordering rule.
    for (const raw of ["pickup-3", "12-A", "AB", "", "  ", "1.1",
                       "ABCD12", null, undefined]) {
      expect(parseSceneNumber(raw)).toBeNull();
    }
  });
});

describe("ordering (§4.2.2)", () => {
  test("A12 < B12 < 12 < 12A < 12B", () => {
    const order = ["A12", "B12", "12", "12A", "12B"];
    const shuffled = ["12B", "12", "B12", "12A", "A12"];
    expect([...shuffled].sort(compareSceneNumbers)).toEqual(order);
  });

  test("digits dominate the letter runs", () => {
    expect([...["12A", "3", "A12", "2B"]].sort(compareSceneNumbers))
      .toEqual(["2B", "3", "A12", "12A"]);
  });

  test("longer prefix runs sort after shorter ones", () => {
    expect([...["AA12", "A12", "B12"]].sort(compareSceneNumbers))
      .toEqual(["A12", "B12", "AA12"]);
  });

  test("absent sorts after present", () => {
    expect(compareSceneNumbers(null, "99")).toBeGreaterThan(0);
    expect(compareSceneNumbers("", "99")).toBeGreaterThan(0);
  });

  test("opaque sorts after everything that parses", () => {
    expect(compareSceneNumbers("pickup-3", "9999")).toBeGreaterThan(0);
  });

  test("two opaque labels compare equal, leaving the fallback to decide",
       () => {
    // Deliberately not a string comparison: the spec defines no order
    // between two values it cannot parse.
    expect(compareSceneNumbers("pickup-3", "insert-A")).toBe(0);
  });

  test("sortKey is null exactly when the label is opaque", () => {
    expect(sceneNumberSortKey("12A")).toEqual([12, 1, 0, 1]);
    expect(sceneNumberSortKey("A12")).toEqual([12, 0, 1, 0]);
    expect(sceneNumberSortKey("pickup-3")).toBeNull();
  });
});

describe("the SQL twin orders identically", () => {
  const labels = [
    "12", "12A", "12B", "A12", "B12", "AA12", "1", "2", "003",
    "101", "101Z", "9A", "pickup-3", "1.1", "AB", null, "",
  ];

  test("same list, same order, both engines", () => {
    // node:sqlite, the same engine scf-core's Node driver uses. The
    // column is declared without a type so the labels arrive as
    // written, which is what a widened scene_number does.
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
          run: (...p: unknown[]) => unknown;
          all: (...p: unknown[]) => Array<Record<string, unknown>>;
        };
        close: () => void;
      };
    };
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE scene (id INTEGER PRIMARY KEY, scene_number)");
    const insert = db.prepare(
      "INSERT INTO scene (id, scene_number) VALUES (?, ?)");
    labels.forEach((n, i) => { insert.run(i + 1, n); });

    const sql = "SELECT s.id AS id FROM scene s " +
      `${sceneNumberOrderJoin("s.id", "sn")} ` +
      `ORDER BY ${sceneNumberOrderTerms("sn")}, s.id`;
    const fromSql = db.prepare(sql).all().map((r) => Number(r["id"]));

    const fromTs = labels
      .map((n, i) => ({ id: i + 1, n }))
      .sort((a, b) => compareSceneNumbers(a.n, b.n) || a.id - b.id)
      .map((r) => r.id);

    expect(fromSql).toEqual(fromTs);
    db.close();
  });
});
