import { router } from "../trpc";

/**
 * Reserved seam — no procedures yet.
 *
 * Short-lived tokens the phone uses to put an image in Blob storage directly,
 * so a product photo never travels through this server. Filled by the
 * payments/uploads/account work order, which owns this file exclusively.
 *
 * See `./analytics.ts` for why an empty router is committed rather than left
 * for the next agent to create.
 */
export const uploadsRouter = router({});
