/**
 * Handle rules, now in `@sailo/core/handle`.
 *
 * Kept as a re-export rather than deleted: the onboarding form, the shared
 * handle field and the shop actions all import `@/lib/handle`, and the rules
 * themselves had to leave — `packages/api` validates a handle for the mobile
 * sign-up flow and cannot reach into `apps/web`. A second copy of
 * `RESERVED_HANDLES` is the one that drifts, and the failure it produces is a
 * seller claiming a name that shadows a live route: the handle validates, the
 * shop saves, and the storefront silently never renders.
 *
 * The route-collision guard stayed behind in `handle-routes.test.ts`, because
 * it reads this app's `src/app` and there is no route tree in a package.
 */

export * from "@sailo/core/handle";
