/*
 * Mounted on the API origin as well as on apps/web.
 *
 * ─── WHY THIS IS A DUAL MOUNT AND NOT A MOVE ───────────────────────────────
 * `/api/v1` is a published contract. Integrators, Zapier steps and shell
 * scripts hold the web origin in configuration we cannot edit, so relocating
 * outright would 404 every one of them at a moment of our choosing rather than
 * theirs. Both origins answer identically until the seller-facing docs and the
 * integrators have moved, and `apps/web/src/lib/rest-contract.test.ts` walks
 * *both* trees so a route added to one and not the other fails.
 *
 * Safe to mount twice for the reason `partner/events` is: this route
 * authenticates from an `Authorization` API key, never from the better-auth
 * session cookie. A second origin therefore cannot force `SameSite=None` on a
 * session — there is no session on this path to loosen.
 *
 * The handler itself is `@sailo/api/rest`, imported by both. There is no second
 * implementation here to drift; this file is the mount, not the logic.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { listBookings } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/bookings` — the diary, for a calendar that is not ours.
 *
 * Newest-booked first like every other list here, with `from`/`to` for the date
 * range. The two questions a calendar integration asks are "what has been
 * booked since I last looked", which is this order, and "what is in the diary
 * next week", which is the window — and answering both without a second cursor
 * implementation is worth more than rows a consumer can sort in one line.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listBookings(caller, {
      ...options,
      productId: url.searchParams.get("product_id"),
      staffId: url.searchParams.get("staff_id"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    }),
  );
}
