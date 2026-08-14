/**
 * Plans, now in `@sailo/core/plans`.
 *
 * Kept as a re-export rather than deleted: some fifty modules in this app
 * import `@/lib/plans`, and rewriting every one of them would have put a
 * fifty-file diff in front of a move that changes no behaviour. The entitlement
 * rules themselves had to leave — `packages/api` clamps the analytics window
 * server-side for the mobile app and cannot reach into `apps/web` — and a
 * second copy that drifts would hand a phone a window its plan does not permit.
 */

export * from "@sailo/core/plans";
