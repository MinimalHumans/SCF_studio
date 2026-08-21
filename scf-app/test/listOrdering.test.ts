// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadRegistry, type Registry, type RegistryJson }
  from "@scf-core/registry.ts";
import { isComposedLink } from "../src/state/displayName.ts";
import { sceneRefFor } from "../src/state/listOrder.ts";

const REGISTRY = fileURLToPath(new URL(
  "../../scf-core/registry/registry.json", import.meta.url));

let registry: Registry;
const load = async (): Promise<Registry> => {
  registry ??= loadRegistry(JSON.parse(
    await readFile(REGISTRY, "utf8")) as RegistryJson);
  return registry;
};
const def = async (name: string) => (await load()).entities.get(name)!;

/**
 * Which scene reference a row SITS at. Several rows hold more than one,
 * and picking the wrong one sorts the list by where things stop rather
 * than where they start.
 */
describe("sceneRefFor", () => {
  test("plain scene_id when there is one", async () => {
    expect(sceneRefFor(await def("scene_character"))).toBe("scene_id");
    expect(sceneRefFor(await def("shot"))).toBe("scene_id");
  });

  test("a range is placed at its START, never its end", async () => {
    for (const name of ["prop_asset_binding", "character_asset_binding",
                        "location_asset_binding"]) {
      expect(sceneRefFor(await def(name))).toBe("scene_range_start_id");
    }
  });

  test("a span is placed at the scene it opens on", async () => {
    expect(sceneRefFor(await def("act"))).toBe("start_scene_id");
    expect(sceneRefFor(await def("sequence"))).toBe("start_scene_id");
  });

  test("a secondary reference never wins over the primary", async () => {
    // performance_state holds both the scene it began in and the scene
    // it resolved in; it belongs where it began.
    expect(sceneRefFor(await def("performance_state"))).toBe("scene_id");
  });

  test("the only reference is used when it is the only one", async () => {
    expect(sceneRefFor(await def("motif")))
      .toBe("first_appearance_scene_id");
  });

  test("nothing for a row with no place in the film", async () => {
    expect(sceneRefFor(await def("character"))).toBeUndefined();
    expect(sceneRefFor(await def("actor_character_role"))).toBeUndefined();
    expect(sceneRefFor(await def("bundle_asset"))).toBeUndefined();
  });

  test("the preference is explicit, not field-order dependent", async () => {
    // Reordering the field list must not change where a row sorts.
    const binding = await def("prop_asset_binding");
    const reversed = { ...binding, fields: [...binding.fields].reverse() };
    expect(sceneRefFor(reversed)).toBe(sceneRefFor(binding));
  });
});

describe("which link entities get the story control", () => {
  test("every composed link is classified one way or the other",
       async () => {
    const reg = await load();
    const links = [...reg.entities.values()].filter(isComposedLink);
    const placed = links.filter((e) => sceneRefFor(e) !== undefined);
    // Half of them sit in a scene; the rest (an actor's role, a
    // bundle's contents) have no position in the film and are A-Z only.
    expect(links.length).toBeGreaterThan(0);
    expect(placed.map((e) => e.name).sort()).toEqual([
      "costume_scene", "motif_appearance", "scene_character",
      "scene_prop", "scene_sequence", "take_scene",
    ]);
  });

  test("a link with no scene reference offers no story order",
       async () => {
    expect(sceneRefFor(await def("clip_character"))).toBeUndefined();
    expect(sceneRefFor(await def("clip_prop"))).toBeUndefined();
  });
});
