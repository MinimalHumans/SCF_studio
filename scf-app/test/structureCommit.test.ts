import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { deriveStructure } from "@scf-core/structure.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import {
  classifySection, commitStructure, planCommitStructure,
} from "../src/editor/structureCommit.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

describe("classifySection reads the text before the depth", () => {
  test("an ACT is an act at any depth", () => {
    // '#' is not a reliable convention — plenty of writers use a single
    // '#' for sequences and never write an act line at all.
    expect(classifySection("# ACT II")?.kind).toBe("act");
    expect(classifySection("## ACT II")?.kind).toBe("act");
    expect(classifySection("### Act Three - the reckoning")?.kind)
      .toBe("act");
  });

  test("a SEQUENCE is a sequence at any depth", () => {
    expect(classifySection("# SEQUENCE 6")?.kind).toBe("sequence");
    expect(classifySection("## Sequence 6 — The Siege")?.kind)
      .toBe("sequence");
    expect(classifySection("# Seq 6")?.kind).toBe("sequence");
  });

  test("depth decides only when the text says neither", () => {
    expect(classifySection("# The Siege")?.kind).toBe("act");
    expect(classifySection("## The Siege")?.kind).toBe("sequence");
  });

  test("the label keeps what the writer wrote", () => {
    expect(classifySection("## SEQUENCE 6 — The Siege")?.label)
      .toBe("SEQUENCE 6 — The Siege");
  });

  test("a bare marker declares nothing", () => {
    expect(classifySection("#")).toBe(null);
    expect(classifySection("#   ")).toBe(null);
    expect(classifySection("not a section")).toBe(null);
  });
});

describe("commitStructure", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  const row = (lineType: string, content: string,
               sceneId: number | null = null,
               uuid = `u${String(Math.random()).slice(2, 10)}`):
      ScreenplayRow => ({
    lineOrder: 0, lineType, content, sceneId, characterId: null,
    locationId: null, metadata: null, uuid,
  } as ScreenplayRow);

  beforeAll(async () => {
    const registry = loadRegistry(JSON.parse(
      await readFile(REGISTRY, "utf8")) as RegistryJson);
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry);
    for (let i = 1; i <= 6; i += 1) {
      await db.exec(
        "INSERT INTO scene (name, scene_number) VALUES (?, ?)",
        [`INT. ROOM ${String(i)}`, i]);
    }
  });
  afterAll(() => { db.close(); });

  const rows = (): ScreenplayRow[] => [
    row("section", "# ACT I"),
    row("heading", "INT. ROOM 1 - DAY", 1),
    row("heading", "INT. ROOM 2 - DAY", 2),
    row("section", "## SEQUENCE 1 — The Siege"),
    row("heading", "INT. ROOM 3 - DAY", 3),
    row("section", "# ACT II"),
    row("heading", "INT. ROOM 4 - DAY", 4),
    row("heading", "INT. ROOM 5 - DAY", 5),
    row("heading", "INT. ROOM 6 - DAY", 6),
  ];

  test("previews what it would create without writing", async () => {
    const plan = await planCommitStructure(db.exec, rows());
    expect(plan.newActs).toEqual(["ACT I", "ACT II"]);
    expect(plan.newSequences).toEqual(["SEQUENCE 1 — The Siege"]);
    expect((await db.exec("SELECT COUNT(*) AS n FROM act"))[0]!["n"])
      .toBe(0);
  });

  test("creates nothing when createNew is false", async () => {
    const result = await commitStructure(db.exec, rows(), false);
    expect(result.actsCreated).toBe(0);
    expect((await db.exec("SELECT COUNT(*) AS n FROM act"))[0]!["n"])
      .toBe(0);
  });

  test("anchors each section to the scene heading below it", async () => {
    const plan = rows();
    const result = await commitStructure(db.exec, plan, true);
    expect(result.actsCreated).toBe(2);
    expect(result.sequencesCreated).toBe(1);

    const acts = await db.exec(
      "SELECT name, act_number, start_scene_id FROM act ORDER BY id");
    expect(acts.map((a) => [a["name"], a["start_scene_id"]]))
      .toEqual([["ACT I", 1], ["ACT II", 4]]);
    // Numbers follow the boundaries.
    expect(acts.map((a) => a["act_number"])).toEqual([1, 2]);
  });

  test("the section line remembers which entity it made", async () => {
    // Otherwise renaming a section would silently make a second act.
    const plan = rows();
    await commitStructure(db.exec, plan, true);
    const meta = plan[0]!.metadata as Record<string, unknown>;
    expect(meta["structureRef"]).toMatchObject({ kind: "act" });
  });

  test("membership derives to the right spans", async () => {
    const scenes = await db.exec("SELECT id, scene_number, name FROM scene");
    const acts = await db.exec("SELECT id, name, act_number, " +
                               "start_scene_id FROM act");
    const seqs = await db.exec("SELECT id, name, sequence_number, " +
                               "act_id, start_scene_id FROM sequence");
    const structure = deriveStructure(scenes, acts, seqs);
    expect(structure.acts.map((a) => a.sceneIds))
      .toEqual([[1, 2, 3], [4, 5, 6]]);
    // The sequence starts inside Act I and is closed by nothing after
    // it, so it runs to the end — crossing the act boundary, which
    // nothing forbids.
    expect(structure.sequences[0]!.sceneIds).toEqual([3, 4, 5, 6]);
  });

  test("scene_sequence rows are materialized in order", async () => {
    const links = await db.exec(
      "SELECT scene_id, order_in_sequence FROM scene_sequence " +
      "ORDER BY order_in_sequence");
    expect(links.map((r) => [r["scene_id"], r["order_in_sequence"]]))
      .toEqual([[3, 1], [4, 2], [5, 3], [6, 4]]);
  });

  test("committing again is idempotent", async () => {
    const before = await db.exec(
      "SELECT COUNT(*) AS a FROM act");
    const plan = rows();
    await commitStructure(db.exec, plan, true);
    const after = await db.exec("SELECT COUNT(*) AS a FROM act");
    expect(after[0]!["a"]).toBe(before[0]!["a"]);
    const links = await db.exec(
      "SELECT COUNT(*) AS n FROM scene_sequence");
    expect(links[0]!["n"]).toBe(4);
  });

  test("renaming a bound section renames its entity", async () => {
    const plan = rows();
    await commitStructure(db.exec, plan, true);   // binds the refs
    plan[0]!.content = "# ACT ONE";
    const result = await commitStructure(db.exec, plan, true);
    expect(result.renamed).toBe(1);
    expect(result.actsCreated).toBe(0);
    const acts = await db.exec("SELECT name FROM act ORDER BY id");
    expect(acts.map((a) => a["name"])).toEqual(["ACT ONE", "ACT II"]);
  });

  test("a section with no scene below it anchors nothing", async () => {
    const plan = [...rows(), row("section", "# ACT III")];
    const result = await commitStructure(db.exec, plan, true);
    expect(result.danglingSections).toBe(1);
    const acts = await db.exec(
      "SELECT COUNT(*) AS n FROM act WHERE name = 'ACT III'");
    expect(acts[0]!["n"]).toBe(0);
  });

  test("hand-made membership no boundary explains is reported, " +
       "never deleted", async () => {
    await db.exec(
      "INSERT INTO scene_sequence (scene_id, sequence_id) VALUES (?, ?)",
      [1, 1]);
    const result = await commitStructure(db.exec, rows(), true);
    expect(result.unexplainedMembership).toBe(1);
    const kept = await db.exec(
      "SELECT COUNT(*) AS n FROM scene_sequence WHERE scene_id = 1");
    expect(kept[0]!["n"]).toBe(1);
  });
});
