#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
dump_fixture.py — the fixture, as reviewable source.

    python fixtures/build/dump_fixture.py

Writes `fixtures/build/hollow_creek.data.json` from
`fixtures/hollow_creek.scf`.

WHY THIS EXISTS.

Until 0.35 the fixture was a binary file whose origin was lost. Four
enrichment scripts ran over it, additively and non-idempotently, but
none of them could produce it from nothing: they assumed scenes,
characters and locations that no script created. Checklist §10's
"reproducible fixture build" could not be satisfied, and — worse for a
conformance artifact — nobody could review a change to it. A pull
request that altered the fixture showed one line: a binary file
differed.

The loop is now: author in `scf-app`, dump to JSON, review the JSON
diff, rebuild, commit both. `build_fixture.py` is the other half, and
CI checks that rebuilding reproduces what is checked in.

WHAT IS DUMPED.

Every row of every registry table, plus the screenplay tables and
`_scf_meta`, with columns in schema order and rows in row-id order.

Row ids ARE preserved. They are file-local (spec §6.2) and mean nothing
outside this file — but preserving them is what makes the rebuild
deterministic and the JSON diff legible, and this is a build input
rather than something interchanged. Uuids are preserved for the same
reason and are the identity that actually matters.

Timestamps are preserved verbatim. Regenerating them would make every
rebuild differ from the last for no reason anybody could review.

`sqlite_sequence` is skipped: SQLite maintains it, and inserting
explicit ids restores it exactly.

`screenplay_lines` and `screenplay_version_lines` are skipped: they are
generated from `hollow_creek.fountain` by `screenplay_body.py`, which is
the single source for the script text. Dumping them here would give one
fact two homes.
"""

import json
import pathlib
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FIXTURE = ROOT / "fixtures" / "hollow_creek.scf"
OUT = HERE / "hollow_creek.data.json"

SKIP = {
    "sqlite_sequence",       # SQLite's own; restored by explicit ids
    "screenplay_lines",      # generated from hollow_creek.fountain
    "screenplay_version_lines",
}


def dump(path: pathlib.Path) -> dict:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row

    tables = sorted(
        r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")
        if r[0] not in SKIP)

    data: dict[str, list] = {}
    total = 0
    for table in tables:
        cols = [c["name"] for c in db.execute(f'PRAGMA table_info("{table}")')]
        order = "id" if "id" in cols else cols[0]
        rows = []
        for row in db.execute(f'SELECT * FROM "{table}" ORDER BY "{order}"'):
            # Omit nulls: a null column and an absent one mean the same
            # thing on insert, and carrying every null would triple the
            # file and bury the content that matters in a review.
            rows.append({k: row[k] for k in cols if row[k] is not None})
        if rows:
            data[table] = rows
            total += len(rows)

    version = next(
        (r["value"] for r in db.execute(
            "SELECT key, value FROM _scf_meta WHERE key = 'schema_version'")),
        None)
    db.close()
    return {
        "$comment":
            "The Hollow Creek conformance fixture, as source. Authored in "
            "scf-app, dumped by fixtures/build/dump_fixture.py, rebuilt by "
            "build_fixture.py. Review changes HERE — the .scf beside it is "
            "a build output that happens to be checked in. Row ids and "
            "timestamps are preserved deliberately; see dump_fixture.py.",
        "schemaVersion": version,
        "tables": data,
        "rowCount": total,
    }


def main() -> int:
    if not FIXTURE.exists():
        print(f"missing fixture: {FIXTURE}", file=sys.stderr)
        return 1
    payload = dump(FIXTURE)
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    print(f"[dump-fixture] {payload['rowCount']} rows across "
          f"{len(payload['tables'])} tables -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
