import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The end-to-end suite: every route driven through its real handler.
 *
 * Separate from `vitest.config.mts` so the unit run stays fast and this is asked
 * for explicitly — `pnpm test:e2e`. The two configs share the aliases, because
 * a route imports `@/lib/context` the same way whichever suite is running.
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
    include: ["e2e/**/*.e2e.ts"],
    /*
     * Thirty seconds, for the same reason `apps/web/vitest.config.mts` raises
     * its own: these tests import a route, and importing a route cold-loads its
     * whole module graph — the tRPC router, every domain package behind it, and
     * a better-auth instance that opens a connection to resolve a session.
     *
     * The default five seconds was enough until `@sailo/api/rest` joined that
     * graph, at which point the unauthenticated-call test began failing on a
     * timeout rather than an assertion. A timeout reads as "authorisation is
     * broken" until you look at it, which is the worst way for a suite to be
     * wrong. Nothing here measures elapsed time, so a generous ceiling costs
     * only how long a genuine hang takes to report.
     */
    testTimeout: 30_000,
  },
});
