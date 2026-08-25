#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
verify.py — run everything CI runs, locally, in one command.

    python3 tools/verify.py              # everything
    python3 tools/verify.py --fast       # skip the slow packaging test
    python3 tools/verify.py --list       # show the steps and exit

WHY THIS EXISTS.

`.github/workflows/ci.yml` is the definition of "does this repository
hold together", and running it before pushing meant assembling a chain
of twenty-odd commands by hand. That is error-prone in a specific and
nasty way: a chain like

    npm run pack-test 2>&1 | tail -1 && npm test

reports the exit code of `tail`, not of `pack-test`. A failing step
scrolls past as one quiet line and the chain carries on. That is exactly
how 0.42 shipped with `pack-test` broken — the fixture gained a
deliberate `info` finding, four test files were updated for it, this
script was not, and the pre-push check said nothing because its failure
had been piped into silence.

So: one command, one exit code, no pipes. A step that fails stops the
run and prints what it printed.

WHAT IT IS NOT.

It is not a second description of CI. It runs the same commands, and
where it drifts from `ci.yml` the workflow is right — that is what
actually gates a merge. Keeping them in step is a manual job and this
docstring is the only thing saying so, which is a weakness worth
naming rather than hiding.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
NPM = "npm.cmd" if sys.platform == "win32" else "npm"
PY = sys.executable

#: (label, argv, cwd, slow)
STEPS: list[tuple[str, list[str], str, bool]] = [
    # --- artifacts: everything generated still matches its source ---
    ("registry.json matches entity_registry.py",
     [PY, "schema/generate_registry_json.py", "--check"], ".", False),
    ("the registry ontology is clean",
     [PY, "schema/lint_registry.py"], ".", False),
    ("every entity.column in the prose resolves",
     [PY, "schema/check_spec_references.py"], ".", False),
    ("every source file carries an SPDX header",
     [PY, "tools/add_spdx_headers.py", "--check"], ".", False),
    ("scf-schema.sql matches initDatabase",
     [NPM, "run", "check-schema-sql"], "scf-core", False),
    ("screenplay-tables.json matches LINE_TYPES",
     [NPM, "run", "check-screenplay-tables"], "scf-core", False),
    ("api-surface.json matches the entry points",
     [NPM, "run", "check-api-surface"], "scf-core", False),
    ("selectors.json matches the published parameters",
     [NPM, "run", "check-selectors"], "scf-core", False),
    ("entity-reference.md matches the registry",
     [NPM, "run", "check-entity-reference"], "scf-core", False),
    ("query-reference.md matches §12",
     [NPM, "run", "check-query-reference"], "scf-core", False),
    ("finding-catalog.json matches findings.ts",
     [NPM, "run", "check-finding-catalog"], "scf-core", False),
    ("junction-keys and readiness-rubrics match",
     [NPM, "run", "check-normative-data"], "scf-core", False),
    ("the negative reports are blessed",
     [NPM, "run", "check-negative"], "scf-core", False),
    ("the fixture rebuilds from its source",
     [PY, "fixtures/build/build_fixture.py", "--check"], ".", False),
    ("the manifest is up to date",
     [PY, "schema/artifact_manifest.py", "--check"], ".", False),

    # --- core ---
    ("scf-core typechecks", [NPM, "run", "typecheck"], "scf-core", False),
    ("scf-core tests", [NPM, "test"], "scf-core", False),
    ("scf-check reads the fixture",
     [NPM, "run", "scf-check", "--", "../fixtures/hollow_creek.scf"],
     "scf-core", False),
    ("a consumer can install, import, compile and run",
     [NPM, "run", "pack-test"], "scf-core", True),

    # --- app ---
    ("scf-app typechecks", [NPM, "run", "typecheck"], "scf-app", False),
    ("scf-app tests", [NPM, "test"], "scf-app", False),
    ("scf-app builds", [NPM, "run", "build"], "scf-app", True),

    # --- site ---
    ("the docs site builds and its cross-references resolve",
     [NPM, "run", "check"], "site", False),
]


def checksums() -> tuple[bool, str]:
    """`sha256sum -c` where it exists, in Python where it does not."""
    import hashlib
    sums = ROOT / "spec" / "SHA256SUMS"
    bad = []
    for line in sums.read_text(encoding="utf-8").splitlines():
        digest, _, rel = line.partition("  ")
        rel = rel.strip()
        if not rel:
            continue
        path = ROOT / rel
        if not path.exists():
            bad.append(f"{rel}: missing")
            continue
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        if got != digest:
            bad.append(f"{rel}: digest differs")
    if bad:
        return False, "\n".join(bad[:10])
    return True, f"all {len(sums.read_text(encoding='utf-8').splitlines())} verify"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true",
                    help="skip the slow steps (packaging, app build)")
    ap.add_argument("--list", action="store_true",
                    help="print the steps and exit")
    args = ap.parse_args()

    steps = [s for s in STEPS if not (args.fast and s[3])]
    if args.list:
        for i, (label, argv, cwd, slow) in enumerate(steps, 1):
            print(f"{i:>2}. {label}{'  (slow)' if slow else ''}")
            print(f"    {' '.join(argv)}   [{cwd}]")
        return 0

    if shutil.which(NPM) is None:
        print(f"error: {NPM} is not on PATH", file=sys.stderr)
        return 2

    failures = []
    started = time.monotonic()

    for i, (label, argv, cwd, _slow) in enumerate(steps, 1):
        print(f"[{i:>2}/{len(steps)}] {label} … ", end="", flush=True)
        began = time.monotonic()
        # No pipes, no shell. The exit code is the step's own.
        done = subprocess.run(argv, cwd=ROOT / cwd, capture_output=True,
                              text=True)
        took = time.monotonic() - began
        if done.returncode == 0:
            print(f"ok ({took:.0f}s)")
        else:
            print(f"FAILED ({took:.0f}s)")
            failures.append((label, done))

    print(f"[{len(steps) + 1:>2}/{len(steps) + 1}] published checksums … ",
          end="", flush=True)
    ok, detail = checksums()
    print("ok" if ok else "FAILED")
    if not ok:
        failures.append(("published checksums",
                         subprocess.CompletedProcess([], 1, "", detail)))

    elapsed = time.monotonic() - started
    print()
    if not failures:
        print(f"verify: everything passes ({elapsed:.0f}s).")
        if args.fast:
            print("        --fast skipped the packaging test and the app "
                  "build; CI runs both.")
        return 0

    for label, done in failures:
        print(f"───── {label} " + "─" * max(0, 60 - len(label)))
        out = (done.stdout or "") + (done.stderr or "")
        print(out.strip() or "(no output)")
        print()
    print(f"verify: {len(failures)} step(s) failed ({elapsed:.0f}s).")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
