import { describe, expect, it } from "vitest";
import registryJson from "../../scf-core/registry/registry.json"
  with { type: "json" };
import { loadRegistry, type RegistryJson }
  from "../../scf-core/src/registry.ts";
import {
  isComposedLink, linkLabel, linkQualifiers, rowLabel, sceneLabel,
  sceneShort, type NameLookup,
} from "../src/state/displayName.ts";

const registry = loadRegistry(registryJson as unknown as RegistryJson);
const def = (name: string) => {
  const e = registry.entities.get(name);
  if (e === undefined) throw new Error(`no entity ${name}`);
  return e;
};

describe("sceneLabel", () => {
  it("leads with the number, because headings repeat", () => {
    expect(sceneLabel({ id: 3, scene_number: 12, name: "INT. KITCHEN" }))
      .toBe("sc 12 — INT. KITCHEN");
  });

  it("says so when a scene has no number", () => {
    expect(sceneLabel({ id: 3, scene_number: null, name: "INT. KITCHEN" }))
      .toBe("unnumbered — INT. KITCHEN");
    expect(sceneLabel({ id: 3, scene_number: null, name: null }))
      .toBe("scene #3");
  });

  it("does not call a scene unnumbered when the column was not fetched",
     () => {
    // The subject rail selected id and name only, so every scene in it
    // read "unnumbered — HEADING".
    expect(sceneLabel({ id: 3, name: "INT. KITCHEN" }))
      .toBe("INT. KITCHEN");
  });

  it("has a short form for tight spots", () => {
    expect(sceneShort({ id: 3, scene_number: 12, name: "INT. KITCHEN" }))
      .toBe("sc 12");
    expect(sceneShort({ id: 3, scene_number: null, name: "X" }))
      .toBe("unplaced");
  });
});

describe("isComposedLink", () => {
  it("holds for link entities whose name field is hidden", () => {
    // Twelve of 2.3's thirteen link entities; the rule is the schema's,
    // not a hand-maintained list.
    expect(isComposedLink(def("scene_character"))).toBe(true);
    expect(isComposedLink(def("scene_prop"))).toBe(true);
    expect(isComposedLink(def("motif_appearance"))).toBe(true);
  });

  it("does not hold for entities with a real name", () => {
    expect(isComposedLink(def("character"))).toBe(false);
    expect(isComposedLink(def("scene"))).toBe(false);
    // thematic_connection is a link, but its name field is not hidden.
    expect(isComposedLink(def("thematic_connection"))).toBe(false);
  });
});

describe("link labels", () => {
  const lookup: NameLookup = (entity, id) =>
    entity === "scene" && id === 7 ? "sc 1 — EXT. MONUMENT VALLEY"
      : entity === "character" && id === 4 ? "Alexis"
      : null;
  const row = {
    id: 99, name: "ALEXIS", scene_id: 7, character_id: 4,
    role_in_scene: "featured", notes: null,
  };

  it("names both ends when there is no anchor", () => {
    expect(linkLabel(def("scene_character"), row, lookup))
      .toBe("sc 1 — EXT. MONUMENT VALLEY · Alexis");
  });

  it("drops the end you are looking from", () => {
    expect(linkLabel(def("scene_character"), row, lookup, "character_id"))
      .toBe("sc 1 — EXT. MONUMENT VALLEY");
    expect(linkLabel(def("scene_character"), row, lookup, "scene_id"))
      .toBe("Alexis");
  });

  it("returns null while labels are still loading", () => {
    expect(linkLabel(def("scene_character"), row, () => null)).toBe(null);
  });

  it("carries the row's own selects as qualifiers", () => {
    expect(linkQualifiers(def("scene_character"), row))
      .toEqual(["featured"]);
    expect(linkQualifiers(def("scene_character"),
                          { ...row, role_in_scene: null })).toEqual([]);
  });

  it("never falls back to the hidden cue text", () => {
    // The whole bug: this column holds "ALEXIS" for every one of a
    // character's scene links.
    expect(rowLabel(def("scene_character"), "scene_character", row))
      .toBe("Scene-Character #99");
  });

  it("still uses a real name field when there is one", () => {
    expect(rowLabel(def("character"), "character",
                    { id: 4, name: "Alexis" })).toBe("Alexis");
  });
});
