#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Report third-party material that must not be published, in the working tree
# AND anywhere in git history. Read-only: this script changes nothing.
#
#   bash tools/audit_third_party.sh
#
# Run from the repository root. Works in Git Bash on Windows.

set -uo pipefail

# Case-insensitive substrings that suggest third-party source material.
# Add your own as you find them.
PATTERNS='aliens|frankenstein|corpus/private|screenplay_corpus|/private/'

# Text that must never appear inside a committed file. Add distinctive lines
# from any third-party script once you know what leaked.
CONTENT_PATTERNS='RIPLEY|BURKE|HUDSON|VASQUEZ|BISHOP|NOSTROMO|SULACO'

hr() { printf '\n%s\n' "------------------------------------------------------------"; }

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: run this from inside a git repository" >&2
  exit 2
fi

hr
echo "1. Matching paths in the CURRENT working tree (tracked files)"
hr
git ls-files | grep -Ei "$PATTERNS" || echo "  none"

hr
echo "2. Matching paths in the CURRENT working tree (untracked + ignored)"
hr
git ls-files --others | grep -Ei "$PATTERNS" || echo "  none"

hr
echo "3. Matching paths anywhere in GIT HISTORY  <-- the one that matters"
hr
git log --all --pretty=format: --name-only --diff-filter=A \
  | sort -u | grep -Ei "$PATTERNS" || echo "  none"

hr
echo "4. Distinctive third-party TEXT inside tracked files"
echo "   (catches fixtures and snapshots that embed dialogue)"
hr
git grep -Ein "$CONTENT_PATTERNS" -- . ":(exclude)tools/audit_third_party.sh" || echo "  none"

hr
echo "5. Distinctive third-party TEXT anywhere in history"
hr
git grep -Ein "$CONTENT_PATTERNS" \
  $(git rev-list --all) -- . ":(exclude)tools/audit_third_party.sh" 2>/dev/null | head -50 || echo "  none"
echo "  (first 50 hits shown)"

hr
echo "6. Largest blobs ever committed (top 20)"
echo "   Unexpected large files are often imported source material."
hr
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob" {print $3, $4}' \
  | sort -rn | head -20 \
  | awk '{printf "  %10.1f KB  %s\n", $1/1024, $2}'

hr
echo "7. Is the exclusion actually in .gitignore?"
hr
if [ -f .gitignore ]; then
  grep -nEi "$PATTERNS" .gitignore || echo "  no matching .gitignore rule found"
else
  echo "  no .gitignore at repository root"
fi

hr
echo "8. Commit author/committer identities used in this repo"
echo "   Look for any work email address."
hr
git log --all --format='%an <%ae>' | sort | uniq -c | sort -rn
echo
git log --all --format='%cn <%ce>' | sort | uniq -c | sort -rn

hr
echo "Done. Sections 3 and 5 are the ones that require history rewriting"
echo "if they return hits. Sections 1, 2 and 4 can be fixed with a commit."
hr
