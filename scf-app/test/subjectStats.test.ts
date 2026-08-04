import { describe, expect, it } from "vitest";
import registryJson from "../../scf-core/registry/registry.json"
  with { type: "json" };
import { loadRegistry, type RegistryJson }
  from "../../scf-core/src/registry.ts";
import {
  compareSubjects, NO_POSITION, subjectScenePaths, subjectStatsSql,
  type SubjectStat,
} from "../src/state/subjectStats.ts";

const registry = loadRegistry(registryJson as unknown as RegistryJson);
const paths = (subject: string): string[] =>
  subjectScenePaths(registry, subject);

describe("scene paths are derived, not listed", () => {
  it("finds the junction that ties a character to scenes", () => {
    expect(paths("character").some((p) => p.includes("scene_character")))
      .toBe(true);
  });

  it("finds a direct reference from scene itself", () => {
    // A location is not linked through a junction — scene points at it.
    expect(paths("location").some(
      (p) => p.includes("FROM scene sc") && p.includes("location_id")))
      .toBe(true);
  });

  it("counts a scene as its own position", () => {
    expect(paths("scene")[0]).toContain("s.id AS scene_id");
  });

  it("uses the subject's own scene_id when it has one", () => {
    expect(paths("shot").some((p) => p.includes("FROM \"shot\""))).toBe(true);
  });

  it("finds nothing for subjects that never reach a scene", () => {
    // Themes and projects have no story position, so the rail offers
    // only A–Z for them rather than a mode that silently does nothing.
    expect(paths("theme")).toEqual([]);
    expect(paths("project")).toEqual([]);
    expect(subjectStatsSql(registry, "theme")).toBe(null);
  });

  it("builds one statement, not one per path", () => {
    const sql = subjectStatsSql(registry, "scene");
    expect(sql).not.toBe(null);
    expect(sql!.split("UNION ALL").length)
      .toBe(paths("scene").length);
    expect(sql).toContain("GROUP BY sid");
  });
});

describe("rail ordering", () => {
  const stat = (uses: number, scenes: number, firstNumber: number,
                firstSceneId = 1): SubjectStat =>
    ({ uses, scenes, firstNumber, firstSceneId });

  const sorted = (mode: "name" | "story" | "uses",
                  items: Array<{ name: string; stat?: SubjectStat }>):
      string[] =>
    [...items].sort((a, b) => compareSubjects(mode, a, b))
      .map((x) => x.name);

  const cast = [
    { name: "Zoe", stat: stat(9, 7, 2) },
    { name: "Ada", stat: stat(2, 2, 12) },
    { name: "Mags", stat: stat(9, 3, 1) },
    { name: "Ghost" }, // never appears in a scene
  ];

  it("A–Z ignores the stats entirely", () => {
    expect(sorted("name", cast)).toEqual(["Ada", "Ghost", "Mags", "Zoe"]);
  });

  it("most used ranks by appearances, then by scene spread", () => {
    // Zoe and Mags tie on uses; Zoe is in more distinct scenes.
    expect(sorted("uses", cast)).toEqual(["Zoe", "Mags", "Ada", "Ghost"]);
  });

  it("first appearance is story order", () => {
    expect(sorted("story", cast)).toEqual(["Mags", "Zoe", "Ada", "Ghost"]);
  });

  it("a subject with nothing to rank on sorts last, not first", () => {
    for (const mode of ["story", "uses"] as const) {
      expect(sorted(mode, cast).at(-1)).toBe("Ghost");
    }
  });

  it("an unnumbered first appearance sorts after every numbered one", () => {
    const items = [
      { name: "Late", stat: stat(1, 1, NO_POSITION, 3) },
      { name: "Early", stat: stat(1, 1, 40) },
    ];
    expect(sorted("story", items)).toEqual(["Early", "Late"]);
  });

  it("equal ranks fall back to the name, so the list never jitters", () => {
    const items = [
      { name: "Beta", stat: stat(3, 3, 5) },
      { name: "Alpha", stat: stat(3, 3, 5) },
    ];
    expect(sorted("uses", items)).toEqual(["Alpha", "Beta"]);
    expect(sorted("story", items)).toEqual(["Alpha", "Beta"]);
  });
});
