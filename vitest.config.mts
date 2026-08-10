import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests live beside the code they cover — a route's `_lib` is tested from
 * that route's folder, so moving a feature moves its tests with it. Browser
 * suites are Playwright's, under `e2e/`.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      // `server-only` throws by design outside a server component, which is
      // exactly what stops a server module being unit-tested.
      { find: "server-only", replacement: resolve(root, "e2e/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["e2e/stubs/setup.mts"],
    /*
     * Vitest defaults to five seconds, which is not enough here.
     *
     * Five files call `await import(...)` after `vi.resetModules()` to observe
     * a module reading its environment at load. That cold-loads a real module
     * graph — `db/index.ts` pulls the whole schema and takes about two seconds
     * on an idle machine — and sixty-odd files are competing for the cores
     * while it happens. `replica.test.ts` failed roughly one run in six on
     * that, always a timeout rather than an assertion, which reads as a broken
     * replica fallback until you look at it.
     *
     * Raised here rather than per test, because the exposure is the pattern
     * and not the file: the next test that imports for the same reason
     * inherits the fix. Nothing in this suite measures elapsed time, so a
     * generous ceiling costs only how long a genuine hang takes to report.
     */
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/_lib/**/*.ts", "src/lib/**/*.ts", "src/i18n/config.ts", "src/i18n/index.ts"],
      exclude: [
        "src/lib/actions/**",
        "src/lib/queries.ts",
        "src/i18n/dictionaries/**",
        "src/i18n/server.ts",
        "**/*.test.ts",
        "**/*.d.ts",
      ],
      reporter: ["text-summary"],
    },
  },
});
