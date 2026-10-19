// SPDX-License-Identifier: Apache-2.0
// The sibling packages as source (their `scf-source` export), as
// tsconfig.json resolves them, so a test never runs a stale `dist/`.
import { defineConfig } from "vitest/config";

const conditions = ["scf-source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
});
