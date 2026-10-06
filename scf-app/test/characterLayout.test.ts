// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { q } from "@scf-core/db.ts";
import {
  loadRegistry, type Registry, type RegistryJson,
} from "@scf-core/registry.ts";
import {
  BUILT_TABS, CHARACTER_TABS, PENDING_SOURCES, PROFILE_ELSEWHERE,
  PROFILE_SECTIONS, RELATIONSHIP_ELSEWHERE, RELATIONSHIP_SECTIONS,
} from "../src/state/characterLayout.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));
const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));

let registry: Registry;
let db: ReturnType<typeof openNodeDatabase>;
beforeAll(async () => {
  registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(FIXTURE, { readOnly: true });
});
afterAll(() => db.close());

describe("the Profile tab covers the character", () => {
  test("every authored character field appears exactly once", () => {
    // A field added to `character` must be placed somewhere on purpose.
    // Without this it would exist in Schema and silently not in the
    // workspace — the opposite of the workspace's promise.
    const placed = [...PROFILE_SECTIONS.flatMap((s) => s.fields),
                    ...Object.keys(PROFILE_ELSEWHERE)];
    const authored = (registry.entities.get("character")?.fields ?? [])
      .filter((f) => f.autoInjected !== true && f.hidden !== true)
      .map((f) => f.name);
    expect([...placed].sort()).toEqual([...authored].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe("the Relationships tab covers the relationship", () => {
  test("every authored relationship field appears exactly once", () => {
    const placed = [...RELATIONSHIP_SECTIONS.flatMap((s) => s.fields),
                    ...Object.keys(RELATIONSHIP_ELSEWHERE)];
    const authored = (registry.entities.get("character_relationship")
      ?.fields ?? [])
      .filter((f) => f.autoInjected !== true && f.hidden !== true)
      .map((f) => f.name);
    expect([...placed].sort()).toEqual([...authored].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe("the interim record lists", () => {
  const sources = Object.entries(PENDING_SOURCES)
    .flatMap(([tab, list]) => (list ?? []).map((s) => ({ tab, ...s })));

  test("every tab is either built or lists its records, never both", () => {
    expect(CHARACTER_TABS[0]).toBe("Profile");
    for (const tab of CHARACTER_TABS) {
      const built = BUILT_TABS.includes(tab);
      expect(built !== (PENDING_SOURCES[tab] !== undefined), tab).toBe(true);
    }
    for (const s of sources) {
      expect(registry.entities.has(s.entity), s.entity).toBe(true);
    }
  });

  test("each condition runs against the fixture and finds Eleanor's rows",
       async () => {
    let found = 0;
    for (const s of sources) {
      const n = (s.where.match(/\?/g) ?? []).length;
      const rows = await db.exec(
        `SELECT id FROM ${q(s.entity)} WHERE ${s.where}`,
        Array.from({ length: n }, () => 1));
      found += rows.length;
    }
    expect(found).toBeGreaterThan(0);
  });

  test("everything a New button pre-fills is a field of its entity", () => {
    for (const s of sources) {
      const fields = new Set(
        registry.entities.get(s.entity)?.fields.map((f) => f.name));
      for (const key of Object.keys(s.prefill(1))) {
        expect(fields.has(key), `${s.entity}.${key}`).toBe(true);
      }
    }
  });
});
