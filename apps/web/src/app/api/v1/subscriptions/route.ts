import { listSubscriptions } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/subscriptions` — memberships, newest first.
 *
 * The read the seven `subscription.*` webhooks have been firing without. An
 * event that carries an id into a system with no endpoint to resolve it is half
 * an integration, which is the sentence spec 16 opens with about webhooks
 * arriving somewhere that cannot look anything up.
 *
 * `product_id` and `contact_id` rather than `productId` and `clientId`: query
 * parameters are snake_case across this API even though the bodies are not,
 * because that is what every other filter here already is.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listSubscriptions(caller, {
      ...options,
      status: url.searchParams.get("status"),
      productId: url.searchParams.get("product_id"),
      contactId: url.searchParams.get("contact_id"),
    }),
  );
}
