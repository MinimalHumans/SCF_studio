// SPDX-License-Identifier: Apache-2.0
/**
 * roundTrip.test.ts — the Writer role's defining property.
 *
 * `conformance.md` §2.2 says a Writer must "open, save, and lose
 * nothing", and until now nothing tested it. `extensibility.test.ts`
 * covers `initDatabase` in isolation, which is the easy half: the hard
 * half is the app's actual cycle, where a file is opened, real editor
 * operations run against it, and it is written back.
 *
 * Two things make this testable headlessly. The app's save is
 * `sqlite3_js_db_export` — a serialisation of the live database, not a
 * rewrite — so writing a real file with the Node driver and reopening
 * it exercises the same guarantee. And the editor operations that matter
 * live in `src/editor/`, deliberately outside `ui/`, so they can be
 * driven without a store or a worker.
 *
 * The comparison is a canonical dump (spec §11.6), never bytes. SQLite
 * reorders pages and reuses freelist space without any row changing, so
 * a byte comparison would fail constantly and prove nothing when it
 * passed.
 */
import { afterEach, describe, expect, test } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDump, diffDumps } from "@scf-core/canonical.ts";
import { initDatabase } from "@scf-core/db.ts";
import { collectFindings } from "@scf-core/findings.ts";
import { numberingPolicy } from "@scf-core/numbering.ts";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { openNodeDatabase, type NodeDatabase } from "@scf-core/node.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../fixtures/hollow_creek.scf");
const REGISTRY = join(HERE, "../../scf-core/registry/registry.json");

let workdir: string | null = null;
afterEach(() => {
  if (workdir !== null) rmSync(workdir, { recursive: true, force: true });
  workdir = null;
});

const registryFor = async (): Promise<Registry> =>
  loadRegistry(JSON.parse(await readFile(REGISTRY, "utf8")) as RegistryJson);

/** A working copy of the fixture, as opening one in the app would give. */
function workingCopy(): string {
  workdir = mkdtempSync(join(tmpdir(), "scf-roundtrip-"));
  const path = join(workdir, "project.scf");
  copyFileSync(FIXTURE, path);
  return path;
}

/** Open the way the app does: open the file, then initDatabase over it. */
async function open(path: string, registry: Registry):
    Promise<NodeDatabase> {
  const db = openNodeDatabase(path);
  await initDatabase(db.exec, registry);
  return db;
}

describe("open -> save loses nothing", () => {
  test("a cycle with no edits changes no document content", async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await canonicalDump(db.exec);
    db.close();

    db = await open(path, registry);
    const after = await canonicalDump(db.exec);
    db.close();

    expect(diffDumps(before, after)).toEqual([]);
    expect(after.rowCount).toBe(before.rowCount);
  });

  test("ten cycles erode nothing", async () => {
    // One cycle surviving could be luck. A project is opened and saved
    // hundreds of times over its life, and a loss of one row per cycle
    // is exactly the kind of defect nobody notices until the data is
    // gone.
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await canonicalDump(db.exec);
    db.close();

    for (let i = 0; i < 10; i += 1) {
      const d = await open(path, registry);
      d.close();
    }

    db = await open(path, registry);
    expect(diffDumps(before, await canonicalDump(db.exec))).toEqual([]);
    db.close();
  });

  test("row ids are stable too, not merely identity", async () => {
    // Stricter than document equality: nothing should be renumbering
    // rows on open, and if something starts to, this catches it before
    // anyone relies on an id in an export.
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await canonicalDump(db.exec, { includeRowIds: true });
    db.close();

    db = await open(path, registry);
    const after = await canonicalDump(db.exec, { includeRowIds: true });
    db.close();

    expect(diffDumps(before, after)).toEqual([]);
  });
});

describe("third-party content survives the app's cycle (spec §10.1)", () => {
  test("an x_ table, an x_ column and an unknown table all persist",
       async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    await db.exec(
      "CREATE TABLE x_farm_jobs (id INTEGER PRIMARY KEY, note TEXT)");
    await db.exec("INSERT INTO x_farm_jobs (note) VALUES ('denoise')");
    await db.exec("ALTER TABLE scene ADD COLUMN x_priority INTEGER");
    await db.exec("UPDATE scene SET x_priority = 3 WHERE scene_number='12'");
    await db.exec("CREATE TABLE legacy_bridge (k TEXT, v TEXT)");
    await db.exec("INSERT INTO legacy_bridge VALUES ('sg', 'sg-1')");
    db.close();

    // Three further open/save cycles, the way a week of work would.
    for (let i = 0; i < 3; i += 1) {
      const d = await open(path, registry);
      d.close();
    }

    db = await open(path, registry);
    const jobs = await db.exec("SELECT note FROM x_farm_jobs");
    expect(jobs[0]?.["note"]).toBe("denoise");
    const scene = await db.exec(
      "SELECT x_priority FROM scene WHERE scene_number='12'");
    expect(scene[0]?.["x_priority"]).toBe(3);
    const bridge = await db.exec("SELECT v FROM legacy_bridge");
    expect(bridge[0]?.["v"]).toBe("sg-1");
    db.close();
  });

  test("the canonical dump notices if unknown content is lost",
       async () => {
    // Guards the guard: if the dump silently skipped unknown tables it
    // would report success while the very thing §10.1 protects went
    // missing.
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    await db.exec("CREATE TABLE legacy_bridge (k TEXT)");
    await db.exec("INSERT INTO legacy_bridge VALUES ('one')");
    const before = await canonicalDump(db.exec);
    await db.exec("DROP TABLE legacy_bridge");
    const after = await canonicalDump(db.exec);
    db.close();

    expect(diffDumps(before, after)).toEqual([
      { table: "legacy_bridge", kind: "table-removed",
        detail: "1 rows lost" },
    ]);
  });
});

describe("edits are the only thing that changes", () => {
  test("an edit shows up, and nothing else does", async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await canonicalDump(db.exec);
    db.close();

    db = await open(path, registry);
    await db.exec(
      "UPDATE scene SET name = 'INT. KITCHEN — RENAMED' " +
      "WHERE scene_number = '12'");
    db.close();

    db = await open(path, registry);
    const after = await canonicalDump(db.exec);
    db.close();

    // Exactly one table differs. If a rename touched anything else —
    // a denormalised label somewhere, say, which spec §3.1 exists to
    // prevent — it would show up here as a second entry.
    expect(diffDumps(before, after).map((d) => d.table)).toEqual(["scene"]);
  });

  test("authored shot numbers survive the cycle (spec §3.3)", async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await db.exec(
      "SELECT uuid, shot_number FROM shot ORDER BY uuid");
    db.close();

    for (let i = 0; i < 3; i += 1) {
      const d = await open(path, registry);
      d.close();
    }

    db = await open(path, registry);
    const after = await db.exec(
      "SELECT uuid, shot_number FROM shot ORDER BY uuid");
    db.close();

    expect(after).toEqual(before);
    // The fixture keeps a production scheme the derived code disagrees
    // with; that disagreement is the point of §3.3 and must survive.
    expect(before.length).toBeGreaterThan(0);
  });

  test("scene numbering is not recomputed on a fixed project (§4.3)",
       async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    // Read through the resolver, not the column: `scene_numbering` is
    // deprecated in 2.11 and gone in 2.12 (spec §4.3).
    expect(await numberingPolicy(db.exec)).toBe("fixed");
    const before = await db.exec(
      "SELECT uuid, scene_number FROM scene ORDER BY uuid");
    db.close();

    for (let i = 0; i < 3; i += 1) {
      const d = await open(path, registry);
      d.close();
    }

    db = await open(path, registry);
    const after = await db.exec(
      "SELECT uuid, scene_number FROM scene ORDER BY uuid");
    db.close();

    // Hollow Creek's gapped numbering is load-bearing: renumbering it
    // would silently change the subject of every "sc 12" assertion in
    // the canonical suite.
    expect(after).toEqual(before);
  });
});

describe("the file stays valid across the cycle", () => {
  test("scf-check finds nothing before or after", async () => {
    const registry = await registryFor();
    const path = workingCopy();

    let db = await open(path, registry);
    const before = await collectFindings(db.exec, registry);
    db.close();

    db = await open(path, registry);
    await db.exec(
      "UPDATE scene SET name = 'INT. KITCHEN — EDITED' " +
      "WHERE scene_number = '12'");
    db.close();

    db = await open(path, registry);
    const after = await collectFindings(db.exec, registry);
    db.close();

    expect(before.findings).toEqual([]);
    expect(after.findings).toEqual([]);
  });

  test("the header stamps survive (spec §1.2)", async () => {
    const registry = await registryFor();
    const path = workingCopy();

    for (let i = 0; i < 3; i += 1) {
      const d = await open(path, registry);
      d.close();
    }

    const db = await open(path, registry);
    const appId = await db.exec("PRAGMA application_id");
    expect(Object.values(appId[0] ?? {})[0]).toBe(0x53434631);
    db.close();
  });
});
