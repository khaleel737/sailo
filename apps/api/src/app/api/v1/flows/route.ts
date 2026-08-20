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

import { listFlows } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/flows` — the shop's automations.
 *
 * `kind` defaults to `email` rather than to everything, matching what the
 * admin lists. An email flow is a sequence a seller drew; a scenario is a
 * one-step rule wired to an outside app. Folding them into one unfiltered page
 * would hand a consumer a count of "my flows" the seller has never seen.
 *
 * No run tallies here — counting live runs is a query against a table that
 * grows with every contact who ever entered a flow, and a page of twenty-five
 * should not pay it. `GET /flows/{id}` carries them for the one flow somebody
 * is actually looking at.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listFlows(caller, {
      ...options,
      status: url.searchParams.get("status"),
      kind: url.searchParams.get("kind"),
    }),
  );
}
