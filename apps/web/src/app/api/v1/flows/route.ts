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
