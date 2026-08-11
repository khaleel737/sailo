import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: "server-only", replacement: resolve(root, "test-stubs/server-only.ts") }],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
