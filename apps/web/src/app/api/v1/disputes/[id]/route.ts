import { getDispute } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/disputes/{id}` — one chargeback.
 *
 * `caseType` is the field worth branching on: an `inquiry` is the issuer asking
 * a question on the cardholder's behalf and no money has moved, while a
 * `chargeback` has already taken the amount *and* the fee out of the seller's
 * balance. Calling either one a refund is wrong in a way that matters — the
 * money left by a different route, and it may come back.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/disputes/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getDispute(caller, id));
}
