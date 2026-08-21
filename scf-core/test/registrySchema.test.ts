// SPDX-License-Identifier: Apache-2.0
/**
 * spec/registry.schema.json is published so a third party can consume
 * the registry without running any of this code. A published schema
 * nothing validates against is a promise, not a contract — so the
 * registry is validated against it here, and the reserved-prefix rules
 * of spec §10.2 and §10.3 are asserted rather than merely written down.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
// ajv's default export is draft-07; 2020-12 lives in its own entry.
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020").default;

const read = (url: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(url, import.meta.url)),
                          "utf8"));

const schema = read("../../spec/registry.schema.json");
const registryJson = read("../registry/registry.json") as {
  schemaVersion: string;
  entityCount: number;
  uuidExtraTables: string[];
  entities: Array<{
    name: string;
    fields: Array<{ name: string }>;
  }>;
};

const validator = new Ajv({ allErrors: true, strict: false })
  .compile(schema as object);

describe("registry.json validates against its published schema", () => {
  test("no violations", () => {
    const ok = validator(registryJson);
    // Print the actual failures rather than just "false".
    expect(validator.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  test("entityCount is not a stale hand-maintained number", () => {
    // It is what a consumer checks a truncated download against, so it
    // has to be true rather than approximately true.
    expect(registryJson.entityCount).toBe(registryJson.entities.length);
  });
});

describe("reserved namespaces (spec §10.2, §10.3)", () => {
  const names = [
    ...registryJson.entities.map((e) => e.name),
    ...registryJson.uuidExtraTables,
  ];
  const columns = registryJson.entities.flatMap(
    (e) => e.fields.map((f) => `${e.name}.${f.name}`));

  test("no SCF table claims the third-party `x_` prefix", () => {
    expect(names.filter((n) => n.startsWith("x_"))).toEqual([]);
  });

  test("no SCF column claims it either", () => {
    expect(columns.filter((c) => c.split(".")[1]?.startsWith("x_")))
      .toEqual([]);
  });

  test("no entity table claims the reserved `scf_` prefix", () => {
    // `_scf_meta` is deliberately underscore-first and is not an
    // entity; the reserved prefix is for future SCF-owned tables.
    expect(names.filter((n) => n.startsWith("scf_"))).toEqual([]);
  });
});
