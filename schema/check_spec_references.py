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
#: Normative documents, plus the reader-facing ones that name entities
#: and columns. A glossary or an FAQ that names a column wrongly sends a
#: reader looking for something that is not there exactly as the
#: specification would, and it is read FIRST — so it is checked on the
#: same terms rather than trusted because it is informative.
DOCS = ["spec/scf-spec.md", "spec/conformance.md", "spec/stability.md",
        "docs/glossary.md", "docs/faq.md", "docs/what-is-scf.md",
        "docs/authoring-guide.md", "docs/walkthrough.md"]

#: Suffixes that make `a.b` a filename rather than a reference.
EXTENSIONS = {
    "ts", "tsx", "mjs", "py", "json", "md", "sql", "magic", "txt",
    "yml", "yaml", "scf", "html", "css", "lock", "fountain", "fdx",
}

#: Report and result members that share the `a.b` shape.
#: Small, and each one is a member this specification defines itself.
MEMBERS = {"counts.error", "counts.warning", "counts.info", "area.condition"}

#: Names that are not registry identifiers and legitimately appear in
#: backticks. Everything else on the legal side is DERIVED — entity
#: names, column names, option values, position patterns, framework
#: columns, screenplay columns, finding codes, and the `X_uuid` form of
#: every reference column.
NOT_REGISTRY_NAMES = {
    # SQLite's own, spec §1.2 and §5.4, plus the wa-sqlite export
    # entry point conformance.md §3.1 names.
    "user_version", "application_id", "sqlite_sequence",
    "sqlite3_js_db_export",
    # §1.3.1 names this deliberately, as the value that is NOT correct.
    "scene_heading",
}

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
    "scene_numbering",           #   ... and named bare in the same notes
    "asset.asset_type",          # removed in 2.8
    "asset_type",                #   ...
    "asset.file_path",           # removed in 2.8
    "file_path",                 #   ...
    # Never existed at all: §12.13's cascade leaf until 0.44, and the
    # reason this check learned to read bare names. The notes recording
    # that name it, which is correct and must not fail the check.
    "scene_emotional_design",
    # The check's own subject, written in prose about the check.
    "entity.column",
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

    # Every bare identifier a document may legitimately name.
    legal = set(entities) | framework | extra | codes | NOT_REGISTRY_NAMES
    for cols in entities.values():
        legal |= cols
    for entity in registry["entities"]:
        legal.add(entity["positionPattern"])
        for field in entity["fields"]:
            legal.update(str(o) for o in (field.get("options") or []))
            # §12.1.2 projects `scene_id` as `scene_uuid`.
            if field["name"].endswith("_id"):
                legal.add(field["name"][:-3] + "_uuid")
    screenplay = json.loads(
        (ROOT / "spec/screenplay-tables.json").read_text(encoding="utf-8"))
    for table in screenplay["tables"].values():
        legal.update(c["name"] for c in table["columns"])
    legal.update(v["value"] for v in screenplay["lineTypeColumn"]["values"])

    # A document in DOCS that is not on disk used to raise
    # FileNotFoundError and print a traceback, which tells a reader of
    # the CI log that the checker is broken rather than that a file is
    # missing. It is a real failure — a document listed here and absent
    # means either the list or the repository is wrong — so it fails,
    # but it says which.
    absent = [rel for rel in DOCS if not (ROOT / rel).exists()]
    if absent:
        print("[spec-refs] listed for checking and not in the repository:\n",
              file=sys.stderr)
        for rel in absent:
            print(f"  {rel}", file=sys.stderr)
        print("\n  Either the file was removed and DOCS in this script "
              "still lists it,\n  or a commit that should have added it did "
              "not. Both are worth\n  stopping for: a document nobody checks "
              "is how two entity names\n  that did not exist reached a "
              "reader.", file=sys.stderr)
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

            # BARE names too. `scene_emotional_design` was written into
            # §12.13 as the leaf of Q11's cascade, matched nothing in the
            # registry, and made that member `[]` for every file that
            # could ever exist — and the blessed artifact recorded the
            # empty array, so the test pinning it asserted the dead
            # answer was correct. The qualified check above could not see
            # it, because the name carries no column.
            for m in re.finditer(r"`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`", line):
                token = m.group(1)
                if token in legal or token in REMOVED:
                    continue
                bad.append((rel, lineno, token,
                            "not an entity, column, option or pattern"))

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
