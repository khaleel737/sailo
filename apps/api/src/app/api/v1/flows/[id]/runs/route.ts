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

import { listFlowRuns } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/flows/{id}/runs` — who walked this flow, and where they got to.
 *
 * The read that answers "why did this customer not get the email", which is
 * the question a seller brings to support and which nothing outside the
 * database could answer before.
 *
 * Ordered by when somebody entered the flow rather than by `created_at`,
 * because `automation_runs` has no such column — entering is the only moment
 * it records.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/flows/[id]/runs">,
) {
  const { id } = await params;
  return handleList(request, (caller, options, url) =>
    listFlowRuns(caller, id, {
      ...options,
      status: url.searchParams.get("status"),
      email: url.searchParams.get("email"),
    }),
  );
}
