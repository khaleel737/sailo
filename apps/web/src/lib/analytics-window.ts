/**
 * The analytics window rules, now in `@sailo/analytics`.
 *
 * They travelled with the queries they clamp: `resolveAnalyticsWindow` is the
 * plan gate, and the mobile router has to apply exactly the same one to a
 * hand-typed tRPC input that this app applies to a hand-typed `?from=`. Left
 * here, the phone would have needed its own — and a clamp written twice is a
 * clamp that is only enforced once.
 *
 * Its signature did not change: it still takes the shop and asks
 * `analyticsLimit` itself, so no caller in this app moved.
 */

export * from "@sailo/analytics/window";
