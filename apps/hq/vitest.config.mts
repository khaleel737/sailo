import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests live beside the code they cover.
 *
 * Deliberately narrower than apps/web's config, which also wires a setup file
 * and a raised timeout for five suites that cold-load a module graph after
 * `vi.resetModules()`. Nothing here does that yet. Add them when something
 * does, rather than copying configuration whose reasons this app has not met.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      /*
       * `server-only` throws by design outside a server component, which is
       * exactly what stops a server module being unit-tested.
       */
      { find: "server-only", replacement: resolve(root, "test-stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
