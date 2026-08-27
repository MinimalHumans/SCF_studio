# SPDX-License-Identifier: Apache-2.0
"""
check_pin.py — does the tag ARTIFACTS.md advertises actually resolve?

    python3 schema/check_pin.py            # warn on a missing tag
    python3 schema/check_pin.py --strict   # fail on one, for CI on main

`ARTIFACTS.md` gives every consumer a single canonical way to fetch a
normative artifact:

    https://raw.githubusercontent.com/.../schema-<VERSION>/<path>

and says, correctly, that `main` is a moving target and MUST NOT be used
to pin a version. That instruction is only worth following if the tag it
names is on the remote.

**Schema 2.13 shipped in spec 0.47 and was never tagged.** For every
revision since, the URL the manifest published for its own registry
returned 404 while `sha256sum -c` passed, `--check` passed, and all
twenty-four steps of `tools/verify.py` passed. Every one of those
verifies bytes on disk. Nothing verified the one instruction the
document gives to somebody who does not have the bytes.

Which is the same shape as §12.13's cascade leaf and as
`query-reference.md`'s empty tables: a check that confirms internal
consistency while the thing a stranger actually needs is broken. The
pattern is worth naming — **local agreement is not reachability** — and
this file is the check for it.

## Why it warns by default and fails only on main

A tag can only point at a commit that exists, so the commit that bumps
SCHEMA_VERSION is necessarily pushed before its tag. Failing on pull
requests would make every schema bump red for reasons the author cannot
fix on a branch, and a check that is red for unfixable reasons is a
check people learn to ignore.

So: on a branch it warns, on `main` it fails, and the failure names the
two commands that clear it. The window between merge and tag stays open
for as long as it takes to read the failure, instead of six weeks.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "schema"))

from schema_meta import SCHEMA_VERSION  # noqa: E402

# The one artifact the manifest quotes a full URL for, so it is the one
# worth checking the bytes of when the tag is available locally.
PINNED = "scf-core/registry/registry.json"


def git(*args: str) -> tuple[int, str]:
    done = subprocess.run(["git", *args], cwd=ROOT,
                          capture_output=True, text=True)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def digest_at(tag: str, rel: str) -> str | None:
    """The artifact's sha256 as of `tag`, or None if the tag is not local.

    A tag that exists but points at the wrong commit is worse than a
    missing one: the URL resolves and serves bytes that do not match
    `SHA256SUMS`, so a consumer verifies against a digest it fetched
    from somewhere else and concludes the artifact is corrupt.
    """
    code, out = git("cat-file", "-p", f"{tag}:{rel}")
    if code != 0:
        return None
    return hashlib.sha256(out.encode("utf-8")).hexdigest()


def expected_digest(rel: str) -> str | None:
    sums = ROOT / "spec" / "SHA256SUMS"
    for line in sums.read_text(encoding="utf-8").splitlines():
        digest, _, path = line.partition("  ")
        if path.strip() == rel:
            return digest
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on a missing tag (CI, on main)")
    args = ap.parse_args()

    tag = f"schema-{SCHEMA_VERSION}"

    code, out = git("ls-remote", "--tags", "origin", f"refs/tags/{tag}")
    if code != 0:
        # No remote, no network, or no credentials. Not a finding: this
        # runs inside `tools/verify.py`, which is expected to work on a
        # plane.
        print(f"[pin] {tag}: remote unreachable, skipped")
        return 0

    if out.strip() == "":
        print(f"[pin] {tag} IS NOT ON THE REMOTE.")
        print(f"      ARTIFACTS.md tells consumers to fetch")
        print(f"        .../{tag}/{PINNED}")
        print(f"      and that URL returns 404. Fix:")
        print(f"        git tag -a {tag} -m 'schema {SCHEMA_VERSION}'")
        print(f"        git push origin {tag}")
        return 1 if args.strict else 0

    local = digest_at(tag, PINNED)
    if local is None:
        print(f"[pin] {tag} is on the remote (not fetched locally, "
              f"contents unchecked)")
        return 0

    want = expected_digest(PINNED)
    if want is not None and local != want:
        print(f"[pin] {tag} RESOLVES BUT SERVES DIFFERENT BYTES.")
        print(f"      {PINNED} at {tag}: {local[:16]}…")
        print(f"      SHA256SUMS says:      {want[:16]}…")
        print(f"      The tag points at the wrong commit. A consumer "
              f"following ARTIFACTS.md will fetch this and conclude the "
              f"artifact is corrupt.")
        return 1

    print(f"[pin] {tag} resolves and matches SHA256SUMS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
