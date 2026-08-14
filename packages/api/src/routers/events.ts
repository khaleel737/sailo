import { router } from "../trpc";

/**
 * Reserved seam — no procedures yet.
 *
 * Bookable events: the classes and sessions a seller puts on a calendar, as
 * distinct from `orders`, which is what someone bought. Filled by the commerce
 * work order, which owns this file exclusively.
 *
 * Not to be confused with `@sailo/events`, the shop-event publisher the orders
 * router uses to wake other screens. Same word, different thing — this one is a
 * product the seller sells.
 *
 * See `./analytics.ts` for why an empty router is committed rather than left
 * for the next agent to create.
 */
export const eventsRouter = router({});
