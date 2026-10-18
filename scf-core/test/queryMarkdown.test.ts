// SPDX-License-Identifier: Apache-2.0
/**
 * Every canonical query's markdown block, against the fixture.
 *
 * The blocks are a product — a prompt-ready rendering the editor copies
 * and an MCP client can ask for — so their text is pinned. `golden/
 * queryMarkdown.json` was captured from the renderer as it stood when it
 * lived in the editor; moving it into core changed no character of it.
 * A deliberate change to a rendering means regenerating that file and
 * reading the diff.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "../src/registry.ts";
import type { ScfContext } from "../src/resolution.ts";
import { mentionsRow } from "../src/canonicalQueries.ts";
import {
  q00Result, q01Result, q02Result, q03Result, q04Result, q05Result,
  q06Result, q07Result, q08Result, q09Result, q10Result, q11Result,
  q12Result, q13Result, q14Result, q15Result,
} from "../src/canonicalQueries.ts";
import {
  QUERY_IDS, isQueryId, queryMarkdown, type QueryId,
} from "../src/queryMarkdown.ts";
import type { QueryResult } from "../src/queryResult.ts";

const FIXTURE = fileURLToPath(new URL(
  "../../fixtures/hollow_creek.scf", import.meta.url));
const REGISTRY = fileURLToPath(new URL(
  "../registry/registry.json", import.meta.url));
const GOLDEN = JSON.parse(readFileSync(fileURLToPath(new URL(
  "./golden/queryMarkdown.json", import.meta.url)), "utf8")) as
  Record<QueryId, string>;

let db: NodeDatabase;
let registry: Registry;
let ctx: ScfContext;
const results = new Map<QueryId, QueryResult<unknown>>();

async function one(sql: string): Promise<{ id: number; uuid: string }> {
  const r = (await db.exec(sql))[0];
  if (r === undefined) throw new Error(`no row for ${sql}`);
  return { id: Number(r["id"]), uuid: String(r["uuid"]) };
}

beforeAll(async () => {
  registry = loadRegistry(JSON.parse(
    readFileSync(REGISTRY, "utf8")) as RegistryJson);
  db = openNodeDatabase(FIXTURE, { readOnly: true });
  ctx = { exec: db.exec, registry };
  const eleanor = await one(
    "SELECT id, uuid FROM character WHERE name LIKE '%Eleanor%'");
  const scene = (n: number) => one(
    `SELECT id, uuid FROM scene WHERE scene_number = ${String(n)}`);
  const s9 = await scene(9);
  const s12 = await scene(12);
  const shot = await one("SELECT id, uuid FROM shot WHERE name LIKE '%12-04%'");
  const theme = await one("SELECT id, uuid FROM theme ORDER BY id");
  results.set("Q00", await q00Result(ctx));
  results.set("Q01", await q01Result(ctx, "character", eleanor.uuid, eleanor.id));
  results.set("Q02", await q02Result(ctx, "character", eleanor.uuid, eleanor.id,
    s12.uuid, s12.id, null, null));
  results.set("Q03", await q03Result(ctx, s12.uuid, s12.id));
  results.set("Q04", await q04Result(ctx, s12.uuid, s12.id));
  results.set("Q05", await q05Result(ctx, eleanor.uuid, s12.uuid, eleanor.id, s12.id));
  results.set("Q06", await q06Result(ctx, eleanor.uuid, s12.uuid, eleanor.id, s12.id));
  results.set("Q07", await q07Result(ctx, s12.uuid, s12.id, shot.uuid, shot.id));
  results.set("Q08", await q08Result(ctx, s12.uuid, s12.id));
  results.set("Q09", await q09Result(ctx, s12.uuid, s12.id));
  results.set("Q10", await q10Result(ctx, theme.uuid, theme.id));
  results.set("Q11", await q11Result(ctx, s12.uuid, s12.id));
  results.set("Q12", await q12Result(ctx, s9.uuid, s12.uuid, s9.id, s12.id));
  results.set("Q13", await q13Result(ctx, "character", eleanor.uuid, eleanor.id,
    "visual_identity", s12.uuid, s12.id, shot.uuid, shot.id,
    async () => undefined, false));
  results.set("Q14", await q14Result(ctx, "Q05", eleanor.uuid, eleanor.id,
    s12.uuid, s12.id, null, null));
  results.set("Q15", await q15Result(ctx, "character", eleanor.uuid, eleanor.id,
    mentionsRow));
});
afterAll(() => db.close());

describe("query markdown", () => {
  test("there is a rendering for each of the sixteen queries", () => {
    expect([...QUERY_IDS]).toEqual(Object.keys(GOLDEN));
    expect(QUERY_IDS).toHaveLength(16);
  });

  test.each([...QUERY_IDS])("%s is character-for-character what it was",
      (id) => {
    expect(queryMarkdown(id, results.get(id)!, registry)).toBe(GOLDEN[id]);
  });

  test("a rendering is a headed block of text", () => {
    for (const id of QUERY_IDS) {
      const md = queryMarkdown(id, results.get(id)!, registry);
      expect(md.startsWith("#")).toBe(true);
      expect(md.length).toBeGreaterThan(40);
    }
  });

  test("only canonical ids have one", () => {
    expect(isQueryId("Q07")).toBe(true);
    expect(isQueryId("Q99")).toBe(false);
    expect(isQueryId("constructor")).toBe(false);
  });
});
