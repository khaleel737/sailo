import { router } from "../trpc";

/**
 * Reserved seam — no procedures yet.
 *
 * The shop's own numbers: views, orders over time, the top products. Filled by
 * the analytics work order, which owns this file exclusively.
 *
 * It is committed empty on purpose. The composition root in `../router.ts`
 * already names it, so the agent that fills it adds procedures here and touches
 * nothing else — which is the whole reason the router was split. An empty
 * `router({})` contributes an empty namespace to `AppRouter` and no routes at
 * all, so nothing is reachable until something is written.
 */
export const analyticsRouter = router({});
