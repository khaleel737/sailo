import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The vitest setup every package shares.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED
 *
 * A package whose modules carry `server-only` cannot unit-test them without
 * aliasing it away — the real package throws on import outside a React Server
 * Component, which is the whole point of it. That alias was copied into
 * `@sailo/commerce` with its own stub file, and then eight more packages grew
 * server modules. Eight copies of a two-line alias is eight chances for one of
 * them to be missing, and the failure is not subtle but it is confusing: a test
 * suite that reports `This module cannot be imported from a Client Component
 * module` and looks like a code problem.
 *
 * Extend it per package and add only what that package genuinely needs:
 *
 *   import { sailoTest } from "@sailo/config/vitest";
 *   export default sailoTest();
 */
export function sailoTest(extra: UserConfig = {}) {
  return defineConfig({
    ...extra,
    resolve: {
      ...extra.resolve,
      alias: [
        { find: "server-only", replacement: resolve(here, "test-stubs/server-only.ts") },
        ...(Array.isArray(extra.resolve?.alias) ? extra.resolve.alias : []),
      ],
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      ...extra.test,
    },
  });
}
