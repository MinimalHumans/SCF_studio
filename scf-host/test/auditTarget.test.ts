// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { fieldChanges, planTarget } from "../src/auditTarget.ts";
import { registry } from "./helpers.ts";

describe("planTarget", () => {
  test("record ops by name", () => {
    expect(planTarget(registry, "op", "record.update",
      { entity: "character", id: 3, values: {} }))
      .toEqual({ kind: "update", entity: "character", id: 3 });
    expect(planTarget(registry, "op", "record.create",
      { entity: "character", values: {} }))
      .toEqual({ kind: "create", entity: "character", id: null });
    expect(planTarget(registry, "op", "record.delete",
      { entity: "character", id: 3 }))
      .toEqual({ kind: "delete", entity: "character", id: 3 });
  });

  test("the window's positional calls", () => {
    expect(planTarget(registry, "call", "record.update",
      ["character", 3, {}]))
      .toEqual({ kind: "update", entity: "character", id: 3 });
    expect(planTarget(registry, "call", "element.setField",
      ["character", 3, "name", "x"]))
      .toEqual({ kind: "field", entity: "character", id: 3 });
  });

  test("an unknown entity, a bad id or an unrelated write has no target", () => {
    expect(planTarget(registry, "op", "record.update",
      { entity: "no_such", id: 3 })).toBeNull();
    expect(planTarget(registry, "op", "record.update",
      { entity: "character", id: "3" })).toBeNull();
    expect(planTarget(registry, "call", "script.commit", [{}])).toBeNull();
    expect(planTarget(registry, "op", "record.update", null)).toBeNull();
  });
});

describe("fieldChanges", () => {
  test("only authored fields that differ, null and empty alike", () => {
    const before = { id: 1, name: "Ada", role: null, updated_at: "a" };
    const after = { id: 1, name: "Ada Cade", role: "", updated_at: "b" };
    expect(fieldChanges(registry, "character", before, after))
      .toEqual(['name: "Ada" → "Ada Cade"']);
  });

  test("a long value is cut", () => {
    const [change] = fieldChanges(registry, "character",
      { name: "a" }, { name: "b".repeat(200) });
    expect(change!.length).toBeLessThan(120);
    expect(change).toContain("…");
  });
});
