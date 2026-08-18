import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * One suite, and it is the reason this app has a test script at all.
 *
 * `src/lib/contract.test.ts` walks the real `/api/v1` route trees in apps/web
 * and apps/api and demands that the reference describes exactly what they
 * serve. It is a documentation gate rather than a unit test: nothing in this
 * app has behaviour to cover, and the one failure worth catching — an endpoint
 * shipping undocumented — is invisible to every other check in the repository.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(root, "src/$1") },
      /*
       * `server-only` throws by design outside a server component, which is
       * exactly what stops a server module being unit-tested. `@sailo/api/mcp`
       * imports it — the tool list carries the handlers that read the database
       * — and the reference renders that same list.
       */
      { find: "server-only", replacement: resolve(root, "test-stubs/server-only.ts") },
    ],
  },
  /*
   * The reference components are `.tsx`, and the tsconfig this app shares with
   * its siblings sets `jsx: "preserve"` because Next compiles JSX itself.
   * Vite's transformer honours that and hands vitest untransformed JSX, which
   * fails as a syntax error in the importer rather than as anything that names
   * the cause. So the transform is set here — the one place this app's test
   * runner has to disagree with its build tool.
   *
   * `oxc` rather than `esbuild`: Vite 7 transforms with oxc, and setting both
   * makes it warn and ignore the esbuild half.
   */
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
