# SPDX-License-Identifier: Apache-2.0
"""
check_pin.py — do the tags ARTIFACTS.md advertises actually resolve?

    python3 schema/check_pin.py            # warn on a missing tag
    python3 schema/check_pin.py --strict   # fail on one, for CI on main

`ARTIFACTS.md` gives every consumer a single canonical way to fetch a
normative artifact:

    https://raw.githubusercontent.com/.../<tag>/<path>

where the tag is `schema-<VERSION>` for the registry and what is
generated from it, and `spec-<VERSION>` for everything else
(`schema/artifact_manifest.py` says which file is which). It also says,
correctly, that `main` is a moving target and MUST NOT be used to pin a
version. That instruction is only worth following if each tag it names
is on the remote and serves, for EVERY file it addresses, the bytes
`SHA256SUMS` claims. A checksummed file that no tag addresses fails
outright: it can be verified and not fetched.

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
a version is necessarily pushed before its tag. Failing on pull
requests would make every schema bump red for reasons the author cannot
fix on a branch, and a check that is red for unfixable reasons is a
check people learn to ignore.

So: on a branch a missing tag warns, on `main` it fails, and the
failure names the two commands that clear it. A tag that exists and
serves the wrong bytes fails everywhere, because the fix is never to
move it. The window between merge and tag stays open
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

from artifact_manifest import GROUPS, PINS, TAGS  # noqa: E402

def git(*args: str) -> tuple[int, str]:
    # UTF-8, not the locale codec: on Windows that is cp1252, which cannot
    # decode git's output and crashed this check before it could report.
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="replace")
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def digest_at(tag: str, rel: str) -> str | None:
    """The artifact's sha256 as of `tag`, or None if it is not there.

    A tag that exists but points at the wrong commit is worse than a
    missing one: the URL resolves and serves bytes that do not match
    `SHA256SUMS`, so a consumer verifies against a digest it fetched
    from somewhere else and concludes the artifact is corrupt.
    """
    # Raw bytes, never decoded: SHA256SUMS is over the bytes a consumer
    # downloads, and a text round trip (decode, translate newlines,
    # re-encode) can only make the digest describe something else.
    done = subprocess.run(["git", "cat-file", "-p", f"{tag}:{rel}"],
                          cwd=ROOT, capture_output=True)
    if done.returncode != 0:
        return None
    return hashlib.sha256(done.stdout).hexdigest()


def expected_digests() -> dict[str, str]:
    sums = ROOT / "spec" / "SHA256SUMS"
    out = {}
    for line in sums.read_text(encoding="utf-8").splitlines():
        digest, _, path = line.partition("  ")
        if path.strip():
            out[path.strip()] = digest
    return out


def unpinned(sums: dict[str, str]) -> list[str]:
    """Checksummed paths no tag addresses, and groups naming no tag.

    A file without a tag has a digest and no address: a consumer can
    verify it and cannot fetch it.
    """
    bad = sorted(rel for rel in sums if PINS.get(rel) is None)
    bad += [f"group '{title}': pin '{pin}' is not a tag"
            for title, pin, _, _ in GROUPS if pin not in TAGS]
    return bad


def mismatches(tag: str, files: list[str],
               sums: dict[str, str]) -> list[str]:
    """Each file the tag serves with bytes other than SHA256SUMS claims."""
    bad = []
    for rel in files:
        got = digest_at(tag, rel)
        if got is None:
            bad.append(f"{rel}: absent at {tag}")
        elif got != sums.get(rel):
            bad.append(f"{rel}: {got[:16]}… at {tag}, "
                       f"SHA256SUMS says {sums.get(rel, '?')[:16]}…")
    return bad


def check_tag(tag: str, files: list[str], sums: dict[str, str],
              strict: bool) -> int | None:
    """0 ok, 1 failed, None when the remote cannot be reached."""
    code, out = git("ls-remote", "--tags", "origin", f"refs/tags/{tag}")
    if code != 0:
        return None

    if out.strip() == "":
        print(f"[pin] {tag} IS NOT ON THE REMOTE.")
        print(f"      ARTIFACTS.md tells consumers to fetch {len(files)} "
              f"file(s) from")
        print(f"        .../{tag}/{files[0]}")
        print(f"      and those URLs return 404. Fix (ARTIFACTS.md, "
              f"'Releasing'):")
        kind, _, version = tag.partition("-")
        print(f"        git tag -a {tag} -m '{kind} {version}'")
        print(f"        git push origin {tag}")
        return 1 if strict else 0

    remote = out.split()[0]
    _, local = git("rev-parse", "-q", "--verify", f"refs/tags/{tag}")
    if local.strip() == "":
        print(f"[pin] {tag} is on the remote (not fetched locally, "
              f"contents unchecked)")
        return 0
    if local.strip() != remote:
        # A local tag that disagrees with the remote one checks bytes
        # nobody is served. Not fixed here: rewriting a local ref is the
        # user's call.
        print(f"[pin] {tag} differs locally from the remote; contents "
              f"unchecked. Refresh with:")
        print(f"        git fetch origin --force refs/tags/{tag}:refs/tags/{tag}")
        return 0

    bad = mismatches(tag, files, sums)
    if bad:
        print(f"[pin] {tag} RESOLVES BUT SERVES DIFFERENT BYTES for "
              f"{len(bad)} of {len(files)} file(s):")
        for line in bad:
            print(f"        {line}")
        print(f"      A consumer following ARTIFACTS.md will fetch these "
              f"and conclude they are corrupt. A tag that already "
              f"published must not move: the files belong to the next "
              f"version, under a new tag.")
        return 1

    print(f"[pin] {tag} resolves and serves all {len(files)} file(s) as "
          f"SHA256SUMS claims.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on a missing tag (CI, on main)")
    args = ap.parse_args()

    sums = expected_digests()
    bad = unpinned(sums)
    if bad:
        print("[pin] UNPINNED — checksummed with no tag to fetch it from; "
              "give each a pin in schema/artifact_manifest.py GROUPS:")
        for line in bad:
            print(f"        {line}")
        return 1

    status = 0
    for tag in dict.fromkeys(TAGS.values()):
        files = [rel for rel in sums if PINS[rel] == tag]
        result = check_tag(tag, files, sums, args.strict)
        if result is None:
            # No remote, no network, or no credentials. Not a finding:
            # this runs inside `tools/verify.py`, which is expected to
            # work on a plane.
            print(f"[pin] remote unreachable, skipped")
            return 0
        status |= result
    return status


if __name__ == "__main__":
    raise SystemExit(main())
