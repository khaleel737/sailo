import { getStaff } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/staff/{id}` — one person on the roster.
 *
 * `timeZone` null means the shop's own zone rather than UTC, and it is the zone
 * this person's appointments should be read in.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/staff/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getStaff(caller, id));
}
