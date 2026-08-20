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

import { listDisputes } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/disputes` — chargebacks against this shop's sales.
 *
 * The reason to read these over an API is the clock. A chargeback allows about
 * twenty days to respond and the evidence that answers it usually lives in a
 * system that is not Sailo — a helpdesk, a fulfilment tool, a shipping account
 * — so this is what lets a seller's own tooling go and fetch it in time.
 *
 * There is no `scope` filter here and there is not going to be one: a platform
 * dispute is a seller charging back their own Sailo subscription, and the
 * handler puts `connected` in the WHERE so that never reaches this surface.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listDisputes(caller, {
      ...options,
      status: url.searchParams.get("status"),
      orderId: url.searchParams.get("order_id"),
    }),
  );
}
