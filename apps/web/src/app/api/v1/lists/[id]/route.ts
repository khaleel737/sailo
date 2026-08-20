import { getList } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/lists/{id}` — one list.
 *
 * Read `doubleOptIn` before writing anything: on a list that asks for
 * confirmation, adding somebody produces a `pending` membership and no request
 * to this API will ever produce a subscriber.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/lists/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getList(caller, id));
}
