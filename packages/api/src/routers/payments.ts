import { router } from "../trpc";

/**
 * Reserved seam — no procedures yet.
 *
 * The seller's payment rails and their Stripe Connect link. Filled by the
 * payments/uploads/account work order, which owns this file exclusively.
 *
 * See `./analytics.ts` for why an empty router is committed rather than left
 * for the next agent to create.
 */
export const paymentsRouter = router({});
