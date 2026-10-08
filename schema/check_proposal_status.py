# SPDX-License-Identifier: Apache-2.0
"""check_proposal_status.py — a proposal the changelogs say is done
should not still say `draft`.

`proposals/README.md` is explicit that `implemented` is set when the
change lands, and that an accepted proposal is "a promise, not a
description" until then. That status is written by hand, in a file
nobody reopens after the work is finished, and describes something
recorded elsewhere — every condition this project's own recurring
failure mode needs. It drifted: ten proposals were implemented across
spec 0.53/0.54 and schema 2.15 and every one of them still read
`draft`, so the directory said nothing had been built.

The check is one-directional and deliberately so. A changelog entry
naming a proposal is evidence the work landed, so that proposal must
not be `draft`. The reverse — a proposal marked implemented with no
changelog entry — is NOT checked here: the entry may be about to be
written in the same commit, and a check that forces the order of two
edits inside one change is noise.

Run: python schema/check_proposal_status.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROPOSALS = ROOT / "proposals"
CHANGELOGS = [ROOT / "spec" / "CHANGELOG.md",
              ROOT / "docs" / "schema-changelog.md"]

# "Proposal 0028", "Proposals 0008, 0024 and 0026", "proposals 0005, 0007,
# 0016 and 0024" — the number is what matters; the prose around it varies.
MENTION = re.compile(r"[Pp]roposals?\s+((?:\d{4}(?:\s*(?:,|and)\s*)?)+)")
# And parenthetically — `scene.characters_present` **(0021)**, "(0012,
# item 4)", "(0025's remaining half)". The schema changelog cites most of
# 2.14 this way, and matching only the word "proposal" missed eight
# implemented proposals that still said `draft`. Proposal numbers start
# with 0; a year in parentheses does not, so it cannot match.
CITED = re.compile(r"\(\s*(0\d{3}(?:\s*(?:,|and)\s*0\d{3})*)(?!\d)")
STATUS = re.compile(r"^\|\s*\*\*Status\*\*\s*\|\s*(.+?)\s*\|\s*$", re.M)


def mentioned() -> dict[str, list[str]]:
    """Proposal number -> the changelog files that claim it landed."""
    found: dict[str, list[str]] = {}
    for path in CHANGELOGS:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for run in MENTION.findall(text) + CITED.findall(text):
            for number in re.findall(r"\d{4}", run):
                found.setdefault(number, []).append(path.name)
    return found


def status_of(path: pathlib.Path) -> str | None:
    match = STATUS.search(path.read_text(encoding="utf-8"))
    return None if match is None else match.group(1)


def main() -> int:
    by_number = {p.name[:4]: p for p in sorted(PROPOSALS.glob("0*.md"))
                 if p.name[:4].isdigit() and p.name[:4] != "0000"}
    problems: list[str] = []
    checked = 0

    for number, sources in sorted(mentioned().items()):
        path = by_number.get(number)
        if path is None:
            problems.append(
                f"{', '.join(sorted(set(sources)))} names proposal {number}, "
                f"which does not exist in proposals/")
            continue
        status = status_of(path)
        checked += 1
        if status is None:
            problems.append(f"{path.name}: no Status row")
        elif "draft" in status.lower():
            problems.append(
                f"{path.name}: still `draft`, but "
                f"{', '.join(sorted(set(sources)))} records it as landed")

    # Every proposal must at least SAY something recognisable.
    known = ("draft", "accepted", "declined", "deferred", "implemented")
    for number, path in sorted(by_number.items()):
        status = status_of(path)
        if status is None:
            problems.append(f"{path.name}: no Status row")
        elif not any(word in status.lower() for word in known):
            problems.append(
                f"{path.name}: status {status!r} is none of {known}")

    if problems:
        print("[proposals] status drift:", file=sys.stderr)
        for line in problems:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"[proposals] {len(by_number)} proposals, "
          f"{checked} recorded as landed, all statuses agree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
