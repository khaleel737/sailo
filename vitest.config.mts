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
