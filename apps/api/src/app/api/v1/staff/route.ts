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

import { listStaff } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/staff` — the bookable roster.
 *
 * Not logins, not accounts and not the seller's colleagues. A staff resource is
 * a name a buyer can pick when booking, and it grants nobody access to
 * anything; the people who can actually sign in to a shop are organisation
 * members, which this API does not describe at all.
 *
 * Omitting `active` returns both, because somebody stood down keeps their name
 * on the appointments already against them — which is exactly why taking
 * somebody off a roster deactivates them rather than deleting them.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) => {
    const active = url.searchParams.get("active");
    return listStaff(caller, {
      ...options,
      active: active === null ? null : active === "true",
    });
  });
}
