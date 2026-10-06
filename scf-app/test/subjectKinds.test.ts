// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { KINDS } from "../src/state/subjectKinds.ts";
import { readSceneIndex } from "../src/editor/characterPresence.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));
const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));
let db: ReturnType<typeof openNodeDatabase>;
beforeAll(() => { db = openNodeDatabase(FIXTURE, { readOnly: true }); });
afterAll(() => db.close());

describe("the workspace kinds match the schema", () => {
  test("every named entity and column exists", async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    for (const spec of Object.values(KINDS)) {
      const fields = registry.entities.get(spec.entity)?.fields.map((f) => f.name);
      expect(fields, spec.entity).toContain(spec.metaField);
      const variant = registry.entities.get(spec.variantEntity)?.fields
        .map((f) => f.name);
      expect(variant, spec.variantEntity).toContain(`${spec.entity}_id`);
    }
  });

  test("each presence query runs and finds the fixture's subjects",
       async () => {
    for (const spec of Object.values(KINDS)) {
      const rows = await db.exec(spec.presenceSql, [1]);
      expect(rows.length, spec.entity).toBeGreaterThan(0);
    }
  });
});

describe("the scene index", () => {
  test("every line under a heading knows its scene; headings are indexed",
       async () => {
    const idx = await readSceneIndex(db.exec);
    const kitchen = Number((await db.exec(
      "SELECT id FROM scene WHERE scene_number = '3'"))[0]?.["id"]);
    const heading = idx.headingLine.get(kitchen);
    expect(heading).toBeDefined();
    expect(idx.sceneOfLine.get(heading as string)).toBe(kitchen);
    const cue = (await db.exec(
      "SELECT uuid FROM screenplay_lines WHERE content = 'ELEANOR' " +
      "ORDER BY line_order LIMIT 1"))[0];
    expect(idx.sceneOfLine.get(String(cue?.["uuid"]))).toBe(kitchen);
  });
});
