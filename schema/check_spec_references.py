#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
check_spec_references.py — every `entity.column` in the prose resolves.

    python3 schema/check_spec_references.py

WHY THIS EXISTS.

Spec 0.29 added a table to §12.5 naming "the column the labels come
from" and gave it as `character_state.name`. There is no
`character_state` entity; it is `performance_state`. §12.8 named
`asset_bundle_item.role_in_bundle`; the entity is `bundle_asset`. Both
names were invented while writing the sentence, both were wrong, and
both survived four revisions and a reader run before a third party
implementing from the document found them.

Spec 0.38 made the readiness rubric's entity names checkable against
the registry and refused to publish an unknown one. That closed the
rubric and left the PROSE — which is where a reader actually looks
first — completely unchecked. This closes the rest.

WHAT COUNTS AS A REFERENCE.

An inline-code span of the form `word.word`, in a normative document.
That form is also used for filenames, for finding codes, and for report
members, so those are excluded from sources that are themselves
generated or published, never from a list maintained here:

  * finding codes come from `spec/finding-catalog.json`
  * screenplay and owned tables come from the registry
  * framework columns come from the registry

Two things are excluded by a list, and both are deliberate.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ["spec/scf-spec.md", "spec/conformance.md", "spec/stability.md"]

#: Suffixes that make `a.b` a filename rather than a reference.
EXTENSIONS = {
    "ts", "tsx", "mjs", "py", "json", "md", "sql", "magic", "txt",
    "yml", "yaml", "scf", "html", "css", "lock", "fountain", "fdx",
}

#: Report and result members that share the `a.b` shape.
#: Small, and each one is a member this specification defines itself.
MEMBERS = {"counts.error", "counts.warning", "counts.info", "area.condition"}

#: Columns that EXISTED and were REMOVED. A reference to one is history
#: — §11.0's note records what was taken out, and `stability.md` records
#: what was corrected — not a defect.
#:
#: Hand-maintained, which is usually the wrong answer here. The guard
#: below is what makes it acceptable: if any name in this set comes BACK
#: into the registry, the check fails, so the list cannot quietly rot
#: into describing something that exists.
REMOVED = {
    "project.scene_numbering",   # renamed in 2.11, removed in 2.12
    "asset.asset_type",          # removed in 2.8
    "asset.file_path",           # removed in 2.8
}


def main() -> int:
    registry = json.loads(
        (ROOT / "scf-core/registry/registry.json").read_text(encoding="utf-8"))
    entities = {e["name"]: {f["name"] for f in e["fields"]}
                for e in registry["entities"]}
    framework = {c["name"] for c in registry["frameworkColumns"]}
    extra = set(registry["uuidExtraTables"]) | set(registry["ownedTables"])
    codes = {c["code"] for c in json.loads(
        (ROOT / "spec/finding-catalog.json").read_text(encoding="utf-8"))["codes"]}

    # The guard on REMOVED.
    resurrected = [r for r in REMOVED
                   if r.split(".")[0] in entities
                   and r.split(".")[1] in entities[r.split(".")[0]]]
    if resurrected:
        print("[spec-refs] these are listed as REMOVED and are back in the "
              "registry:", file=sys.stderr)
        for r in resurrected:
            print(f"  {r} — take it out of REMOVED in this file",
                  file=sys.stderr)
        return 1

    bad: list[tuple[str, int, str, str]] = []
    for rel in DOCS:
        path = ROOT / rel
        for lineno, line in enumerate(
                path.read_text(encoding="utf-8").split("\n"), 1):
            for m in re.finditer(r"`([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)`",
                                 line):
                entity, column = m.group(1), m.group(2)
                ref = f"{entity}.{column}"
                if (column in EXTENSIONS or ref in codes or ref in MEMBERS
                        or ref in REMOVED or entity in extra):
                    continue
                if entity not in entities:
                    bad.append((rel, lineno, ref, "no such entity"))
                elif column not in entities[entity] and column not in framework:
                    bad.append((rel, lineno, ref,
                                f"{entity} has no column {column}"))

    if bad:
        print("[spec-refs] references in the specification that do not "
              "resolve:\n", file=sys.stderr)
        for rel, lineno, ref, why in bad:
            print(f"  {rel}:{lineno}  {ref}  — {why}", file=sys.stderr)
        print("\n  A name written into prose and never checked is a name "
              "a reader\n  will look up and not find. Fix the reference, or "
              "— if the column\n  was removed and this is a historical note "
              "— add it to REMOVED in\n  schema/check_spec_references.py with "
              "the version that removed it.", file=sys.stderr)
        return 1

    counted = sum(
        len(re.findall(r"`[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*`",
                       (ROOT / rel).read_text(encoding="utf-8")))
        for rel in DOCS)
    print(f"[spec-refs] {counted} qualified references across "
          f"{len(DOCS)} documents, all resolve.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
