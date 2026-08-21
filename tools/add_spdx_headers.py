#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Add SPDX-License-Identifier headers to source files.

Idempotent: files that already declare an SPDX identifier in their first few
lines are left alone. Dry run by default.

    python tools/add_spdx_headers.py              # report what would change
    python tools/add_spdx_headers.py --apply      # write the changes
    python tools/add_spdx_headers.py --apply --root scf-core

Run it from the repository root. It only touches files tracked by git, so it
will not wander into node_modules, build output, or anything gitignored.

Generated artifacts checksummed in spec/SHA256SUMS are skipped: stamping one
would put it out of step with the manifest until its generator emitted the
same header, and CI would fail on the next --check.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

LICENSE_ID = "Apache-2.0"
SPDX_TAG = "SPDX-License-Identifier"

# extension -> (prefix, suffix). suffix is used for languages with no line comment.
COMMENT_STYLES: dict[str, tuple[str, str]] = {
    ".ts": ("// ", ""),
    ".tsx": ("// ", ""),
    ".js": ("// ", ""),
    ".jsx": ("// ", ""),
    ".mjs": ("// ", ""),
    ".cjs": ("// ", ""),
    ".css": ("/* ", " */"),
    ".scss": ("// ", ""),
    ".py": ("# ", ""),
    ".sh": ("# ", ""),
    ".bash": ("# ", ""),
    ".toml": ("# ", ""),
    ".yml": ("# ", ""),
    ".yaml": ("# ", ""),
    ".gd": ("# ", ""),
    ".gdshader": ("// ", ""),
    ".sql": ("-- ", ""),
    ".rs": ("// ", ""),
    ".c": ("// ", ""),
    ".h": ("// ", ""),
    ".cpp": ("// ", ""),
    ".hpp": ("// ", ""),
}

# Files that must not be modified even if the extension matches.
SKIP_NAMES = {
    "LICENSE",
    "NOTICE",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
}

# Generated, published artifacts are never stamped. They are checksummed in
# spec/SHA256SUMS, so stamping one here would make it disagree with the
# manifest until the generator was taught to emit the same header — two
# places describing one file, which is the drift this repository is built to
# avoid. The list is READ FROM the manifest rather than maintained here, so a
# new artifact is excluded the moment it is published.
def checksummed_paths(root: Path) -> set[Path]:
    sums = root / "spec" / "SHA256SUMS"
    if not sums.exists():
        return set()
    out: set[Path] = set()
    for line in sums.read_text(encoding="utf-8").splitlines():
        _, _, rel = line.partition("  ")
        if rel.strip():
            out.add((root / rel.strip()).resolve())
    return out


SKIP_DIR_PARTS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    "vendor",
    "third_party",
    "__pycache__",
    ".venv",
    "corpus",  # never touch corpus material
}

# How many leading lines to inspect when checking for an existing tag.
SCAN_LINES = 10


def tracked_files(root: Path) -> list[Path]:
    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=root,
            capture_output=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        # git is preferred because it honours .gitignore for free. It is
        # not REQUIRED: a licence-header tool depending on a VCS binary
        # is a dependency nobody would choose deliberately, and every
        # other script in this repository runs on Python alone. GitHub
        # Desktop, in particular, ships a git that is not on PATH.
        print("note: git unavailable — walking the filesystem instead",
              file=sys.stderr)
        return walk_files(root)
    names = result.stdout.decode("utf-8", "replace").split("\0")
    return [root / n for n in names if n]


def walk_files(root: Path) -> list[Path]:
    """Every file under root, minus the directories git would ignore.

    SKIP_DIR_PARTS already names them, so this reuses the same list
    rather than restating it — the two would drift otherwise, and the
    walk is the path that runs when nothing is watching.

    It does NOT read .gitignore, so it can see a file `git ls-files`
    would not. That is acceptable here only because every ignored
    directory in this repository is already in SKIP_DIR_PARTS, and
    because the tool is idempotent and reports what it touched. Prefer
    the git path; this one is a fallback, not an equivalent.
    """
    out: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIR_PARTS for part in path.relative_to(root).parts):
            continue
        out.append(path)
    return out


def should_skip(path: Path, root: Path) -> bool:
    if path.name in SKIP_NAMES:
        return True
    rel_parts = set(path.relative_to(root).parts[:-1])
    return bool(rel_parts & SKIP_DIR_PARTS)


def has_spdx(text: str) -> bool:
    for line in text.splitlines()[:SCAN_LINES]:
        if SPDX_TAG in line:
            return True
    return False


def build_header(ext: str) -> str:
    prefix, suffix = COMMENT_STYLES[ext]
    return f"{prefix}{SPDX_TAG}: {LICENSE_ID}{suffix}\n"


def insert(text: str, header: str) -> str:
    lines = text.splitlines(keepends=True)
    at = 0
    # Preserve a shebang, and a Python encoding declaration if present.
    if lines and lines[0].startswith("#!"):
        at = 1
        if len(lines) > 1 and "coding" in lines[1] and lines[1].lstrip().startswith("#"):
            at = 2
    # Preserve an XML declaration.
    elif lines and lines[0].lstrip().startswith("<?xml"):
        at = 1
    return "".join(lines[:at]) + header + "".join(lines[at:])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes to disk")
    parser.add_argument("--root", default=".", help="subdirectory to limit the run to")
    args = parser.parse_args()

    repo_root = Path.cwd()
    limit = (repo_root / args.root).resolve()
    generated = checksummed_paths(repo_root)

    changed: list[Path] = []
    skipped_binary: list[Path] = []
    skipped_generated: list[Path] = []
    already: int = 0

    for path in tracked_files(repo_root):
        if not path.is_file():
            continue
        if limit not in (path, *path.parents):
            continue
        ext = path.suffix.lower()
        if ext not in COMMENT_STYLES:
            continue
        if should_skip(path, repo_root):
            continue
        if path.resolve() in generated:
            skipped_generated.append(path)
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            skipped_binary.append(path)
            continue
        if has_spdx(text):
            already += 1
            continue
        changed.append(path)
        if args.apply:
            # newline="" so Python does not translate \n to the platform
            # line ending. On Windows the default would rewrite every
            # touched file to CRLF — a whole-file diff for a one-line
            # header, and churn in a repository whose .gitattributes
            # asks for LF everywhere.
            with path.open("w", encoding="utf-8", newline="") as fh:
                fh.write(insert(text, build_header(ext)))

    verb = "Updated" if args.apply else "Would update"
    for path in changed:
        print(f"{verb}: {path.relative_to(repo_root)}")
    for path in skipped_binary:
        print(f"Skipped (not utf-8): {path.relative_to(repo_root)}", file=sys.stderr)
    for path in skipped_generated:
        print(f"Skipped (generated, checksummed): "
              f"{path.relative_to(repo_root)}", file=sys.stderr)

    print(f"\n{verb.lower()} {len(changed)} file(s); {already} already tagged.")
    if changed and not args.apply:
        print("Re-run with --apply to write the changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
