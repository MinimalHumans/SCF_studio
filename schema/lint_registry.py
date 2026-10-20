#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
lint_registry.py — enforce Phase A registry invariants.

Checks (see entity_registry.lint_ontology):
  - every entity is classified with subject + scope (valid enum members)
  - no stale classifications for removed entities
  - every entity serves at least one canonical query (the Rule)
  - all refines targets exist

And one of its own, ownership by name (below).

Exit 0 = clean. Intended for pre-commit / CI. The doc generator runs the
same lint and refuses to generate from a dirty registry.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from entity_registry import ENTITY_REGISTRY, lint_ontology  # noqa: E402

# Spec §2.3 deletes a row with its scene because a column is NAMED
# `scene_id`, not because anything declared it. Until the registry's
# `parent_entity` carries that decision (proposal 0002, after 1.0), each
# entity the name rule deletes without a declared parent is recorded
# here, so that it was considered once, and so that a new `scene_id`
# cannot arrive without a decision. A row that should outlive its scene
# takes another name and only points at it — `clip.slated_scene_id`.
OWNED_BY_NAME = {"scene_id": "scene"}

DELIBERATE_SCENE_OWNERS = frozenset({
    "action_sequence", "character_arc_state", "color_script_entry",
    "costume_progression_state", "costume_scene", "dialogue_rhythm",
    "dialogue_sound_design", "emotional_beat", "identification_strategy",
    "information_strategy", "motif_appearance", "motif_state",
    "movement_choreography", "music_cue", "music_sound_relationship",
    "performance_beat", "performance_state", "prop_state",
    "relationship_state", "scene_blocking", "scene_character", "scene_prop",
    "scene_sequence", "set_dressing", "shot", "shot_language", "sound_cue",
    "sound_perspective", "story_beat", "subtext", "take_scene",
    "tone_marker", "voiceover_design",
})


def lint_ownership_by_name() -> list[str]:
    """Every `scene_id` on an entity with no declared parent is recorded."""
    problems: list[str] = []
    seen: set[str] = set()
    for name, entity in ENTITY_REGISTRY.items():
        if entity.parent_entity:
            continue
        for field in entity.fields:
            if field.name not in OWNED_BY_NAME:
                continue
            seen.add(name)
            if name not in DELIBERATE_SCENE_OWNERS:
                problems.append(
                    f"{name}.{field.name}: §2.3 deletes this row with its "
                    f"{OWNED_BY_NAME[field.name]} by name alone. Record it "
                    "in DELIBERATE_SCENE_OWNERS if it belongs to the scene, "
                    "or rename the column if it only points at it.")
    for name in sorted(DELIBERATE_SCENE_OWNERS - seen):
        problems.append(
            f"{name}: in DELIBERATE_SCENE_OWNERS but no longer owned by "
            "name; remove it from the list.")
    return problems


def lint_polymorphic_targets() -> list[str]:
    """A per-value target map is total over its sibling's options, and
    names only entities (spec §12.1.2)."""
    problems: list[str] = []
    for name, entity in ENTITY_REGISTRY.items():
        by_name = {f.name: f for f in entity.fields}
        for field in entity.fields:
            targets = field.polymorphic_targets
            if not targets:
                continue
            where = f"{name}.{field.name}"
            sibling = by_name.get(field.polymorphic_type or "")
            if sibling is None or not sibling.options:
                problems.append(f"{where}: polymorphicTargets needs a "
                                "closed sibling to key on.")
                continue
            if set(targets) != set(sibling.options):
                problems.append(f"{where}: polymorphicTargets covers "
                                f"{sorted(targets)}, its sibling allows "
                                f"{sorted(sibling.options)}.")
            for target in targets.values():
                if target not in ENTITY_REGISTRY:
                    problems.append(f"{where}: {target} is not an entity.")
    return problems


def main() -> int:
    problems = (lint_ontology() + lint_ownership_by_name()
                + lint_polymorphic_targets())
    if problems:
        for p in problems:
            print(f"LINT: {p}")
        print(f"\n{len(problems)} problem(s) across {len(ENTITY_REGISTRY)} entities.")
        return 1
    n_refines = sum(1 for e in ENTITY_REGISTRY.values() if e.refines)
    print(f"registry ontology clean: {len(ENTITY_REGISTRY)} entities classified, "
          f"{n_refines} declare direction-cascade parents, all serve queries; "
          f"{len(DELIBERATE_SCENE_OWNERS)} scene owners by name, each recorded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
