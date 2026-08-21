#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
generate_registry_json.py — emit registry.json for scf-core.

The second-implementation design (docs/design/20260715_SCF_Second_Implementation.md)
makes Python the registry's source of truth and registry.json a checked-in
build artifact the TypeScript implementation consumes. The TS app never
hand-defines an entity; everything it knows about the format's shape comes
from this file.

Emitted per entity: every EntityDef attribute including the Phase A ontology
(subject, scope, paired, refines, queries, position_pattern) and the full
field list with effective SQL types. Framework columns (id, uuid,
created_at, updated_at) are implicit on every table and documented once at
the top level rather than repeated per entity.

Determinism: entities in registration order, fields in declaration order,
sorted JSON is NOT used (order is meaningful and diffs must be readable).

Usage:
    python scripts/generate_registry_json.py [output_path]
    (default output: <repo>/scf-core/registry/registry.json)

CI contract: regenerate and diff; a dirty diff fails the build
(design doc, Risks: "registry.json staleness").
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCHEMA_DIR.parent
sys.path.insert(0, str(SCHEMA_DIR))

from entity_registry import ENTITY_REGISTRY, FieldDef  # noqa: E402
from schema_meta import (  # noqa: E402
    OWNED_TABLES, SCHEMA_VERSION, UUID_EXTRA_TABLES,
)

GENERATOR_VERSION = "1.0.0"


def field_to_json(f: FieldDef) -> dict:
    out = {
        "name": f.name,
        "label": f.label,
        "fieldType": f.field_type,
        "sqlType": f.get_sql_type(),
        "required": f.required,
        "tab": f.tab,
        "autoInjected": f.auto_injected,
    }
    # Optional attributes: emitted only when meaningful, keeping the file
    # (and its diffs) small.
    if f.default is not None:
        out["default"] = f.default
    if f.placeholder:
        out["placeholder"] = f.placeholder
    if f.options:
        out["options"] = list(f.options)
    if f.reference_entity:
        out["referenceEntity"] = f.reference_entity
    if f.help_text:
        out["helpText"] = f.help_text
    if f.hidden:
        out["hidden"] = True
    return out


def entity_to_json(e) -> dict:
    return {
        "name": e.name,
        "label": e.label,
        "labelPlural": e.label_plural,
        "icon": e.icon,
        "nameField": e.name_field,
        "category": e.category,
        "description": e.description,
        "sortOrder": e.sort_order,
        "tier": e.tier,
        "parentEntity": e.parent_entity,
        "parentField": e.parent_field,
        "versionable": e.versionable,
        "hasLifecycleStatus": e.has_lifecycle_status,
        "hasExternalId": e.has_external_id,
        # Phase A ontology
        "subject": e.subject,
        "scope": e.scope,
        "paired": e.paired,
        "positionPattern": e.position_pattern,
        "refines": list(e.refines),
        "queries": list(e.queries),
        "fields": [field_to_json(f) for f in e.fields],
    }


def build() -> dict:
    return {
        "$comment": "GENERATED FILE — do not hand-edit. Source of truth: "
                    "schema/entity_registry.py. Regenerate with "
                    "scripts/generate_registry_json.py.",
        "schemaVersion": SCHEMA_VERSION,
        "generatorVersion": GENERATOR_VERSION,
        "frameworkColumns": [
            {"name": "id", "sqlType": "INTEGER PRIMARY KEY AUTOINCREMENT"},
            {"name": "uuid", "sqlType": "TEXT",
             "$comment": "cross-file row identity (schema 2.3); unique "
                         "index; stamped on insert"},
            {"name": "created_at", "sqlType": "TEXT",
             "default": "(datetime('now'))"},
            {"name": "updated_at", "sqlType": "TEXT",
             "default": "(datetime('now'))"},
        ],
        "uuidExtraTables": list(UUID_EXTRA_TABLES),
        "ownedTables": list(OWNED_TABLES),
        "entityCount": len(ENTITY_REGISTRY),
        "entities": [entity_to_json(e) for e in ENTITY_REGISTRY.values()],
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--check"]
    check = "--check" in sys.argv[1:]
    out_path = (Path(args[0]) if args
                else REPO_ROOT / "scf-core" / "registry"
                / "registry.json")
    payload = build()
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if check:
        # CI mode: a stale checked-in registry.json fails the build
        # (design doc, Risks: "registry.json staleness").
        current = (out_path.read_text(encoding="utf-8")
                   if out_path.exists() else "")
        if current != rendered:
            print(f"[registry.json] STALE: {out_path} does not match the "
                  f"registry. Regenerate with "
                  f"scripts/generate_registry_json.py and commit.")
            return 1
        print(f"[registry.json] up to date ({payload['entityCount']} "
              f"entities, schema {payload['schemaVersion']}).")
        return 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(rendered, encoding="utf-8")
    print(f"[registry.json] {payload['entityCount']} entities, "
          f"schema {payload['schemaVersion']} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
