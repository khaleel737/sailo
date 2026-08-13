import type { NextConfig } from "next";

/**
 * The API app: route handlers and nothing else.
 *
 * No `cacheComponents`, no image pipeline, no CSP — apps/web has all of that
 * because apps/web serves pages to browsers. This app serves JSON to the
 * mobile client and to machines, so the only thing it needs from Next is the
 * router and the Node runtime underneath it.
 */
const nextConfig: NextConfig = {
  /*
   * The workspace packages ship TypeScript source rather than built output
   * (`exports` points straight at `./src/index.ts`), so Next has to compile
   * them itself.
   *
   * This is the transitive closure of what this app actually imports — the
   * four it depends on directly plus what those pull in — and not a superset.
   * The list used to name `@sailo/mcp` and `@sailo/rest` as "skeletons that
   * are still empty"; no such packages exist, which made the comment above it
   * the only record of a plan that was never built. A package missing from
   * here fails at build time with an import error that reads like a bug in the
   * package, so add to it when a dependency is added — not before.
   */
  transpilePackages: [
    "@sailo/api",
    "@sailo/db",
    "@sailo/env",
    "@sailo/events",
    "@sailo/observability",
    "@sailo/rate-limit",
  ],
};

export default nextConfig;
