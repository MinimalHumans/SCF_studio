# SPDX-License-Identifier: Apache-2.0
#
# Dev/CI parity image for SCF Studio: the Node, Rust and Tauri Linux build
# dependencies that ci.yml and desktop.yml's linux job use, so the same
# checks can run locally without touching the host machine
# (docs/file-management-plan.md, Step 0).
#
# Build:
#   docker build -f docker/dev.Dockerfile -t scf-dev .
# Run against this checkout:
#   docker run --rm -v "$PWD":/workspace scf-dev
# Or both in one command:
#   docker/ci.sh
#
# Windows-only behaviour (NSIS, signing, WebView2, UNC paths) is not
# covered by this image; see docs/file-management-plan.md §7.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Node 22 and Python 3.12 match ci.yml's NODE_VERSION/PYTHON_VERSION.
# The libwebkit2gtk/libgtk/librsvg/libayatana/patchelf set matches the
# "system libraries" step in desktop.yml's linux job.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl build-essential pkg-config python3 git \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
      libayatana-appindicator3-dev libssl-dev patchelf \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --default-toolchain stable \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
CMD ["bash", "docker/run-checks.sh"]
