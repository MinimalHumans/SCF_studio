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
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("error: not a git repository, or git is not on PATH", file=sys.stderr)
        raise SystemExit(2)
    names = result.stdout.decode("utf-8", "replace").split("\0")
    return [root / n for n in names if n]


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

    changed: list[Path] = []
    skipped_binary: list[Path] = []
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
            path.write_text(insert(text, build_header(ext)), encoding="utf-8")

    verb = "Updated" if args.apply else "Would update"
    for path in changed:
        print(f"{verb}: {path.relative_to(repo_root)}")
    for path in skipped_binary:
        print(f"Skipped (not utf-8): {path.relative_to(repo_root)}", file=sys.stderr)

    print(f"\n{verb.lower()} {len(changed)} file(s); {already} already tagged.")
    if changed and not args.apply:
        print("Re-run with --apply to write the changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
