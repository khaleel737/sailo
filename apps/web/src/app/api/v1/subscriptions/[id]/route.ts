import { getSubscription } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/subscriptions/{id}` — one membership.
 *
 * Identical to the `data` of every `subscription.*` event, so a field map built
 * against the webhook works here unchanged. The field to revoke access on is
 * `currentPeriodEnd` and never `canceledAt`: a member who cancelled has paid
 * through the end of the period and keeps what they bought until it.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/subscriptions/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getSubscription(caller, id));
}
