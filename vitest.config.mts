import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Unit and integration tests. Browser-level suites live in `tests/e2e` and run
 * under Playwright — Vitest owns everything that doesn't need a real page.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      { find: "server-only", replacement: resolve(root, "tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests talk to a real database and must not interleave.
    fileParallelism: false,
    setupFiles: ["tests/setup.mts"],
    coverage: {
      provider: "v8",
      /*
       * Only what a unit test can genuinely reach.
       *
       * Server actions, database queries and anything that talks to Stripe,
       * Resend or Blob are covered by `tests/integration` and `tests/e2e`
       * against real services. Counting their lines here would produce a
       * number that moves when someone adds a mock, which is not the thing
       * worth measuring.
       */
      include: [
        "src/lib/analytics.ts",
        "src/lib/billing-map.ts",
        "src/lib/cart.ts",
        "src/lib/csv.ts",
        "src/lib/delivery.ts",
        "src/lib/handle.ts",
        "src/lib/invariant.ts",
        "src/lib/payments.ts",
        "src/lib/plans.ts",
        "src/lib/pricing.ts",
        "src/lib/quote.ts",
        "src/lib/variants.ts",
        "src/i18n/config.ts",
        "src/i18n/index.ts",
      ],
      /*
       * The dictionaries are data — 22 files of translated strings whose
       * "coverage" is whether a test happened to read one, which measures
       * nothing. Their integrity is checked directly in `i18n.test.ts`:
       * same keys, no blanks, placeholders preserved, right script.
       *
       * `i18n/server.ts` reads `cookies()` and `headers()`; it is exercised
       * by the e2e suite against a real request.
       */
      exclude: ["src/i18n/dictionaries/**", "src/i18n/server.ts", "**/*.d.ts"],
      reporter: ["text-summary", "html"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
