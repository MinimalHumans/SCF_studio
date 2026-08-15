import { beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { applyImport, defaultAcceptance, prepareImport }
  from "../src/editor/importPipeline.ts";
import { SCENE_SCRIPT_SQL } from "../src/editor/shootOps.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));
const ALEXIS_NEXUS = fileURLToPath(new URL(
  "../../corpus/public/scripts/alexis-nexus.fountain",
  import.meta.url));

describe("reading a scene in the shoot outline", () => {
  let db: ReturnType<typeof openNodeDatabase>;
  let sceneId: number;

  beforeAll(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    const prepared = prepareImport(
      await readFile(ALEXIS_NEXUS, "utf8"), "fountain");
    await applyImport(db.exec, prepared,
                      defaultAcceptance(prepared.proposals));
    sceneId = Number((await db.exec(
      "SELECT id FROM scene ORDER BY scene_number LIMIT 1"))[0]!["id"]);
  });

  const read = async (id: number): Promise<Array<Record<string, unknown>>> =>
    db.exec(SCENE_SCRIPT_SQL, [id, id, id]);

  test("returns the scene's lines, starting at its heading", async () => {
    const lines = await read(sceneId);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!["line_type"]).toBe("heading");
  });

  test("stops at the next heading", async () => {
    const lines = await read(sceneId);
    expect(lines.filter((l) => l["line_type"] === "heading"))
      .toHaveLength(1);
  });

  test("still works when body lines lost their scene_id", async () => {
    // The reason this query keys off the heading: the per-line scene_id
    // is threaded at commit, so a line typed since — or a project from
    // before the threading existed — simply has none.
    const before = (await read(sceneId)).length;
    await db.exec(
      "UPDATE screenplay_lines SET scene_id = NULL " +
      "WHERE line_type != 'heading'");
    expect((await read(sceneId)).length).toBe(before);
  });

  test("a scene with no heading in the script returns nothing", async () => {
    await db.exec("INSERT INTO scene (name, scene_number) " +
                  "VALUES ('INT. NOWHERE', 999)");
    const orphan = Number((await db.exec(
      "SELECT last_insert_rowid() AS id"))[0]!["id"]);
    expect(await read(orphan)).toEqual([]);
  });
});
