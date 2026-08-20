import { getFlow } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/flows/{id}` — one automation, with how it is going.
 *
 * `runs` counts every contact who has ever entered, split by where they got
 * to. `live` is queued plus waiting — both are people still inside the flow,
 * and the only difference between them is whether a timer is running.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/flows/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getFlow(caller, id));
}
