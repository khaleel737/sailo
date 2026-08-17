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

import { listOrders } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/orders` — newest first, keyset-paged.
 *
 * Filters are the three questions an integration actually asks: which stage
 * the order is at, whether the money arrived, and "everything this customer
 * has ever bought". Anything more expressive belongs in a query language, and
 * a query language is not something a Zapier step can send.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listOrders(caller, {
      ...options,
      status: url.searchParams.get("status"),
      paymentStatus: url.searchParams.get("payment_status"),
      email: url.searchParams.get("email"),
    }),
  );
}
