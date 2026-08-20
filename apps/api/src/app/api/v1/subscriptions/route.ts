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

import { listSubscriptions } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/subscriptions` — memberships, newest first.
 *
 * The read the seven `subscription.*` webhooks have been firing without. An
 * event that carries an id into a system with no endpoint to resolve it is half
 * an integration, which is the sentence spec 16 opens with about webhooks
 * arriving somewhere that cannot look anything up.
 *
 * `product_id` and `contact_id` rather than `productId` and `clientId`: query
 * parameters are snake_case across this API even though the bodies are not,
 * because that is what every other filter here already is.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listSubscriptions(caller, {
      ...options,
      status: url.searchParams.get("status"),
      productId: url.searchParams.get("product_id"),
      contactId: url.searchParams.get("contact_id"),
    }),
  );
}
