import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Scenarios: whole behaviours, against a real database.
 *
 * Separate from `vitest.config.mts` for the reason apps/web keeps the same
 * split — these are not unit tests and must never run by accident in a suite
 * somebody expects to be hermetic. `assertLocalDatabase()` in each one is the
 * second guard; this config is the first.
 *
 * Run one at a time:
 *   pnpm --filter @sailo/hq test:scenarios e2e/scenarios/partner-program.scenario.ts
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      { find: "server-only", replacement: resolve(root, "test-stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["e2e/scenarios/**/*.scenario.ts"],
    // A real database over the network, and some of these walk a whole flow.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
