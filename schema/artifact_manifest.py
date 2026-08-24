#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
artifact_manifest.py — record the published artifacts for a schema
version, with checksums.

The registry, the physical DDL and the fixture need to be fetchable BY
VERSION and verifiable once fetched. The obvious way to do that is to
commit a copy per version, and that is the wrong way: registry.json is
400KB and would be duplicated on every bump, immediately raising the
question of which copy is real.

Git already versions files. What was missing is an addressing scheme and
a way to check that what you downloaded is what was published. So:

  - a `schema-X.Y` tag pins the tree,
  - the raw URL at that tag is the artifact's address,
  - this manifest carries the SHA-256 so a consumer can verify it.

    python3 schema/artifact_manifest.py            # write
    python3 schema/artifact_manifest.py --check    # verify, for CI

--check fails if any artifact's hash has moved without the manifest
being regenerated, which is the same guarantee the registry generator
gives, applied to publication rather than generation.
"""
import argparse
import hashlib
import pathlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema_meta import SCHEMA_VERSION  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "spec" / "ARTIFACTS.md"
REPO = "https://raw.githubusercontent.com/MinimalHumans/SCF_studio"

# Two lists would drift, so there is one. Everything named here is
# BOTH published in ARTIFACTS.md and checksummed in SHA256SUMS —
# there is no third category of file that is stamped but not
# described, or described but not verifiable.
#
# ARTIFACTS.md and SHA256SUMS are themselves absent, necessarily: a
# file cannot carry its own digest. They are verified by
# regenerating them, which is what --check does and what CI runs.
GROUPS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("The specification",
     "The normative documents. Stamped since 0.31: three independent "
     "readers built against this prose, and until now nothing let "
     "them confirm they had read the same bytes it was written as.",
     [
        ("spec/scf-spec.md",
         "The specification. Everything normative about the format is "
         "here or cited from here."),
        ("spec/conformance.md",
         "What a conforming implementation must do, per role, and how a "
         "claim is made."),
        ("spec/stability.md",
         "What is safe to build against and what is not, per subject."),
        ("spec/CHANGELOG.md",
         "The specification changelog. Spec §11.5."),
     ]),

    ("Schema and registry",
     "Generated from `schema/`, which is the source of truth for all "
     "of them.",
     [
        ("scf-core/registry/registry.json",
         "The normative field set. Spec §2.1."),
        ("spec/scf-schema.sql",
         "The physical DDL, dumped from initDatabase(). Spec §1.3."),
        ("spec/screenplay-tables.json",
         "The screenplay infrastructure tables and the `line_type` "
         "vocabulary. Spec §1.3."),
        ("spec/entity-reference.md",
         "Every entity and field, generated from the registry. Not "
         "normative — a reading aid over `registry.json`."),
        ("spec/query-reference.md",
         "All sixteen queries in one page, generated from §12, the "
         "published results and `queryPaths.ts`. Not normative."),
        ("spec/api-surface.json",
         "Every name importable from `@minimalhumans/scf-core`, per "
         "entry point, with its kind."),
        ("spec/registry.schema.json",
         "JSON Schema for registry.json, so it can be consumed without "
         "running the reference implementation."),
        ("spec/junction-keys.json",
         "Natural keys for every link entity. Spec §6.3."),
        ("spec/readiness-rubrics.json",
         "What Q14 assesses, per target query. Spec §12.9.1."),
        ("spec/finding-catalog.json",
         "The normative finding catalog. Spec §9.4 requires every code and "
         "severity to come from here."),
     ]),

    ("The canonical query results",
     "One normative result per query, spec §12. Rows by uuid, no row "
     "ids, no timestamps.",
     [
        ("fixtures/expectations/Q00.result.json",
         "Q00's normative result. Spec §12.12."),
        ("fixtures/expectations/Q03.result.json",
         "Q03's normative result. Spec §12.4."),
        ("fixtures/expectations/Q01.result.json",
         "Q01's normative result. Spec §12.15."),
        ("fixtures/expectations/Q02.result.json",
         "Q02's normative result. Spec §12.16."),
        ("fixtures/expectations/Q04.result.json",
         "Q04's normative result. Spec §12.17."),
        ("fixtures/expectations/Q05.result.json",
         "Q05's normative result. Spec §12.2."),
        ("fixtures/expectations/Q07.result.json",
         "Q07's normative result. Spec §12.3."),
        ("fixtures/expectations/Q06.result.json",
         "Q06's normative result. Spec §12.6."),
        ("fixtures/expectations/Q08.result.json",
         "Q08's normative result. Spec §12.7."),
        ("fixtures/expectations/Q09.result.json",
         "Q09's normative result. Spec §12.10."),
        ("fixtures/expectations/Q10.result.json",
         "Q10's normative result. Spec §12.11."),
        ("fixtures/expectations/Q11.result.json",
         "Q11's normative result. Spec §12.13."),
        ("fixtures/expectations/Q12.result.json",
         "Q12's normative result. Spec §12.5."),
        ("fixtures/expectations/Q13.result.json",
         "Q13's normative result. Spec §12.8."),
        ("fixtures/expectations/Q14.result.json",
         "Q14's normative result. Spec §12.9."),
        ("fixtures/expectations/Q15.result.json",
         "Q15's normative result. Spec §12.14."),
     ]),

    ("The canonical query parameters",
     "What each published result was asked, as selectors that resolve "
     "against the fixture by content rather than by row id.",
     [
        ("fixtures/expectations/selectors.json",
         "The seven selectors and the sixteen queries' parameters. "
         "Conformance §5.4."),
     ]),

    ("The negative fixtures",
     "Eleven files that are wrong in a stated way, and the report "
     "each MUST produce. Stamped since 0.31: conformance turns on "
     "reproducing these reports exactly, so their bytes matter as "
     "much as any generated artifact's.",
     [
        ("fixtures/negative/CASES.json",
         "The eleven negative fixtures as reproducible recipes. Spec "
         "conformance.md §5.3."),
        ("fixtures/negative/asset-absolute.expected.json",
         "An absolute asset path where a rooted one is required. Spec conformance.md §5.3."),
        ("fixtures/negative/asset-escapes-root.expected.json",
         "An asset address that resolves outside the root. Spec conformance.md §5.3."),
        ("fixtures/negative/header-unstamped.expected.json",
         "A file carrying no SCF application id. Spec conformance.md §5.3."),
        ("fixtures/negative/relationship-contradictory.expected.json",
         "Two relationship rows that disagree. Spec conformance.md §5.3."),
        ("fixtures/negative/relationship-directionality-absent.expected.json",
         "A directional relationship with no direction. Spec conformance.md §5.3."),
        ("fixtures/negative/relationship-endpoint-absent.expected.json",
         "A relationship pointing at a row that is not there. Spec conformance.md §5.3."),
        ("fixtures/negative/span-boundary-dangling.expected.json",
         "A span anchored past the end of its line. Spec conformance.md §5.3."),
        ("fixtures/negative/unknown-table.expected.json",
         "A table the registry does not declare. Spec conformance.md §5.3."),
        ("fixtures/negative/uuid-duplicate.expected.json",
         "One uuid on more than one row. Spec conformance.md §5.3."),
        ("fixtures/negative/uuid-malformed.expected.json",
         "A uuid that is not a uuid. Spec conformance.md §5.3."),
        ("fixtures/negative/uuid-missing.expected.json",
         "A row carrying no uuid at all. Spec conformance.md §5.3."),
     ]),

    ("File identification and the fixture",
     "",
     [
        ("spec/scf.magic",
         "magic(5) stanza for file(1). Spec §1.2."),
        ("fixtures/hollow_creek.scf",
         "The conformance fixture. Its load-bearing properties are "
         "enumerated in spec/conformance.md §5.1."),
     ]),
]

ARTIFACTS = [item for _, _, items in GROUPS for item in items]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def render() -> str:
    tag = f"schema-{SCHEMA_VERSION}"
    lines = [
        # Generated prose, so the header is emitted here rather than by
        # tools/add_spdx_headers.py — which skips this file for exactly
        # that reason. CC BY 4.0, not Apache-2.0: see spec/LICENSE.
        "<!-- SPDX-License-Identifier: CC-BY-4.0 -->",
        "",
        "# Published artifacts",
        "",
        "GENERATED by `schema/artifact_manifest.py`. Do not hand-edit.",
        "",
        f"Schema version **{SCHEMA_VERSION}**, tag `{tag}`.",
        "",
        "## Addressing",
        "",
        "A tag pins the tree; the raw URL at that tag is the artifact's",
        "address. Nothing is duplicated per version — git already stores",
        "the history, and a second copy in the working tree would only",
        "raise the question of which one is real.",
        "",
        "```",
        f"{REPO}/{tag}/<path>",
        "```",
        "",
        "So the registry for this version is:",
        "",
        "```",
        f"{REPO}/{tag}/scf-core/registry/registry.json",
        "```",
        "",
        "`main` is a moving target and MUST NOT be used to pin a version.",
        "",
        "## Verification",
        "",
        "```sh",
        "sha256sum -c spec/SHA256SUMS",
        "```",
        "",
        f"## Artifacts ({len(ARTIFACTS)})",
        "",
        "This list is exhaustive in both directions: everything below is",
        "published here AND checksummed in `SHA256SUMS`, and nothing is",
        "checksummed that is not described here.",
        "",
        "`ARTIFACTS.md` and `SHA256SUMS` are necessarily absent — a file",
        "cannot carry its own digest. They are verified by regenerating",
        "them, which is what CI does on every run.",
        "",
    ]
    sums = []
    for group, note, items in GROUPS:
        lines += [f"### {group}", ""]
        if note:
            lines += [note, ""]
        lines += ["| Artifact | SHA-256 | What it is |", "|---|---|---|"]
        for rel, desc in items:
            path = ROOT / rel
            if not path.exists():
                raise SystemExit(f"missing artifact: {rel}")
            digest = sha256(path)
            sums.append(f"{digest}  {rel}")
            lines.append(f"| `{rel}` | `{digest[:16]}…` | {desc} |")
        lines.append("")
    lines += [
        "Full digests are in [`SHA256SUMS`](SHA256SUMS).",
        "",
        "## Releasing a schema version",
        "",
        "Step 6 of the change procedure in `docs/conventions.md` §8:",
        "",
        "```sh",
        "python3 schema/artifact_manifest.py",
        f"git tag -a {tag} -m 'schema {SCHEMA_VERSION}'",
        f"git push origin {tag}",
        "```",
        "",
        "The tag is what makes the URLs above resolve. Until it exists,",
        "this manifest describes an address that 404s.",
        "",
        "An **annotated** tag, not a signed one. A signed tag would add",
        "provenance — proof the tag came from whoever holds the key —",
        "and that matters once third parties fetch artifacts by tag and",
        "not before. `git tag -s` is a drop-in substitute wherever a",
        "signing key is configured, and nothing else here changes.",
        "",
        "Digests are over RAW BYTES. A checkout whose working tree has",
        "CRLF line endings will not match; `.gitattributes` sets",
        "`eol=lf` to prevent that.",
        "",
    ]
    return "\n".join(lines), "\n".join(sums) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify without writing; non-zero if stale")
    args = ap.parse_args()

    manifest, sums = render()
    sums_path = ROOT / "spec" / "SHA256SUMS"

    if args.check:
        stale = []
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != manifest:
            stale.append(str(OUT.relative_to(ROOT)))
        if (not sums_path.exists()
                or sums_path.read_text(encoding="utf-8") != sums):
            stale.append(str(sums_path.relative_to(ROOT)))
        if stale:
            print("[artifacts] STALE: " + ", ".join(stale))
            # TEXT artifacts only. `hollow_creek.scf` is a SQLite
            # database and contains \r\n byte pairs by coincidence, so
            # including it made this branch fire on any staleness at all
            # and advise renormalising a binary file. A NUL in the first
            # few KB is the same binary test git itself uses.
            def is_text(path: pathlib.Path) -> bool:
                return b"\x00" not in path.read_bytes()[:8000]

            crlf = [rel for rel, _ in ARTIFACTS
                    if is_text(ROOT / rel)
                    and b"\r\n" in (ROOT / rel).read_bytes()]
            if crlf:
                # Almost always the real cause on Windows, and the
                # message above sends you to the one command that makes
                # it worse: regenerating writes CRLF-derived digests
                # that then fail on the Linux runner.
                print()
                print(f"  {len(crlf)} artifact(s) have CRLF line endings, "
                      "including:")
                for rel in crlf[:3]:
                    print(f"    {rel}")
                print()
                print("  These digests are over RAW BYTES, so a CRLF "
                      "working tree cannot match")
                print("  a manifest blessed on LF. DO NOT REGENERATE — "
                      "fix the checkout:")
                print()
                print("    git add --renormalize .")
                print("    git checkout-index -a -f")
                print()
                print("  .gitattributes sets `eol=lf` to prevent this. "
                      "A checkout made")
                print("  before that line existed still has CRLF until "
                      "it is renormalised.")
                return 1
            print("  run: python3 schema/artifact_manifest.py")
            return 1
        print(f"[artifacts] up to date ({len(ARTIFACTS)} artifacts, "
              f"schema {SCHEMA_VERSION}).")
        return 0

    OUT.write_text(manifest, encoding="utf-8")
    sums_path.write_text(sums, encoding="utf-8")
    print(f"[artifacts] wrote {len(ARTIFACTS)} artifacts, "
          f"schema {SCHEMA_VERSION}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
