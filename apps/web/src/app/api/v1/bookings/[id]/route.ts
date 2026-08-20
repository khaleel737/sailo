import { getBooking } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/bookings/{id}` — one appointment.
 *
 * A booking has no status because a released slot is a deleted claim: an order
 * that is cancelled or refunded gives the time back by removing the row. So an
 * appointment that answers here is one that still stands, and a 404 on an id
 * that worked yesterday is how a consumer learns it was dropped.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/bookings/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getBooking(caller, id));
}
