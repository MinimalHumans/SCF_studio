# schema/

The source of truth for the SCF format.

| File | What it is |
|---|---|
| `entity_registry.py` | Every entity and field, declared once. **Edit this** to change the format. |
| `schema_meta.py` | `SCHEMA_VERSION` and the non-registry tables that carry row identity. |
| `generate_registry_json.py` | Emits `scf-core/registry/registry.json`, the artifact every consumer reads. |
| `lint_registry.py` | Registry invariants: every entity classified, every entity serving a canonical query, all cascade parents resolvable. |

```sh
python schema/generate_registry_json.py          # regenerate
python schema/generate_registry_json.py --check  # fail if stale (CI)
python schema/lint_registry.py                   # invariants
```

`registry.json` is a generated artifact and must never be hand-edited —
the next regeneration would silently discard the edit.

Python remains the authoring surface because a declarative `FieldDef`
list is a good way to write a hundred entities, not because anything
downstream depends on Python. The v1 editor these files came from is
retired; nothing here imports it.

Changing the format: see `docs/conventions.md` §8.
