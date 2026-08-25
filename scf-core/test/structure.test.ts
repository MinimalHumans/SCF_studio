// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import type { Row } from "../src/db.ts";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN, actOf, actOutline, deriveStructure,
  orphanedScenes, sceneOrderHint, scenePositions, sequenceOf,
  storyOrder, structureFindings,
} from "../src/structure.ts";

/** Ten numbered scenes, ids offset from numbers to catch id/number mixups. */
const scenes: Row[] = Array.from({ length: 10 }, (_, i) => ({
  id: 100 + i, scene_number: i + 1, name: `INT. ROOM ${String(i + 1)}`,
}));

const act = (id: number, name: string, start: number,
             number: number | null = null): Row =>
  ({ id, name, act_number: number, start_scene_id: start });
const seq = (id: number, name: string, start: number,
             actId: number | null = null): Row =>
  ({ id, name, sequence_number: null, start_scene_id: start,
     act_id: actId });

describe("story order", () => {
  test("numbered scenes lead, unnumbered follow by id", () => {
    const mixed: Row[] = [
      { id: 5, scene_number: null, name: "B" },
      { id: 3, scene_number: 2, name: "A" },
      { id: 4, scene_number: null, name: "C" },
      { id: 9, scene_number: 1, name: "D" },
    ];
    expect(scenePositions(mixed).map((s) => s.id)).toEqual([9, 3, 4, 5]);
  });
});

describe("spans are contiguous and closed by the next boundary", () => {
  const structure = deriveStructure(scenes,
    [act(1, "Act I", 100), act(2, "Act II", 103), act(3, "Act III", 108)],
    []);

  test("an act runs to the scene before the next act", () => {
    expect(structure.acts.map((a) => [a.name, a.startIndex, a.endIndex]))
      .toEqual([["Act I", 0, 2], ["Act II", 3, 7], ["Act III", 8, 9]]);
  });

  test("the last act runs to the end of the script", () => {
    expect(structure.acts[2]!.sceneIds).toEqual([108, 109]);
  });

  test("every scene lands in exactly one act", () => {
    expect(structure.actOfScene.size).toBe(scenes.length);
    expect(structure.unassignedSceneIds).toEqual([]);
  });

  test("scenes 32-54, in the small: two placements, not 23 rows", () => {
    expect(actOf(structure, 104)?.name).toBe("Act II");
    expect(actOf(structure, 107)?.name).toBe("Act II");
    expect(actOf(structure, 108)?.name).toBe("Act III");
  });

  test("a scene inserted mid-act joins it without touching the act", () => {
    // "5A", not 5.5 — spec §4.2.1. A decimal is not how a script
    // numbers an inserted scene, and since 0.10 it parses as opaque and
    // sorts last rather than landing between 5 and 6.
    const withInsert = [...scenes,
      { id: 200, scene_number: "5A", name: "INT. NEW" } as Row];
    const after = deriveStructure(withInsert,
      [act(1, "Act I", 100), act(2, "Act II", 103), act(3, "Act III", 108)],
      []);
    expect(actOf(after, 200)?.name).toBe("Act II");
    // ...and the act rows are untouched: the boundary is the only fact.
    expect(after.acts[1]!.startSceneId).toBe(103);
  });
});

describe("acts and sequences are independent", () => {
  const structure = deriveStructure(scenes,
    [act(1, "Act I", 100), act(2, "Act II", 104)],
    [seq(10, "Sequence 1", 100), seq(11, "The Siege", 105)]);

  test("a scene can be in an act with no sequence at all", () => {
    // The original complaint: an act used to be unreachable without
    // first inventing a sequence.
    expect(actOf(structure, 104)?.name).toBe("Act II");
    expect(sequenceOf(structure, 104)?.name).toBe("Sequence 1");
    const noSeq = deriveStructure(scenes, [act(1, "Act I", 100)], []);
    expect(actOf(noSeq, 104)?.name).toBe("Act I");
    expect(sequenceOf(noSeq, 104)).toBe(null);
  });

  test("a sequence may span an act boundary — nothing forbids it", () => {
    expect(structure.sequences[0]!.sceneIds).toContain(104);
    expect(actOf(structure, 104)?.name).toBe("Act II");
  });
});

describe("half-placed structure stays total", () => {
  test("scenes before the first act belong to no act", () => {
    const structure = deriveStructure(scenes, [act(1, "Act II", 105)], []);
    expect(structure.unassignedSceneIds).toEqual(
      [100, 101, 102, 103, 104]);
    expect(actOf(structure, 100)).toBe(null);
  });

  test("an act with no boundary produces no span", () => {
    const rows = [act(1, "Act I", 100),
      { id: 2, name: "Act II", act_number: 2, start_scene_id: null } as Row];
    const structure = deriveStructure(scenes, rows, []);
    expect(structure.acts.map((a) => a.name)).toEqual(["Act I"]);
    expect(structureFindings(structure, rows, []).map((f) => f.code))
      .toContain("no-boundary");
  });

  test("a boundary pointing at a deleted scene is reported", () => {
    const rows = [act(1, "Act I", 100), act(2, "Ghost", 999)];
    const structure = deriveStructure(scenes, rows, []);
    expect(structure.acts).toHaveLength(1);
    expect(structureFindings(structure, rows, []).map((f) => f.code))
      .toContain("dangling-boundary");
  });

  test("no acts at all means no assignment, and no complaint", () => {
    const structure = deriveStructure(scenes, [], []);
    expect(structure.unassignedSceneIds).toHaveLength(10);
    expect(structureFindings(structure, [], [])).toEqual([]);
  });
});

describe("findings", () => {
  test("two acts on one scene leave one of them empty", () => {
    const rows = [act(1, "Act I", 100), act(2, "Act I bis", 100)];
    const structure = deriveStructure(scenes, rows, []);
    expect(structure.acts[0]!.sceneIds).toEqual([]);
    expect(structureFindings(structure, rows, []).map((f) => f.code))
      .toContain("shared-boundary");
  });

  test("a sequence whose span crosses an act boundary is reported", () => {
    // REWRITTEN IN 0.44. This asserted something else entirely: that a
    // stored `act_id` disagreeing with the act derived for the
    // sequence's FIRST scene was reported. That is not what the catalog
    // declares ("Sequence crosses an act boundary"), and comparing on
    // the start is the very thing §5.3 calls incorrect.
    //
    // The old check never fired on the conformance fixture even though
    // the fixture contains a crossing, because the crossing sequence's
    // start does agree with its stored act. A reader deriving span
    // membership per §5.1 found it; this repository's own test suite
    // had been asserting the wrong property for four revisions.
    const acts = [act(1, "Act I", 100), act(2, "Act II", 105)];
    const seqs = [seq(10, "The Siege", 103, 1)];   // starts in I, runs into II
    const structure = deriveStructure(scenes, acts, seqs);
    const finding = structureFindings(structure, acts, seqs)
      .find((f) => f.code === "act-mismatch");
    expect(finding).toBeDefined();
    expect(finding!.level, "§5.3 says a crossing is legal").toBe("info");
    expect(finding!.message).toContain("Act I");
    expect(finding!.message).toContain("Act II");
  });

  test("a sequence contained in one act is silent", () => {
    const acts = [act(1, "Act I", 100), act(2, "Act II", 105)];
    const seqs = [seq(10, "The Siege", 106, 2)];
    const structure = deriveStructure(scenes, acts, seqs);
    expect(structureFindings(structure, acts, seqs)
      .map((f) => f.code)).not.toContain("act-mismatch");
  });

  test("a stored act_id that disagrees with the span is NOT this finding",
       () => {
    // Deliberate. `act_id` is authored and membership is derived, and
    // §5.3 says the two are independent rather than a hierarchy — so a
    // sequence filed under one act and sitting wholly inside another is
    // not a crossing and this code does not claim it is.
    const acts = [act(1, "Act I", 100), act(2, "Act II", 105)];
    const seqs = [seq(10, "The Siege", 106, 1)];   // filed under I, sits in II
    const structure = deriveStructure(scenes, acts, seqs);
    expect(structureFindings(structure, acts, seqs)
      .map((f) => f.code)).not.toContain("act-mismatch");
  });

  test("a boundary on an unnumbered scene is flagged, not hidden", () => {
    const mixed = [...scenes,
      { id: 300, scene_number: null, name: "INT. LATE" } as Row];
    const rows = [act(1, "Act I", 100), act(2, "Coda", 300)];
    const structure = deriveStructure(mixed, rows, []);
    expect(structure.acts[1]!.startIndex).toBe(10);
    expect(structureFindings(structure, rows, []).map((f) => f.code))
      .toContain("unnumbered-boundary");
  });

  test("scenes before the first act are noted once, as info", () => {
    const rows = [act(1, "Act II", 103)];
    const structure = deriveStructure(scenes, rows, []);
    const found = structureFindings(structure, rows, [])
      .filter((f) => f.code === "scenes-before-first-act");
    expect(found).toHaveLength(1);
    expect(found[0]!.level).toBe("info");
  });
});

describe("acts and sequences are independent spans, not a hierarchy", () => {
  // Act I is scenes 0-4, Act II is 5-9. The sequence starts inside Act I
  // and runs into Act II — legal, and deliberately unrestricted.
  const structure = deriveStructure(scenes,
    [act(1, "Act I", 100), act(2, "Act II", 105)],
    [seq(10, "Crossing", 103)]);
  const groups = actOutline(structure, structure.acts[0]!);

  test("an act's scenes are grouped into runs of sequence", () => {
    expect(groups.map((g) => [g.sequence?.name ?? null, g.sceneIds]))
      .toEqual([[null, [100, 101, 102]], ["Crossing", [103, 104]]]);
  });

  test("a crossing sequence appears in both acts, not once in the "
       + "wrong one", () => {
    // The bug this replaces drew 105-109 under Act I as well as Act II.
    const second = actOutline(structure, structure.acts[1]!);
    expect(second.map((g) => [g.sequence?.name ?? null, g.sceneIds]))
      .toEqual([["Crossing", [105, 106, 107, 108, 109]]]);
  });

  test("each part says which way it runs on", () => {
    expect(groups[1]!.continuesFrom).toBe(false);
    expect(groups[1]!.continuesInto).toBe(true);
    const second = actOutline(structure, structure.acts[1]!)[0]!;
    expect(second.continuesFrom).toBe(true);
    expect(second.continuesInto).toBe(false);
  });

  test("every scene in an act appears exactly once", () => {
    for (const a of structure.acts) {
      const seen = actOutline(structure, a).flatMap((g) => g.sceneIds);
      expect(seen).toEqual(a.sceneIds);
    }
  });
});

/**
 * Story order comes from the SCRIPT when one exists.
 *
 * Relying on scene_number-then-id alone was actively wrong twice over:
 * a blank-written project numbers nothing, so order collapsed to
 * INSERTION order and a scene added mid-act sorted to the end of the
 * film; and moving a scene changed the script while every derived view
 * kept the old order, because nothing it read had moved.
 */
describe("scene order from the screenplay", () => {
  const scenes = [
    { id: 1, name: "KITCHEN", scene_number: null },
    { id: 2, name: "MOON BASE", scene_number: null },
    { id: 3, name: "RIDGE", scene_number: null },
  ];

  test("with no hint, unnumbered scenes fall back to insertion order", () => {
    expect(scenePositions(scenes).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  test("the script's order wins over ids", () => {
    // Scene 2 dragged to the end: only the headings moved.
    const hint = sceneOrderHint([
      { scene_id: 1, line_order: 0 },
      { scene_id: 3, line_order: 20 },
      { scene_id: 2, line_order: 40 },
    ]);
    expect(scenePositions(scenes, hint).map((s) => s.id))
      .toEqual([1, 3, 2]);
  });

  test("the script's order wins over stale stored numbers too", () => {
    const numbered = [
      { id: 1, name: "KITCHEN", scene_number: 1 },
      { id: 2, name: "MOON BASE", scene_number: 2 },
      { id: 3, name: "RIDGE", scene_number: 3 },
    ];
    const hint = sceneOrderHint([
      { scene_id: 3, line_order: 0 },
      { scene_id: 1, line_order: 10 },
      { scene_id: 2, line_order: 20 },
    ]);
    expect(scenePositions(numbered, hint).map((s) => s.id))
      .toEqual([3, 1, 2]);
  });

  test("an unwritten scene sorts after everything the script places", () => {
    const hint = sceneOrderHint([{ scene_id: 3, line_order: 0 }]);
    const order = scenePositions(scenes, hint);
    expect(order[0]!.id).toBe(3);
    expect(order.slice(1).map((s) => s.id)).toEqual([1, 2]);
  });

  test("acts follow the script order, so a moved scene changes act", () => {
    const hint = sceneOrderHint([
      { scene_id: 3, line_order: 0 },
      { scene_id: 1, line_order: 10 },
      { scene_id: 2, line_order: 20 },
    ]);
    const acts = [{ id: 10, name: "One", act_number: 1, start_scene_id: 3 },
                  { id: 11, name: "Two", act_number: 2, start_scene_id: 1 }];
    const structure = deriveStructure(scenes, acts, [], hint);
    expect(structure.actOfScene.get(3)).toBe(10);
    expect(structure.actOfScene.get(1)).toBe(11);
    expect(structure.actOfScene.get(2)).toBe(11);
  });

  test("sceneOrderHint takes the first heading per scene", () => {
    // Commit enforces one scene per heading, but a half-committed
    // document can briefly show two.
    const hint = sceneOrderHint([
      { scene_id: 1, line_order: 0 },
      { scene_id: 1, line_order: 30 },
      { scene_id: 2, line_order: 10 },
    ]);
    expect(hint.get(1)).toBe(0);
    expect(hint.get(2)).toBe(1);
  });

  test("headings with no scene link are skipped, not counted", () => {
    const hint = sceneOrderHint([
      { scene_id: null, line_order: 0 },
      { scene_id: 2, line_order: 10 },
    ]);
    expect(hint.get(2)).toBe(0);
  });
});

describe("orphanedScenes", () => {
  const scenes = [{ id: 1 }, { id: 2 }, { id: 3 }];

  test("names the scenes the script does not contain", () => {
    const hint = sceneOrderHint([
      { scene_id: 1, line_order: 0 },
      { scene_id: 3, line_order: 10 },
    ]);
    expect(orphanedScenes(scenes, hint)).toEqual([2]);
  });

  test("a project with no screenplay reports nothing", () => {
    // Every scene would be 'not in the script', which is noise, not a
    // finding — an outline is not a broken screenplay.
    expect(orphanedScenes(scenes, new Map())).toEqual([]);
  });

  test("the finding is info, and says the record survives", () => {
    const hint = sceneOrderHint([{ scene_id: 1, line_order: 0 }]);
    const structure = deriveStructure(
      [{ id: 1, name: "KITCHEN" }, { id: 2, name: "RIDGE" }], [], [], hint);
    const findings = structureFindings(structure, [], [], hint);
    const orphan = findings.filter((f) => f.code === "not-in-script");
    expect(orphan).toHaveLength(1);
    expect(orphan[0]!.level).toBe("info");
    expect(orphan[0]!.rowId).toBe(2);
    expect(orphan[0]!.message).toContain("untouched");
  });

  test("no hint means no orphan findings at all", () => {
    const structure = deriveStructure(
      [{ id: 1, name: "KITCHEN" }, { id: 2, name: "RIDGE" }], [], []);
    expect(structureFindings(structure, [], [])
      .filter((f) => f.code === "not-in-script")).toHaveLength(0);
  });
});

/**
 * storyOrder is the general form of SCENE_ORDER_*: anything holding a
 * scene reference — an act's start scene, a beat's scene — goes in story
 * order the same way, so no view invents its own.
 */
describe("storyOrder", () => {
  test("script position first, then the given fallbacks, then id", () => {
    const { orderBy } = storyOrder({
      alias: "t", sceneRef: "start_scene_id",
      fallbacks: ["t.act_number"],
    });
    expect(orderBy).toBe(
      "ORDER BY (sp.story_pos IS NULL), sp.story_pos, " +
      "(t.act_number IS NULL), t.act_number, t.id");
  });

  test("joins through the alias's scene reference", () => {
    const { join } = storyOrder({ alias: "t", sceneRef: "scene_id" });
    expect(join).toContain("sp.scene_id = t.scene_id");
    expect(join).toContain("line_type = 'heading'");
  });

  test("with no fallbacks it still breaks ties on id", () => {
    expect(storyOrder({ alias: "x", sceneRef: "id" }).orderBy)
      .toBe("ORDER BY (sp.story_pos IS NULL), sp.story_pos, x.id");
  });

  test("agrees with the scene constants it generalizes", () => {
    const { join, orderBy } = storyOrder({
      alias: "s", sceneRef: "id", bySceneNumber: true,
    });
    expect(join).toBe(SCENE_ORDER_JOIN);
    expect(orderBy).toBe(SCENE_ORDER_BY);
  });
});
