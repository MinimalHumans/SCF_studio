import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// scf-core is consumed as TypeScript source via alias — no build step for
// the core package until it publishes (design decision 6).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@scf-core": resolve(here, "../scf-core/src"),
      "@registry": resolve(here, "../scf-core/registry"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
});
