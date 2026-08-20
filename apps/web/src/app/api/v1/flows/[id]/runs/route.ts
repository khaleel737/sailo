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
