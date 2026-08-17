import { listOrders } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/orders` — newest first, keyset-paged.
 *
 * Filters are the three questions an integration actually asks: which stage
 * the order is at, whether the money arrived, and "everything this customer
 * has ever bought". Anything more expressive belongs in a query language, and
 * a query language is not something a Zapier step can send.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listOrders(caller, {
      ...options,
      status: url.searchParams.get("status"),
      paymentStatus: url.searchParams.get("payment_status"),
      email: url.searchParams.get("email"),
    }),
  );
}
