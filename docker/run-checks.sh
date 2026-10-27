#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Runs the same build/typecheck/test steps as ci.yml's core, host, mcp and
# app jobs, plus a cargo check of the Tauri shell, in one pass
# (docs/file-management-plan.md, Step 0). Intended to run inside the image
# built from docker/dev.Dockerfile, with the repository mounted at
# /workspace; see docker/ci.sh for the one-command form.
#
# The "artifacts" job's generated-file checks (registry.json, SHA256SUMS,
# the docs site, ...) are not part of this script — they are unrelated to
# file handling and already run outside Docker.

set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "scf-core: install"
(cd scf-core && npm ci)
step "scf-core: typecheck"
(cd scf-core && npm run typecheck)
step "scf-core: test"
(cd scf-core && npm test)
step "scf-core: build"
(cd scf-core && npm run build)

step "scf-host: install"
(cd scf-host && npm ci)
step "scf-host: typecheck"
(cd scf-host && npm run typecheck)
step "scf-host: test"
(cd scf-host && npm test)
step "scf-host: build"
(cd scf-host && npm run build)

step "scf-mcp: install"
(cd scf-mcp && npm ci)
step "scf-mcp: typecheck"
(cd scf-mcp && npm run typecheck)
step "scf-mcp: test"
(cd scf-mcp && npm test)

step "scf-app: install"
(cd scf-app && npm ci)
step "scf-app: typecheck"
(cd scf-app && npm run typecheck)
step "scf-app: test"
(cd scf-app && npm test)
step "scf-app: build the page"
(cd scf-app && npm run build)

step "scf-app/src-tauri: cargo check"
(cd scf-app/src-tauri && cargo check)

step "all checks passed"
