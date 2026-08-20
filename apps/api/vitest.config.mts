import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors apps/web's setup, minus what this app does not have: no React, no
 * browser suite, no Playwright. Tests live beside the code they cover.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      // `server-only` throws by design outside a server component, which is
      // exactly what stops a server module being unit-tested.
      { find: "server-only", replacement: resolve(root, "../../packages/config/test-stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
