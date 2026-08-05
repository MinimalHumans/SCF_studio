#!/usr/bin/env python3
"""
lint_registry.py — enforce Phase A registry invariants.

Checks (see entity_registry.lint_ontology):
  - every entity is classified with subject + scope (valid enum members)
  - no stale classifications for removed entities
  - every entity serves at least one canonical query (the Rule)
  - all refines targets exist

Exit 0 = clean. Intended for pre-commit / CI. The doc generator runs the
same lint and refuses to generate from a dirty registry.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from entity_registry import ENTITY_REGISTRY, lint_ontology  # noqa: E402


def main() -> int:
    problems = lint_ontology()
    if problems:
        for p in problems:
            print(f"LINT: {p}")
        print(f"\n{len(problems)} problem(s) across {len(ENTITY_REGISTRY)} entities.")
        return 1
    n_refines = sum(1 for e in ENTITY_REGISTRY.values() if e.refines)
    print(f"registry ontology clean: {len(ENTITY_REGISTRY)} entities classified, "
          f"{n_refines} declare direction-cascade parents, all serve queries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
