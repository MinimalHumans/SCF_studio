import {
  beforeAll, beforeEach, afterAll, describe, expect, test,
} from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openNodeDatabase } from "@scf-core/node.ts";
import { initDatabase } from "@scf-core/db.ts";
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN, deriveStructure, sceneOrderHint,
  scenePositions,
} from "@scf-core/structure.ts";
import type { ScreenplayRow } from "@scf-core/screenplay/rowModel.ts";
import {
  classifySection, commitStructure, planCommitStructure,
  reanchorSpansForMove, setNumberingMode,
} from "../src/editor/structureCommit.ts";
import { initScreenplayTables } from "@scf-core/screenplay/rowModel.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

async function freshDb(): Promise<ReturnType<typeof openNodeDatabase>> {
  const registry = loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  const db = openNodeDatabase(":memory:");
  await initDatabase(db.exec, registry);
  await initScreenplayTables(db.exec);
  await db.exec("INSERT INTO project (name) VALUES ('Test')");
  return db;
}

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

/**
 * Scene numbers follow the script's order — but only when the project
 * says they may. An imported script's numbering is the production's own
 * data, and renumbering it on the first commit would destroy it.
 */
describe("scene renumbering", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  const script = async (order: number[]): Promise<void> => {
    await db.exec("DELETE FROM screenplay_lines");
    for (const [i, sceneId] of order.entries()) {
      await db.exec(
        "INSERT INTO screenplay_lines (line_order, line_type, content, " +
        "scene_id, uuid) VALUES (?, 'heading', ?, ?, ?)",
        [i * 10, `SCENE ${String(sceneId)}`, sceneId, `H${String(sceneId)}`]);
    }
  };
  // Labels, not numbers (spec §4.2) — `scene_number` is text since
  // schema 2.9 so that "12A" survives.
  const numbers = async (): Promise<Array<string | null>> => {
    const rows = await db.exec(
      "SELECT id, scene_number FROM scene ORDER BY id");
    return rows.map((r) => {
      const v = r["scene_number"];
      return v === null || v === undefined ? null : String(v);
    });
  };

  beforeEach(async () => {
    db = await freshDb();
    for (const name of ["KITCHEN", "MOON BASE", "RIDGE"]) {
      await db.exec("INSERT INTO scene (name) VALUES (?)", [name]);
    }
  });

  test("derived: numbers come from the script's order", async () => {
    await script([1, 2, 3]);
    await commitStructure(db.exec, [], true);
    expect(await numbers()).toEqual(["1", "2", "3"]);
  });

  test("derived: moving a scene renumbers from its new position",
       async () => {
    await script([1, 2, 3]);
    await commitStructure(db.exec, [], true);
    // Scene 2 dragged to the end.
    await script([1, 3, 2]);
    await commitStructure(db.exec, [], true);
    expect(await numbers()).toEqual(["1", "3", "2"]);
  });

  test("derived: a scene not in the script loses its number", async () => {
    await script([1, 2, 3]);
    await commitStructure(db.exec, [], true);
    await script([1, 3]);
    await commitStructure(db.exec, [], true);
    // Scene 2 is orphaned: it has no position, so no number.
    expect(await numbers()).toEqual(["1", null, "2"]);
  });

  test("fixed: an imported production's numbering is never touched",
       async () => {
    // "12A" is the case the widening exists for: an A-page in an
    // imported locked script, which parseInt used to truncate to 12.
    await db.exec(
      "UPDATE scene SET scene_number = '12' WHERE id = 1");
    await db.exec(
      "UPDATE scene SET scene_number = '12A' WHERE id = 2");
    await db.exec(
      "UPDATE scene SET scene_number = '47' WHERE id = 3");
    await setNumberingMode(db.exec, "fixed");
    await script([1, 2, 3]);
    await commitStructure(db.exec, [], true);
    // Gaps and duplicates survive: they are the production's data.
    expect(await numbers()).toEqual(["12", "12A", "47"]);
  });

  test("a project with no stored preference renumbers", async () => {
    // Absent means derived — a project the app has always been free to
    // renumber must not silently freeze.
    await db.exec("DELETE FROM project");
    await script([1, 2, 3]);
    await commitStructure(db.exec, [], true);
    expect(await numbers()).toEqual(["1", "2", "3"]);
  });
});

/**
 * Moving a scene must move the SCENE, not the act it happens to anchor.
 *
 * Acts and sequences are anchored to a start scene, so dragging the
 * first scene of act one into act two dragged act one's boundary with
 * it: act one started at position 9, act two sat ahead of it, and every
 * scene between belonged to no act at all.
 */
describe("boundaries stay put when their anchor scene moves", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    db = await freshDb();
    for (const name of ["A", "B", "C", "D"]) {
      await db.exec("INSERT INTO scene (name) VALUES (?)", [name]);
    }
    // Act 1 anchored on scene 1, act 2 on scene 3.
    await db.exec(
      "INSERT INTO act (name, start_scene_id) VALUES ('One', 1)");
    await db.exec(
      "INSERT INTO act (name, start_scene_id) VALUES ('Two', 3)");
  });

  const anchors = async (): Promise<number[]> => {
    const rows = await db.exec(
      "SELECT start_scene_id FROM act ORDER BY id");
    return rows.map((r) => r["start_scene_id"] as number);
  };

  test("the act re-anchors to the scene that now starts it", async () => {
    // Scene 1 dragged into act two. Act one should still begin where it
    // began — with scene 2, which is now its first scene.
    expect(await reanchorSpansForMove(db.exec, 1, [1, 2, 3, 4])).toBe(1);
    expect(await anchors()).toEqual([2, 3]);
  });

  test("a scene that anchors nothing changes nothing", async () => {
    expect(await reanchorSpansForMove(db.exec, 2, [1, 2, 3, 4])).toBe(0);
    expect(await anchors()).toEqual([1, 3]);
  });

  test("the last scene has no successor, so the span follows it",
       async () => {
    await db.exec("UPDATE act SET start_scene_id = 4 WHERE id = 2");
    expect(await reanchorSpansForMove(db.exec, 4, [1, 2, 3, 4])).toBe(0);
    expect(await anchors()).toEqual([1, 4]);
  });

  test("sequences re-anchor on the same terms", async () => {
    await db.exec(
      "INSERT INTO sequence (name, start_scene_id) VALUES ('S1', 1)");
    expect(await reanchorSpansForMove(db.exec, 1, [1, 2, 3, 4])).toBe(2);
    const rows = await db.exec("SELECT start_scene_id FROM sequence");
    expect(rows[0]!["start_scene_id"]).toBe(2);
  });

  test("act membership after the move is what dragging meant", async () => {
    // Scene 1 moves to the end: script order becomes 2, 3, 4, 1.
    await reanchorSpansForMove(db.exec, 1, [1, 2, 3, 4]);
    for (const [i, sceneId] of [2, 3, 4, 1].entries()) {
      await db.exec(
        "INSERT INTO screenplay_lines (line_order, line_type, content, " +
        "scene_id, uuid) VALUES (?, 'heading', 'H', ?, ?)",
        [i * 10, sceneId, `H${String(sceneId)}`]);
    }
    await commitStructure(db.exec, [], true);
    const scenes = await db.exec("SELECT id, scene_number FROM scene");
    const acts = await db.exec("SELECT id, start_scene_id FROM act");
    const structure = deriveStructure(
      scenes, acts, [],
      new Map([[2, 0], [3, 1], [4, 2], [1, 3]]));
    // Act one begins with scene 2; act two still begins at scene 3; the
    // moved scene lands in act two rather than stranding anything.
    expect(structure.actOfScene.get(2)).toBe(1);
    expect(structure.actOfScene.get(3)).toBe(2);
    expect(structure.actOfScene.get(1)).toBe(2);
  });
});

/** Shot codes track their scene's number while numbering is derived. */
describe("shot codes follow the scene", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    db = await freshDb();
    await db.exec("INSERT INTO scene (name) VALUES ('A')");
    await db.exec("INSERT INTO scene (name) VALUES ('B')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, uuid) VALUES (0, 'heading', 'H', 1, 'H1')");
    await db.exec(
      "INSERT INTO screenplay_lines (line_order, line_type, content, " +
      "scene_id, uuid) VALUES (10, 'heading', 'H', 2, 'H2')");
  });

  const codes = async (): Promise<string[]> => {
    const rows = await db.exec(
      "SELECT shot_number FROM shot ORDER BY id");
    return rows.map((r) => String(r["shot_number"]));
  };

  test("derived: 2A becomes 1A when its scene becomes scene 1",
       async () => {
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('', 2, '2A')");
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('', 2, '2B')");
    // Scene 2 is second in the script, so it numbers 2 — no change yet.
    await commitStructure(db.exec, [], true);
    expect(await codes()).toEqual(["2A", "2B"]);

    // Now it moves to the front.
    await db.exec(
      "UPDATE screenplay_lines SET line_order = -10 WHERE uuid = 'H2'");
    await commitStructure(db.exec, [], true);
    expect(await codes()).toEqual(["1A", "1B"]);
  });

  test("fixed: a code a crew may hold on paper is never rewritten",
       async () => {
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('', 2, '2A')");
    await setNumberingMode(db.exec, "fixed");
    await db.exec(
      "UPDATE screenplay_lines SET line_order = -10 WHERE uuid = 'H2'");
    await commitStructure(db.exec, [], true);
    expect(await codes()).toEqual(["2A"]);
  });

  test("an unparseable code is left alone", async () => {
    await db.exec(
      "INSERT INTO shot (name, scene_id, shot_number) " +
      "VALUES ('', 1, 'pickup-3')");
    await commitStructure(db.exec, [], true);
    expect(await codes()).toEqual(["pickup-3"]);
  });
});

/**
 * The SQL twin of scenePositions must agree with it, or a picker and the
 * editor show a different film.
 */
describe("SCENE_ORDER_BY matches scenePositions", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    db = await freshDb();
    for (const name of ["A", "B", "C", "D"]) {
      await db.exec("INSERT INTO scene (name) VALUES (?)", [name]);
    }
  });

  const sqlOrder = async (): Promise<number[]> => {
    const rows = await db.exec(
      `SELECT s.id FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`);
    return rows.map((r) => r["id"] as number);
  };
  const tsOrder = async (): Promise<number[]> => {
    const scenes = await db.exec("SELECT id, scene_number, name FROM scene");
    const headings = await db.exec(
      "SELECT scene_id, line_order FROM screenplay_lines " +
      "WHERE line_type = 'heading' ORDER BY line_order");
    return scenePositions(scenes, sceneOrderHint(headings))
      .map((s) => s.id);
  };
  const script = async (order: number[]): Promise<void> => {
    await db.exec("DELETE FROM screenplay_lines");
    for (const [i, id] of order.entries()) {
      await db.exec(
        "INSERT INTO screenplay_lines (line_order, line_type, content, " +
        "scene_id, uuid) VALUES (?, 'heading', 'H', ?, ?)",
        [i * 10, id, `H${String(id)}`]);
    }
  };

  test("no screenplay: both fall back to numbers then id", async () => {
    await db.exec("UPDATE scene SET scene_number = 9 WHERE id = 1");
    expect(await sqlOrder()).toEqual(await tsOrder());
    // A numbered scene sorts ahead of unnumbered ones even when its
    // number is high — the number is evidence of a position, and having
    // none is what puts a scene last.
    expect(await sqlOrder()).toEqual([1, 2, 3, 4]);
  });

  test("with a screenplay, both follow the script", async () => {
    await script([3, 1, 4, 2]);
    expect(await sqlOrder()).toEqual([3, 1, 4, 2]);
    expect(await sqlOrder()).toEqual(await tsOrder());
  });

  test("scenes not in the script sort last, in both", async () => {
    await script([4, 2]);
    expect(await sqlOrder()).toEqual([4, 2, 1, 3]);
    expect(await sqlOrder()).toEqual(await tsOrder());
  });

  test("fixed numbering: the list still follows the page", async () => {
    // The numbers are frozen on purpose; the ORDER must not be, or a
    // picker shows the pre-move film.
    await db.exec("UPDATE scene SET scene_number = id");
    await setNumberingMode(db.exec, "fixed");
    await script([4, 3, 2, 1]);
    await commitStructure(db.exec, [], true);
    expect(await sqlOrder()).toEqual([4, 3, 2, 1]);
    expect(await sqlOrder()).toEqual(await tsOrder());
  });
});

/**
 * Deleting the scene an act starts at must not take the act with it.
 *
 * The act row was never deleted — it pointed at a scene that no longer
 * existed, so it stopped appearing in the derived structure entirely and
 * every scene it held fell out of any act, taking the Shoot tab's
 * grouping with it. Indistinguishable from deletion, from the outside.
 */
describe("deleting a boundary scene", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    db = await freshDb();
    for (const name of ["A", "B", "C"]) {
      await db.exec("INSERT INTO scene (name) VALUES (?)", [name]);
    }
    await db.exec(
      "INSERT INTO act (name, start_scene_id) VALUES ('One', 1)");
  });

  test("the act survives, anchored to the next scene", async () => {
    await reanchorSpansForMove(db.exec, 1, [1, 2, 3]);
    await db.exec("DELETE FROM scene WHERE id = 1");

    const acts = await db.exec("SELECT id, start_scene_id FROM act");
    expect(acts).toHaveLength(1);
    expect(acts[0]!["start_scene_id"]).toBe(2);

    // And it still holds the remaining scenes.
    const scenes = await db.exec("SELECT id, scene_number, name FROM scene");
    const structure = deriveStructure(
      scenes, acts, [], new Map([[2, 0], [3, 1]]));
    expect(structure.actOfScene.get(2)).toBe(1);
    expect(structure.actOfScene.get(3)).toBe(1);
  });

  test("deleting the last scene leaves the act anchored to it",
       async () => {
    // No successor to hand the boundary to. structureFindings reports
    // the dangling boundary rather than the app guessing.
    await db.exec("UPDATE act SET start_scene_id = 3");
    await reanchorSpansForMove(db.exec, 3, [1, 2, 3]);
    const acts = await db.exec("SELECT start_scene_id FROM act");
    expect(acts[0]!["start_scene_id"]).toBe(3);
  });
});

/**
 * sequence.act_id was READ at commit and never written, so it sat null on
 * every sequence the app has made — a stored field consumers would
 * reasonably trust, empty all along.
 */
describe("sequence act membership is written down", () => {
  let db: ReturnType<typeof openNodeDatabase>;

  beforeEach(async () => {
    db = await freshDb();
    for (const name of ["A", "B", "C", "D"]) {
      await db.exec("INSERT INTO scene (name) VALUES (?)", [name]);
    }
    for (const [i, id] of [1, 2, 3, 4].entries()) {
      await db.exec(
        "INSERT INTO screenplay_lines (line_order, line_type, content, " +
        "scene_id, uuid) VALUES (?, 'heading', 'H', ?, ?)",
        [i * 10, id, `H${String(id)}`]);
    }
    await db.exec(
      "INSERT INTO act (name, start_scene_id) VALUES ('One', 1)");
    await db.exec(
      "INSERT INTO act (name, start_scene_id) VALUES ('Two', 3)");
  });

  const actIds = async (): Promise<Array<number | null>> => {
    const rows = await db.exec(
      "SELECT act_id FROM sequence ORDER BY id");
    return rows.map((r) => (r["act_id"] ?? null) as number | null);
  };

  test("a sequence belongs to the act its start scene falls in",
       async () => {
    await db.exec(
      "INSERT INTO sequence (name, start_scene_id) VALUES ('S1', 1)");
    await db.exec(
      "INSERT INTO sequence (name, start_scene_id) VALUES ('S2', 4)");
    await commitStructure(db.exec, [], true);
    expect(await actIds()).toEqual([1, 2]);
  });

  test("a sequence crossing a boundary is attributed to where it starts",
       async () => {
    // S1 spans scenes 2-3, crossing into act two. It belongs to act one,
    // which is how a crossing sequence is attributed everywhere else.
    await db.exec(
      "INSERT INTO sequence (name, start_scene_id) VALUES ('S1', 2)");
    await commitStructure(db.exec, [], true);
    expect(await actIds()).toEqual([1]);
  });

  test("it follows the acts when a boundary moves", async () => {
    await db.exec(
      "INSERT INTO sequence (name, start_scene_id) VALUES ('S1', 2)");
    await commitStructure(db.exec, [], true);
    expect(await actIds()).toEqual([1]);
    // Act two now starts earlier, so the sequence changes act.
    await db.exec("UPDATE act SET start_scene_id = 2 WHERE id = 2");
    await commitStructure(db.exec, [], true);
    expect(await actIds()).toEqual([2]);
  });
});
