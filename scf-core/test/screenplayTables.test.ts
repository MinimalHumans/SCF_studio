/**
 * screenplayTables.test.ts — the published screenplay tables, checked
 * back against the implementation. Spec §1.3.
 *
 * `emit_screenplay_tables.mjs` writes the artifact from the code. This
 * checks the artifact against the code from the other side, which is
 * the half that catches a hand-edit and the half that catches a
 * vocabulary member added in one place and not the other.
 *
 * Why this file exists at all: `line_type` is a free TEXT column. No
 * constraint, no finding, no test could tell a legal value from an
 * invented one, and a third-party reader guessed `scene_heading` for a
 * scene heading and got a confidently wrong story order with nothing
 * raised. The vocabulary existed only as a TypeScript union — visible
 * to the compiler and to nothing else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LINE_TYPES, LINE_TYPE_NOTES } from "../src/fountain/types.ts";
import { loadRegistry } from "../src/registry.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(HERE, "..", "..", "spec", "screenplay-tables.json");
const REGISTRY = join(HERE, "..", "registry", "registry.json");

interface Published {
  schemaVersion: string;
  lineTypeColumn: {
    closed: boolean;
    default: string;
    columns: string[];
    values: { value: string; note: string }[];
  };
  tables: Record<string, {
    identity: string;
    purpose: string;
    columns: { name: string; type: string; notNull: boolean;
               default: string | null }[];
  }>;
}

const published =
  JSON.parse(readFileSync(ARTIFACT, "utf8")) as Published;
const registry =
  loadRegistry(JSON.parse(readFileSync(REGISTRY, "utf8")));

describe("the published line_type vocabulary", () => {
  test("matches LINE_TYPES exactly, in order", () => {
    expect(published.lineTypeColumn.values.map((v) => v.value))
      .toEqual([...LINE_TYPES]);
  });

  test("every value carries a note", () => {
    // A bare list would have told the reader that `heading` exists
    // without telling it that a scene heading is what `heading` means.
    for (const { value, note } of published.lineTypeColumn.values) {
      expect(note, `${value} has no note`).toBeTruthy();
      expect(note).toBe(LINE_TYPE_NOTES[value as typeof LINE_TYPES[number]]);
    }
  });

  test("is declared closed, and names both columns that use it", () => {
    expect(published.lineTypeColumn.closed).toBe(true);
    expect(published.lineTypeColumn.columns).toEqual([
      "screenplay_lines.line_type",
      "screenplay_version_lines.line_type",
    ]);
  });

  test("the published default is the DDL default", () => {
    // Both columns declare DEFAULT 'action'. If one moves and the
    // artifact does not, a writer omitting the column and a writer
    // setting it explicitly stop agreeing.
    expect(published.lineTypeColumn.default).toBe("action");
    for (const table of ["screenplay_lines", "screenplay_version_lines"]) {
      const column = published.tables[table]?.columns
        .find((c) => c.name === "line_type");
      expect(column, `${table}.line_type absent`).toBeDefined();
      expect(column?.default).toBe("'action'");
    }
  });

  test("does not contain the value a reader guessed", () => {
    // Named, not incidental. `scene_heading` was the guess that made
    // this artifact necessary; a future rename that reintroduced it
    // should have to delete this line deliberately.
    expect([...LINE_TYPES]).not.toContain("scene_heading");
  });
});

describe("the published tables", () => {
  test("are exactly §1.3's two lists", () => {
    expect(Object.keys(published.tables).sort()).toEqual(
      [...registry.uuidExtraTables, ...registry.ownedTables].sort());
  });

  test("record which list each came from", () => {
    for (const name of registry.uuidExtraTables) {
      expect(published.tables[name]?.identity).toBe("uuid");
    }
    for (const name of registry.ownedTables) {
      expect(published.tables[name]?.identity).toBe("owned");
    }
  });

  test("a uuid-identity table declares a uuid column, an owned one does not",
       () => {
    // The distinction §1.3 draws, asserted against the columns rather
    // than trusted from the label beside them.
    for (const name of registry.uuidExtraTables) {
      expect(published.tables[name]?.columns.map((c) => c.name),
             `${name} carries identity but has no uuid column`)
        .toContain("uuid");
    }
    for (const name of registry.ownedTables) {
      expect(published.tables[name]?.columns.map((c) => c.name),
             `${name} is owned but carries a uuid column`)
        .not.toContain("uuid");
    }
  });

  test("every table has a purpose written for a person", () => {
    for (const [name, table] of Object.entries(published.tables)) {
      expect(table.purpose, `${name} has no purpose`).toBeTruthy();
    }
  });

  test("the artifact is stamped with the schema version", () => {
    expect(published.schemaVersion).toBe(registry.schemaVersion);
  });
});
