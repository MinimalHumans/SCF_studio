/**
 * Spec §10.1 and §10.3 — extensibility, tested rather than asserted.
 *
 * Two requirements meet here:
 *
 *   §10.1  A reader MUST ignore tables, columns and rows it does not
 *          recognise. A WRITER MUST PRESERVE THEM ACROSS A
 *          READ-MODIFY-WRITE CYCLE.
 *   §10.3  Third-party tables and columns are prefixed `x_`, a
 *          namespace the specification will never claim.
 *
 * Preservation was believed true and never verified — `stability.md`
 * carried it as an Unstable row on exactly that basis. It is the
 * defining property of the Writer role in `conformance.md` §2.2, and
 * the single most likely place a conformance claim would fail, because
 * `initDatabase` runs over every file the editor opens and could
 * plausibly drop something without anyone noticing until a third
 * party's data went missing.
 *
 * The test is deliberately hostile: the extension data goes in FIRST,
 * `initDatabase` runs over it, and then every byte of it is checked.
 */
import { afterEach, describe, expect, test } from "vitest";
import { initDatabase } from "../src/db.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { registry } from "./setup.ts";

let db: NodeDatabase | null = null;

afterEach(() => { db?.close(); db = null; });

/** A database carrying third-party content, before SCF touches it. */
async function withExtensions(): Promise<NodeDatabase> {
  const d = openNodeDatabase(":memory:");
  await initDatabase(d.exec, registry);

  // A third-party table in the reserved extension namespace.
  await d.exec(
    "CREATE TABLE x_render_notes (id INTEGER PRIMARY KEY, " +
    "scene_id INTEGER, note TEXT)");
  await d.exec(
    "INSERT INTO x_render_notes (scene_id, note) VALUES (?, ?)",
    [1, "denoise pass 2"]);

  // A third-party column on an SCF table.
  await d.exec("ALTER TABLE scene ADD COLUMN x_farm_priority INTEGER");
  await d.exec("INSERT INTO scene (name, x_farm_priority) VALUES (?, ?)",
               ["INT. RENDER FARM", 7]);

  // An unknown table with NO prefix. §10.1 says preserve unknown
  // content; it does not say "preserve correctly-prefixed content".
  // Someone else's tool predating the convention still must not lose
  // data.
  await d.exec("CREATE TABLE legacy_pipeline (k TEXT, v TEXT)");
  await d.exec("INSERT INTO legacy_pipeline (k, v) VALUES (?, ?)",
               ["shotgun_id", "sg-4471"]);
  return d;
}

const tableNames = async (d: NodeDatabase): Promise<Set<string>> => {
  const rows = await d.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((r) => String(r["name"])));
};

describe("a write cycle preserves unknown content (§10.1)", () => {
  test("an x_ table and its rows survive re-initialisation", async () => {
    db = await withExtensions();
    await initDatabase(db.exec, registry);

    expect(await tableNames(db)).toContain("x_render_notes");
    const rows = await db.exec("SELECT scene_id, note FROM x_render_notes");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["note"]).toBe("denoise pass 2");
  });

  test("an x_ column on an SCF table survives, with its values",
       async () => {
    db = await withExtensions();
    await initDatabase(db.exec, registry);

    const rows = await db.exec(
      "SELECT x_farm_priority FROM scene WHERE name = 'INT. RENDER FARM'");
    expect(rows[0]?.["x_farm_priority"]).toBe(7);
  });

  test("an unprefixed unknown table survives too", async () => {
    db = await withExtensions();
    await initDatabase(db.exec, registry);

    const rows = await db.exec("SELECT k, v FROM legacy_pipeline");
    expect(rows[0]?.["v"]).toBe("sg-4471");
  });

  test("repeated cycles do not erode anything", async () => {
    // One pass surviving could be luck; the editor opens and saves a
    // file many times over its life.
    db = await withExtensions();
    for (let i = 0; i < 5; i += 1) await initDatabase(db.exec, registry);

    expect(await tableNames(db)).toContain("x_render_notes");
    expect((await db.exec("SELECT * FROM x_render_notes"))).toHaveLength(1);
    expect((await db.exec("SELECT * FROM legacy_pipeline"))).toHaveLength(1);
    const scene = await db.exec(
      "SELECT x_farm_priority FROM scene WHERE name = 'INT. RENDER FARM'");
    expect(scene[0]?.["x_farm_priority"]).toBe(7);
  });
});

describe("SCF does not claim the extension namespace (§10.3)", () => {
  test("initDatabase creates no table beginning x_", async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    const created = [...await tableNames(db)];
    expect(created.filter((n) => n.startsWith("x_"))).toEqual([]);
  });

  test("and no column beginning x_", async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    const tables = [...await tableNames(db)];
    const offenders: string[] = [];
    for (const t of tables) {
      const cols = await db.exec(`PRAGMA table_info("${t}")`);
      for (const c of cols) {
        const name = String(c["name"]);
        if (name.startsWith("x_")) offenders.push(`${t}.${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("an x_ table is not mistaken for an entity needing uuids",
       async () => {
    // The uuid backfill walks registry tables and uuidExtraTables. A
    // third-party table must not be swept into that — SCF adding
    // columns to someone else's table would be the same overreach as
    // dropping it.
    db = await withExtensions();
    await initDatabase(db.exec, registry);
    const cols = await db.exec("PRAGMA table_info(x_render_notes)");
    expect(cols.map((c) => String(c["name"])))
      .toEqual(["id", "scene_id", "note"]);
  });
});
