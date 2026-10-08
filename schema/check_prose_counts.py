# SPDX-License-Identifier: Apache-2.0
"""check_prose_counts.py — a count written in prose must be true.

The most frequent defect in this repository's history is a number written
by hand beside a fact that later moved. The release checklist's rev 14
pass found about a dozen at once, and three of them contradicted each
other: the specification called the link entities thirteen in one place
and fourteen in two others, while the registry had sixteen. Every number
it found is one a generator already knows.

So this check does not ban numbers. It compares them. For each quantity
the generated files can state — entities, link entities, open fields,
finding codes, exported names, manifest files, line types, canonical
queries — it finds a number placed next to that noun in the reading
documents and fails if the number is not the true one.

What it deliberately leaves alone:

- **History.** A sentence anchored in time — "in 0.53", "as of 2.14",
  "since", "until", "before", "rev 13" — describes then, not now.
  "Sixteen fields lost `other` in 0.53" stays true forever.
- **Subsets.** In "eleven of the sixteen", only the sixteen is a claim
  about the whole. And a count far below the total — under half of it —
  counts some of a thing, not all of it: "two entities can both be about
  sound". Every stale total this repository has found was within a
  fifth of the truth, so the cut-off costs nothing that has happened.
- **Per-tier counts are checked exactly**, as their own quantity: "tier
  2, thirty entities", and the tier table in `what-is-scf.md`.
- **Qualified groups.** "nine tier-1 entities" counts some entities, not
  all of them; a word between the number and the noun that is not on a
  short list of neutral ones means a subset.
- **Code blocks**, which quote program output, and changelogs, which are
  history by nature.
- A paragraph carrying `<!-- count-ok -->`, for the rare sentence that
  defeats all of the above.

It will miss things. It is built to catch the expensive case — a claim
about the present that is wrong — without ever failing a true sentence,
because a check that cries wolf gets exemptions until it checks nothing.

Run: python schema/check_prose_counts.py
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DOCUMENTS = [
    "spec/scf-spec.md", "spec/stability.md", "spec/conformance.md",
    "README.md", "scf-core/README.md", "scf-mcp/README.md",
    "scf-app/README.md", "docs/glossary.md", "docs/walkthrough.md",
    "docs/what-is-scf.md", "docs/faq.md", "docs/authoring-guide.md",
]


def truths() -> dict[str, int]:
    def load(rel: str):
        return json.loads((ROOT / rel).read_text(encoding="utf-8"))
    entities = load("scf-core/registry/registry.json")["entities"]
    lines = load("spec/screenplay-tables.json")["lineTypeColumn"]["values"]
    sums = (ROOT / "spec/SHA256SUMS").read_text(encoding="utf-8")
    return {
        "entities": len(entities),
        "link entities": sum(1 for e in entities if e.get("subject") == "link"),
        "open fields": sum(1 for e in entities for f in e["fields"]
                           if f.get("open")),
        "finding codes": len(load("spec/finding-catalog.json")["codes"]),
        "exported names": load("spec/api-surface.json")["total"],
        "manifest files": sum(1 for line in sums.splitlines() if line.strip()),
        "line types": len(lines),
        "canonical queries": 16,  # §12: fixed by the specification, Q00–Q15
        **{f"tier {t} entities": sum(1 for e in entities if e["tier"] == t)
           for t in range(7)},
    }


UNITS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
        "seventy": 70, "eighty": 80, "ninety": 90}
WORD = (r"(?:(?:" + "|".join(TENS) + r")(?:-(?:" + "|".join(list(UNITS)[:9])
        + r"))?|" + "|".join(UNITS) + r")")
NUMBER = rf"(?:\*\*)?(\d{{1,4}}|{WORD})(?:\*\*)?"


def value(token: str) -> int:
    token = token.lower()
    if token.isdigit():
        return int(token)
    if token in UNITS:
        return UNITS[token]
    tens, _, unit = token.partition("-")
    return TENS[tens] + (UNITS[unit] if unit else 0)


# Words that may sit between a number and its noun without making it a
# subset: "the 106 registry entities", "16 canonical queries".
NEUTRAL = r"(?:(?:the|registry|row|canonical|normative|published|closed)\s+)*"

# (quantity, pattern). Each pattern's group 1 is the number. Order
# matters: "link entities" is tried before "entities".
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("link entities",
     re.compile(rf"\b{NUMBER}\s+{NEUTRAL}(?:link entities|junctions)\b", re.I)),
    ("entities",
     re.compile(rf"\b{NUMBER}\s+{NEUTRAL}(?:entities|entity types|row types)\b", re.I)),
    ("entities", re.compile(rf"\b{NUMBER}-entity\b", re.I)),
    ("open fields", re.compile(rf"\b{NUMBER}\s+open fields\b", re.I)),
    ("open fields", re.compile(rf"\b{NUMBER}\s+fields are open\b", re.I)),
    ("finding codes",
     re.compile(rf"\b{NUMBER}\s+{NEUTRAL}(?:finding )?codes\b", re.I)),
    ("exported names",
     re.compile(rf"\b{NUMBER}\s+(?:exported |public )?(?:names|exports)\b",
                re.I)),
    ("manifest files", re.compile(rf"\b{NUMBER}\s+(?:files|artifacts)\b", re.I)),
    ("line types", re.compile(rf"\b{NUMBER}\s+line types\b", re.I)),
    # "one table out of ninety-nine": the tables are the entities.
    ("entities", re.compile(rf"\btables?\s+out of\s+(?:the\s+)?{NUMBER}\b",
                            re.I)),
    ("canonical queries",
     re.compile(rf"\b(?:the|all)\s+{NUMBER}\s+(?:canonical\s+)?queries\b",
                re.I)),
    ("canonical queries",
     re.compile(rf"\b{NUMBER}\s+canonical\s+queries\b", re.I)),
]

# "N of the M <noun>": only M speaks for the whole.
SUBSET = re.compile(rf"\b{NUMBER}\s+of\s+(?:the\s+)?(?=\S)", re.I)

# A sentence about a past state.
HISTORY = re.compile(
    r"\b(?:in|as of|since|until|before|after|by|from|at|through)\s+"
    r"(?:spec(?:ification)?\s+|schema\s+|version\s+|rev\s+)?\d+\.\d+\b"
    r"|\brev\s+\d+\b|\b[Rr]\d{2,3}\b|\bused to\b|\bwas\b|\bwere\b|\bhad\b",
    re.I)

# Which nouns are only checked when the sentence says what they count.
CONTEXT = {
    "manifest files": re.compile(r"manifest|SHA256SUMS|ARTIFACTS", re.I),
    "finding codes": re.compile(r"catalog|finding", re.I),
    "exported names": re.compile(r"api-surface|export|public API|index\.ts",
                                 re.I),
}


def paragraphs(text: str):
    """(first line number, paragraph) outside code fences."""
    fenced = False
    buf: list[str] = []
    start = 0
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            if buf:
                yield start, " ".join(buf)
                buf = []
            fenced = not fenced
            continue
        if fenced:
            continue
        # A table row is its own paragraph.
        if not line.strip() or line.lstrip().startswith("|"):
            if buf:
                yield start, " ".join(buf)
                buf = []
            if line.strip():
                yield n, line
            continue
        if not buf:
            start = n
        buf.append(line.strip())
    if buf:
        yield start, " ".join(buf)


# "tier 1, nine entities", "Tiers 4 and 5, twelve entities".
TIER_PROSE = re.compile(
    rf"\btiers?\s+(\d)(?:\s+and\s+(\d))?\s*,\s+{NUMBER}\s+entities\b", re.I)
# what-is-scf.md's tier table: "| **2** | Subject depth | 30. What …".
TIER_ROW = re.compile(
    rf"^\|\s*\*\*(\d)\*\*\s*\|[^|]*\|\s*{NUMBER}(?:\s+entities)?\.")


def tier_claims(paragraph: str):
    """(text, tiers, number) for every per-tier count in a paragraph."""
    for m in TIER_PROSE.finditer(paragraph):
        tiers = [int(t) for t in (m.group(1), m.group(2)) if t]
        yield m.group(0), tiers, value(m.group(3))
    m = TIER_ROW.match(paragraph.strip())
    if m:
        yield m.group(0), [int(m.group(1))], value(m.group(2))


SENTENCE = re.compile(r"(?<=[.!?;])\s+(?=[A-Z*`(\[_\"“])")


def main() -> int:
    # UTF-8 on every platform: a Windows console mangles the dashes.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    truth = truths()
    problems: list[str] = []
    checked = 0
    # Paths on the command line replace the default set — for checking a
    # draft, or an old revision, against today's truth.
    targets = sys.argv[1:] or DOCUMENTS
    for rel in targets:
        path = pathlib.Path(rel) if sys.argv[1:] else ROOT / rel
        if not path.exists():
            continue
        for line, para in paragraphs(path.read_text(encoding="utf-8")):
            if "<!-- count-ok -->" in para:
                continue
            for text, tiers, said in tier_claims(para):
                checked += 1
                want = sum(truth[f"tier {t} entities"] for t in tiers)
                if said != want:
                    where = " and ".join(str(t) for t in tiers)
                    problems.append(f"{rel}:{line}  \"{text.strip()}\" — "
                                    f"tier {where}: {want} entities")
            for sentence in SENTENCE.split(para):
                if HISTORY.search(sentence):
                    continue
                # Blank out "N of the" so the subset count is not read as a
                # claim about the whole; the M after it still is.
                scrubbed = SUBSET.sub(lambda m: " " * len(m.group(0)), sentence)
                seen: set[tuple[int, int]] = set()
                for quantity, pattern in PATTERNS:
                    context = CONTEXT.get(quantity)
                    if context is not None and not context.search(sentence):
                        continue
                    for match in pattern.finditer(scrubbed):
                        span = match.span(1)
                        if any(a <= span[0] < b for a, b in seen):
                            continue  # "link entities" already claimed it
                        seen.add(match.span())
                        said = value(match.group(1))
                        if said * 2 < truth[quantity]:
                            continue  # a subset, not a claim about the whole
                        checked += 1
                        if said != truth[quantity]:
                            problems.append(
                                f"{rel}:{line}  \"{match.group(0).strip()}\" "
                                f"— there are {truth[quantity]} {quantity}")
    if problems:
        print("[prose-counts] counts in prose that are not true:",
              file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        print("\n  Correct the number, or say what it counts without one —\n"
              "  the generated file that holds it is usually the better\n"
              "  reference. A sentence about the past should say when.",
              file=sys.stderr)
        return 1
    print(f"[prose-counts] {checked} counts across {len(targets)} documents, "
          "all true.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
