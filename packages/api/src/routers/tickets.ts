import { router } from "../trpc";

/**
 * Reserved seam — no procedures yet.
 *
 * The tickets issued against a booking, and the check-in that burns one. Filled
 * by the commerce work order; the scanner work order reads from it.
 *
 * See `./analytics.ts` for why an empty router is committed rather than left
 * for the next agent to create.
 */
export const ticketsRouter = router({});
