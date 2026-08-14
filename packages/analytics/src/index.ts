/**
 * The shop's own numbers, as both apps read them.
 *
 * Visits, revenue, traffic sources and the per-product table were
 * `apps/web/src/lib/queries/analytics.ts` while the admin dashboard was the
 * only thing that drew them. The Insights tab on the phone draws the same four
 * panels from the same window, so the queries moved here rather than being
 * written a second time against the same tables — two versions of "revenue in
 * this window" disagree the first time one of them learns what a refund is,
 * and the seller has no way to tell which screen is lying.
 *
 * The window rules travel with the queries deliberately. `resolveAnalyticsWindow`
 * is the plan gate: it decides how far back a caller may read, and it is the
 * only thing standing between a hand-typed range and three years of history on
 * a free plan. Shipping the queries without it would have left each caller to
 * remember the clamp.
 *
 * Unlike @sailo/commerce this package does **not** import `server-only`. It is
 * reached from two places — `apps/web`, where a client component could plausibly
 * import it by mistake, and `packages/api`, which serves route handlers and has
 * no client boundary at all. The guard therefore sits on the web side, in
 * `apps/web/src/lib/queries/analytics.ts`, which is exactly where the mistake
 * it prevents can be made. Putting it here instead would only have broken
 * `packages/api`'s own test run, which is not a bundle.
 */

export * from "./queries";
export * from "./analytics-window";
export * from "./product-performance";
