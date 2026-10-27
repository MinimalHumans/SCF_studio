#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# One command that builds the dev/CI parity image and runs the full check
# suite (docker/run-checks.sh) against this checkout
# (docs/file-management-plan.md, Step 0: "one command runs the same
# checks as ci.yml locally").

set -euo pipefail
cd "$(dirname "$0")/.."

# Git Bash (MSYS) on Windows rewrites the container-side half of a -v
# argument as if it were a Windows path (":/workspace" becomes
# "C:/Program Files/Git/workspace"); this opts out. Ignored elsewhere.
export MSYS_NO_PATHCONV=1

docker build -f docker/dev.Dockerfile -t scf-dev .
docker run --rm -v "$PWD":/workspace scf-dev
