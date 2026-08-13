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
   * them itself. Every `@sailo/*` this app declares a dependency on is listed,
   * including the five skeletons that are still empty — a package added to
   * this list before it has code costs nothing, and a package missing from it
   * fails at build time with an import error that reads like a bug in the
   * package rather than a line missing from here.
   */
  transpilePackages: [
    "@sailo/api",
    "@sailo/auth",
    "@sailo/core",
    "@sailo/db",
    "@sailo/events",
    "@sailo/mcp",
    "@sailo/observability",
    "@sailo/payments",
    "@sailo/rate-limit",
    "@sailo/rest",
  ],
};

export default nextConfig;
