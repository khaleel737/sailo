import "server-only";

/**
 * Dashboard figures, now in `@sailo/analytics`.
 *
 * The queries themselves left this app because the phone's Insights tab draws
 * the same panels over the same window — see the note at the top of that
 * package. What stays here is the `server-only` marker above, and it stays on
 * purpose: this is the module a client component in `apps/web` would reach for
 * by mistake, and the marker turns that mistake into a build error instead of
 * a bundle carrying drizzle and a database URL. `packages/api` has no client
 * boundary to protect, so the guard belongs on this side rather than in the
 * package.
 *
 * Re-exported rather than deleted because `@/lib/queries` is a barrel: every
 * caller says `from "@/lib/queries"` and none of them should have to know that
 * one of the files behind it moved.
 */

export * from "@sailo/analytics/queries";
