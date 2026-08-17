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
  test: { environment: "node", include: ["e2e/**/*.e2e.ts"] },
});
