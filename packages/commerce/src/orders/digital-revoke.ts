import "server-only";
import { revokeCodesForOrder } from "../catalog/code-pool";
import { disableLicensesForOrder } from "./licenses";

/**
 * What a refunded or cancelled order stops being entitled to, on the digital
 * side — spec 48.
 *
 * The sibling of `voidTicketsForOrder`, and it sits beside it at both call
 * sites for the same reason: money given back for a string has to stop that
 * string working, whatever the seller decided about the shelf. Tying it to the
 * *restock* decision would be the guard-at-one-sink shape — a seller who
 * declines to restock a damaged item would also, silently, leave the licence
 * key live.
 *
 * **A revoked code is never returned to the pool.** A key the buyer has
 * already seen is spent whatever happens next: they may have redeemed it, sold
 * it or pasted it in a forum, and none of that is visible from here. The
 * count is what the restock path subtracts from the units it puts back, so a
 * seller sees the shortfall and can top up rather than overselling into a pool
 * that is emptier than the stock number says.
 *
 * Both halves are idempotent — `revoked_at IS NULL` and `status = 'active'` —
 * so a seller cancelling an order that was already refunded revokes nothing
 * twice, which is what keeps that subtraction from being applied twice.
 */
export async function revokeDigitalGoodsForOrder(
  orderId: string,
): Promise<{ codes: number; licenses: number }> {
  const [codes, licenses] = await Promise.all([
    revokeCodesForOrder(orderId),
    disableLicensesForOrder(orderId),
  ]);
  return { codes, licenses };
}
