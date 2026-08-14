import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /*
   * `server-only` throws on import outside a React Server Component, and the
   * routers now reach packages that open with it — `@sailo/payments` for the
   * Connect link, `@sailo/account/deletion` for the deletion. Importing the
   * composed router in a plain Node test would fail on that alone, before a
   * single assertion ran, which is why `@sailo/payments`, `@sailo/account` and
   * `@sailo/events` each carry the same two lines.
   *
   * Only the *server* half of this package is affected. `client.ts` imports
   * the router as a type, which the compiler erases, so nothing here reaches
   * the mobile bundle.
   */
  resolve: {
    alias: [{ find: "server-only", replacement: resolve(root, "test-stubs/server-only.ts") }],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
