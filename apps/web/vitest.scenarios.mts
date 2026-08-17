import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The scenario suite: the money path, exercised for real.
 *
 * Separate from `vitest.config.mts` because these need a live database, and
 * the only one the app could otherwise reach is production's — which is the
 * reason no test has ever called `createOrderIntent`. `e2e/scenarios/up.sh`
 * starts a throwaway Postgres behind a local Neon HTTP proxy; this config
 * points the app's own driver at it.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      { find: "server-only", replacement: resolve(root, "e2e/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["e2e/scenarios/**/*.scenario.ts"],
    setupFiles: ["e2e/scenarios/setup.ts"],
    // Shared stock, coupons and invoice numbers — the contention is the point,
    // but it has to be deliberate rather than incidental.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
