import { vi } from "vitest";
import type * as nextCache from "next/cache";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/*
 * `cacheLife()` and `cacheTag()` refuse to run unless Next's `cacheComponents`
 * flag is on, and vitest does not load `next.config.ts`. They are build-time
 * declarations with no behaviour a unit test could assert, so they become
 * no-ops here — the alternative is every module that caches a read being
 * untestable, which is most of them.
 *
 * `use cache` itself needs no stub: it is a directive the bundler acts on, and
 * an ordinary function call under vitest.
 */
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof nextCache>()),
  cacheLife: () => {},
  cacheTag: () => {},
}));
