import { listDisputes } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/disputes` — chargebacks against this shop's sales.
 *
 * The reason to read these over an API is the clock. A chargeback allows about
 * twenty days to respond and the evidence that answers it usually lives in a
 * system that is not Sailo — a helpdesk, a fulfilment tool, a shipping account
 * — so this is what lets a seller's own tooling go and fetch it in time.
 *
 * There is no `scope` filter here and there is not going to be one: a platform
 * dispute is a seller charging back their own Sailo subscription, and the
 * handler puts `connected` in the WHERE so that never reaches this surface.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listDisputes(caller, {
      ...options,
      status: url.searchParams.get("status"),
      orderId: url.searchParams.get("order_id"),
    }),
  );
}
