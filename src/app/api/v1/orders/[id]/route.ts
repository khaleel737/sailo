import { getOrder } from "@/lib/api/handlers";
import { handleOne } from "@/lib/api/route";

/**
 * `GET /api/v1/orders/{id}` — one order, with its line items.
 *
 * The follow-up call a webhook makes possible: `order.paid` arrives with the
 * order id, and this is how a consumer that stored only the id fetches the
 * rest. The body is identical to the webhook's `data`, so the same field map
 * works against both.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/orders/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getOrder(caller, id));
}
