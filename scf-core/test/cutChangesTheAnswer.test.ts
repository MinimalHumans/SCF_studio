// SPDX-License-Identifier: Apache-2.0
/**
 * cutChangesTheAnswer.test.ts — the mirror of §6.6.1's stated test.
 *
 * §6.6.1 says: **adding a cut row changes no answer**, and calls that
 * the test of a conforming implementation. The fixture is built to make
 * it — a cut scene with a heading, a cut beat in the most heavily
 * asserted scene — and it passes.
 *
 * It has a mirror that nobody had written down: **cutting an existing
 * row MUST change the answer.** A rule that only ever adds rows nothing
 * looks at is satisfied by an implementation that ignores
 * `lifecycle_status` entirely.
 *
 * Five queries failed the mirror while passing the test as stated. Each
 * reached an entity THROUGH a junction in one SQL statement — Q04's cast
 * and props, Q03's costumes and motifs, Q02's costumes — and `rows()`,
 * which applies §6.6.1's filter, only covers what is fetched a table at
 * a time. Marking a character cut left them in Q04's cast.
 *
 * These tests mutate a COPY of the fixture in a temp file. The fixture
 * itself is a checksummed artifact and is opened read-only everywhere
 * else.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  loadRegistry, q02Result, q03Result, q04Result, relationshipsFor,
  type Registry, type ScfContext, type SqlExec,
} from "../src/index.ts";
import { openNodeDatabase } from "../src/node.ts";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "..", "fixtures", "hollow_creek.scf");
const REGISTRY = join(HERE, "..", "registry", "registry.json");

let registry: Registry;
let sandbox: string;

beforeAll(() => {
  registry = loadRegistry(
    JSON.parse(readFileSync(REGISTRY, "utf8")));
  sandbox = mkdtempSync(join(tmpdir(), "scf-cut-"));
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** A writable copy, cut where asked, opened and handed to `fn`. */
async function withCut<T>(
  label: string,
  cut: { table: string; where: string } | null,
  fn: (ctx: ScfContext) => Promise<T>,
): Promise<T> {
  const path = join(sandbox, `${label}.scf`);
  copyFileSync(FIXTURE, path);
  const db = openNodeDatabase(path, { readOnly: false });
  try {
    if (cut !== null) {
      const hit = await db.exec(
        `SELECT id FROM ${cut.table} WHERE ${cut.where}`);
      expect(hit.length,
             `${cut.table}: nothing matched ${cut.where}`)
        .toBeGreaterThan(0);
      await db.exec(
        `UPDATE ${cut.table} SET lifecycle_status = 'cut' ` +
        `WHERE ${cut.where}`);
    }
    return await fn({ exec: db.exec, registry });
  } finally {
    db.close();
  }
}

async function sceneTwelve(exec: SqlExec) {
  const row = (await exec(
    "SELECT id, uuid FROM scene WHERE scene_number = '12'"))[0];
  expect(row, "scene 12 is missing from the fixture").toBeDefined();
  return { id: Number(row?.["id"]), uuid: String(row?.["uuid"]) };
}

describe("cutting a row through a junction changes the answer", () => {
  test("Q04: a cut character leaves the cast", async () => {
    const before = await withCut("q04-cast-before", null, async (ctx) => {
      const s = await sceneTwelve(ctx.exec);
      return (await q04Result(ctx, s.uuid, s.id)).result.cast.length;
    });
    const after = await withCut(
      "q04-cast-after",
      { table: "character", where: "name LIKE '%Marcus%'" },
      async (ctx) => {
        const s = await sceneTwelve(ctx.exec);
        return (await q04Result(ctx, s.uuid, s.id)).result.cast.length;
      });

    expect(before).toBeGreaterThan(0);
    expect(after, "a cut character is still in Q04's cast").toBe(before - 1);
  });

  test("Q04: a cut prop leaves the prop list", async () => {
    const before = await withCut("q04-props-before", null, async (ctx) => {
      const s = await sceneTwelve(ctx.exec);
      return (await q04Result(ctx, s.uuid, s.id)).result.props.length;
    });
    expect(before).toBeGreaterThan(0);

    const after = await withCut(
      "q04-props-after",
      { table: "prop", where: "id = (SELECT MIN(prop_id) FROM scene_prop " +
                              "WHERE scene_id IN (SELECT id FROM scene " +
                              "WHERE scene_number = '12'))" },
      async (ctx) => {
        const s = await sceneTwelve(ctx.exec);
        return (await q04Result(ctx, s.uuid, s.id)).result.props.length;
      });
    expect(after, "a cut prop is still in Q04's props").toBeLessThan(before);
  });

  test("Q03: a cut costume leaves the world state", async () => {
    const count = async (ctx: ScfContext) => {
      const s = await sceneTwelve(ctx.exec);
      const r = await q03Result(ctx, s.uuid, s.id);
      return r.result.characters.reduce(
        (n, c) => n + c.costumes.length, 0);
    };
    const before = await withCut("q03-cos-before", null, count);
    expect(before).toBeGreaterThan(0);
    const after = await withCut(
      "q03-cos-after", { table: "costume", where: "id > 0" }, count);
    expect(after, "cut costumes are still in Q03").toBe(0);
  });

  test("Q03: a cut motif leaves the world state", async () => {
    const count = async (ctx: ScfContext) => {
      const s = await sceneTwelve(ctx.exec);
      return (await q03Result(ctx, s.uuid, s.id)).result.motifs.length;
    };
    const before = await withCut("q03-mot-before", null, count);
    expect(before).toBeGreaterThan(0);
    const after = await withCut(
      "q03-mot-after", { table: "motif", where: "id > 0" }, count);
    expect(after, "cut motifs are still in Q03").toBe(0);
  });

  test("Q02: a cut costume leaves the subject's context", async () => {
    const count = async (ctx: ScfContext) => {
      const s = await sceneTwelve(ctx.exec);
      const who = (await ctx.exec(
        "SELECT uuid, id FROM character WHERE name LIKE '%Eleanor%'"))[0];
      const r = await q02Result(
        ctx, "character", String(who?.["uuid"]), Number(who?.["id"]),
        s.uuid, s.id, null, null);
      return r.result.costumes?.length ?? 0;
    };
    const before = await withCut("q02-cos-before", null, count);
    expect(before).toBeGreaterThan(0);
    const after = await withCut(
      "q02-cos-after", { table: "costume", where: "id > 0" }, count);
    expect(after, "cut costumes are still in Q02").toBe(0);
  });

  test("a relationship whose endpoint is cut joins nothing", async () => {
    // §6.6 says eleven of thirteen link entities MUST NOT carry
    // lifecycle_status. That is not an oversight — a junction is a
    // connection, and a connection to a cut thing is already gone
    // because the thing is. But only if something checks the endpoint.
    const count = async (ctx: ScfContext) => {
      const who = (await ctx.exec(
        "SELECT id FROM character WHERE name LIKE '%Eleanor%'"))[0];
      return (await relationshipsFor(
        ctx.exec, ctx.registry, Number(who?.["id"]))).length;
    };
    const before = await withCut("rel-before", null, count);
    expect(before).toBeGreaterThan(0);
    const after = await withCut(
      "rel-after",
      { table: "character", where: "name LIKE '%Marcus%'" }, count);
    expect(after, "a relationship to a cut character still joins")
      .toBeLessThan(before);
  });
});

describe("§6.6.1's test as stated still holds", () => {
  test("the fixture's own cut rows change no answer", async () => {
    // The other direction, kept because the fix above could have been
    // written as "filter nothing and report less", which would break it.
    const cut = await withCut("still-excluded", null, async (ctx) => {
      const s = await sceneTwelve(ctx.exec);
      const r = await q03Result(ctx, s.uuid, s.id);
      return r.result.characters.flatMap((c) => c.states)
        .filter((st) => st.fields["lifecycle_status"] === "cut").length;
    });
    expect(cut).toBe(0);
  });
});
