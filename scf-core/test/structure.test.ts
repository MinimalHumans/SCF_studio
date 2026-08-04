import { describe, expect, test } from "vitest";
import type { Row } from "../src/db.ts";
import {
  actOf, deriveStructure, scenePositions, sequenceOf, structureFindings,
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
    const withInsert = [...scenes,
      { id: 200, scene_number: 5.5, name: "INT. NEW" } as Row];
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

  test("a stored act_id that disagrees with the boundary is reported", () => {
    // Two truths by design: act_id is authored, membership is derived.
    // The authored field wins and the disagreement is surfaced.
    const acts = [act(1, "Act I", 100), act(2, "Act II", 105)];
    const seqs = [seq(10, "The Siege", 106, 1)];
    const structure = deriveStructure(scenes, acts, seqs);
    const finding = structureFindings(structure, acts, seqs)
      .find((f) => f.code === "act-mismatch");
    expect(finding).toBeDefined();
    expect(finding!.message).toContain("Act II");
  });

  test("agreement is silent", () => {
    const acts = [act(1, "Act I", 100), act(2, "Act II", 105)];
    const seqs = [seq(10, "The Siege", 106, 2)];
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
