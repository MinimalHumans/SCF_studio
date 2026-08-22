#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
build_fixture.py — build the Hollow Creek fixture from nothing.

    python fixtures/build/build_fixture.py                 # write it
    python fixtures/build/build_fixture.py --check         # verify only
    python fixtures/build/build_fixture.py --out /tmp/x.scf

Three inputs, no existing fixture required:

    spec/scf-schema.sql          the published DDL — the same artifact
                                 a third party gets, generated from
                                 initDatabase() and checksummed
    hollow_creek.data.json       the authored entity content
    hollow_creek.fountain        the screenplay, via screenplay_body.py

WHAT CHANGED, AND WHY IT MATTERS.

The old chain — `01_people_and_world` through `04_screenplay_body` — ran
ADDITIVELY over an existing fixture and could not produce one. Script 01
began by looking up scene 12 and characters by name, so against an empty
database it failed on its first statement. The file's origin was lost,
which meant checklist §10's reproducible build was unreachable and, more
immediately, that **nobody could review a change to a conformance
artifact**: a pull request touching the fixture showed one line saying a
binary file differed.

Those scripts are kept, unrun, in `history/`. They are the record of how
the fixture came to say what it says, and several of their comments
explain choices this file would otherwise have to rediscover — scene 12
is pinned, some gaps in it are deliberate, name anchors are load-bearing.

REPRODUCIBLE MEANS CONTENT, NOT BYTES.

Two SQLite files with identical content can differ byte for byte: page
allocation, freelist state and vacuum history are not part of what the
file says. So `--check` compares CONTENT — every table, every row, every
column — and reports the first divergence. That is the same comparison
`conformance.md` §3 uses for round-trip integrity, and for the same
reason.

The checked-in `.scf` remains the artifact: it is what the suites open
and what `SHA256SUMS` covers. This script is how it is produced and how
a change to it is reviewed.
"""

import argparse
import json
import pathlib
import sqlite3
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SCHEMA = ROOT / "spec" / "scf-schema.sql"
DATA = HERE / "hollow_creek.data.json"
BODY = HERE / "screenplay_body.py"
FIXTURE = ROOT / "fixtures" / "hollow_creek.scf"
DEMO = ROOT / "scf-app" / "public" / "hollow_creek.scf"

APPLICATION_ID = 1396917809      # 'SCF1', spec §1.2


def user_version(schema_version: str) -> int:
    """major*1000 + minor, matching encodeUserVersion in fileIdentity.ts."""
    major, _, minor = schema_version.partition(".")
    return int(major) * 1000 + int(minor)


def build(out: pathlib.Path) -> None:
    if out.exists():
        out.unlink()
    payload = json.loads(DATA.read_text(encoding="utf-8"))

    db = sqlite3.connect(out)
    db.executescript(SCHEMA.read_text(encoding="utf-8"))

    # Off during the load: the JSON is ordered by table name, not by
    # dependency, and a fixture that deliberately contains dangling
    # references (spec §9.2 — a reader must answer anyway) could not be
    # built with them on.
    db.execute("PRAGMA foreign_keys = OFF")

    for table, rows in payload["tables"].items():
        for row in rows:
            cols = ", ".join(f'"{k}"' for k in row)
            marks = ", ".join("?" for _ in row)
            db.execute(f'INSERT INTO "{table}" ({cols}) VALUES ({marks})',
                       list(row.values()))

    db.execute(f"PRAGMA application_id = {APPLICATION_ID}")
    db.execute(f"PRAGMA user_version = "
               f"{user_version(payload['schemaVersion'])}")
    db.commit()
    db.close()

    # The screenplay is generated rather than dumped: parsing Fountain
    # here would be a second implementation of scf-core's tokenizer, free
    # to drift from it. One source, two outputs.
    result = subprocess.run([sys.executable, str(BODY), str(out)],
                            capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"screenplay_body.py failed on {out}")


def content(path: pathlib.Path) -> dict:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    out = {}
    for (table,) in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        if table == "sqlite_sequence":
            continue
        cols = [c["name"] for c in db.execute(f'PRAGMA table_info("{table}")')]
        order = "id" if "id" in cols else cols[0]
        out[table] = [
            {k: r[k] for k in cols}
            for r in db.execute(f'SELECT * FROM "{table}" ORDER BY "{order}"')]
    db.close()
    return out


def first_divergence(want: dict, got: dict) -> str | None:
    for table in sorted(set(want) | set(got)):
        a, b = want.get(table), got.get(table)
        if a is None:
            return f"{table}: absent from the checked-in fixture"
        if b is None:
            return f"{table}: absent from the rebuild"
        if len(a) != len(b):
            return f"{table}: {len(a)} rows checked in, {len(b)} rebuilt"
        for i, (ra, rb) in enumerate(zip(a, b)):
            for col in ra:
                if ra[col] != rb.get(col):
                    return (f"{table}[{i}].{col}: "
                            f"{ra[col]!r} checked in, {rb.get(col)!r} rebuilt")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="rebuild to a temp file and compare content only")
    ap.add_argument("--out", type=pathlib.Path,
                    help="write somewhere other than fixtures/")
    args = ap.parse_args()

    if args.check:
        tmp = ROOT / "fixtures" / ".rebuild.scf"
        try:
            build(tmp)
            if not FIXTURE.exists():
                print("[fixture] no checked-in fixture to compare against",
                      file=sys.stderr)
                return 1
            bad = first_divergence(content(FIXTURE), content(tmp))
        finally:
            tmp.unlink(missing_ok=True)
        if bad:
            print("[fixture] REBUILD DIVERGES from the checked-in fixture:",
                  file=sys.stderr)
            print(f"  {bad}", file=sys.stderr)
            print("\n  Either the source and the artifact have come apart, "
                  "or a change\n  was made to the .scf without dumping it. "
                  "To adopt the .scf as\n  source:  python "
                  "fixtures/build/dump_fixture.py", file=sys.stderr)
            return 1
        print("[fixture] rebuild matches the checked-in fixture "
              f"({sum(len(v) for v in content(FIXTURE).values())} rows).")
        return 0

    target = args.out or FIXTURE
    build(target)
    try:
        shown = target.relative_to(ROOT)
    except ValueError:
        shown = target
    print(f"[fixture] built {shown}")
    if args.out is None:
        DEMO.write_bytes(FIXTURE.read_bytes())
        print(f"[fixture] copied to {DEMO.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
