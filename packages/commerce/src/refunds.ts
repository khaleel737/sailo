import "server-only";
import type { Order } from "@sailo/db/schema";
import { refundCharge } from "@sailo/payments";
import { toStripeAmount } from "@sailo/core/currency";
import { isPaymentMethodType, type PaymentMethodType } from "@sailo/payments/rails";

/**
 * Giving money back, by the rail that took it.
 *
 * An order records which rail it was paid on, so a refund asks that rail to
 * reverse itself rather than assuming Stripe. Most of Sailo's rails can't:
 * a WhatsApp handoff or a bank transfer settles between two people and the
 * seller hands the money back the same way they received it. Card is the one
 * that moves on its own, and Paystack or Flutterwave would slot in beside it
 * as another entry in the table below.
 *
 * The distinction matters to what the seller is told. "Refunded to their card"
 * and "pay them back yourself" are different instructions, and getting them the
 * wrong way round means either a buyer who is never paid or a buyer who is paid
 * twice.
 */

export type RefundOutcome =
  /** Money actually moved. `reference` is the processor's own id for it. */
  | { kind: "reversed"; reference: string }
  /** Nothing to reverse — the seller settles it themselves. */
  | { kind: "manual"; reason: "off_platform" | "never_charged" };

type Reverser = (order: Order, amountCents: number) => Promise<RefundOutcome>;

/**
 * Only rails that can move money on their own appear here. Anything absent is
 * settled by hand, which is the honest default: adding a rail without teaching
 * it to reverse should mean "we can't do this for you", never a silent success.
 */
const REVERSERS: Partial<Record<PaymentMethodType, Reverser>> = {
  card: async (order, amountCents) => {
    /*
     * A card order with no payment intent never completed at Stripe — the
     * buyer picked card and abandoned the checkout, or paid another way. There
     * is no charge to reverse, and pretending otherwise would tell the seller
     * money had gone back when none had.
     */
    if (!order.stripePaymentIntentId || !order.stripeAccountId) {
      return { kind: "manual", reason: "never_charged" };
    }

    /*
     * Snap to what the currency can actually settle.
     *
     * The charge was rounded to `chargeStep` on the way out; the refund has to
     * be too. In the three-decimal currencies — KWD, BHD, JOD, OMR, TND — card
     * networks settle to two places, so Stripe refuses any amount that is not
     * a multiple of ten rather than rounding it. The seller types a partial
     * refund into a form, so the request is arbitrary: without this, a partial
     * refund in Kuwait fails at the processor with an error naming a field the
     * seller never filled in.
     *
     * Everywhere else `chargeStep` is 1 and this is the identity.
     */
    const settleable = toStripeAmount(amountCents, order.currency);

    const refund = await refundCharge({
      accountId: order.stripeAccountId,
      paymentIntentId: order.stripePaymentIntentId,
      amountCents: settleable,
    });

    return { kind: "reversed", reference: refund.id };
  },
};

/** True when this order's rail can give the money back without a human. */
/**
 * How much of an order is still refundable.
 *
 * `refundedCents` accumulates, so the ceiling is what is left rather than the
 * order total. Checking against the total lets a seller refund $50 of a $100
 * order twice: the processor moves $100 — each half is within the original
 * charge, so nothing rejects it — while the column, being assigned rather
 * than added to, still reads $50. The seller's revenue, their dashboard and
 * both CSV exports then under-report the refund by half, and no screen shows
 * the discrepancy.
 */
export function refundableCents(order: {
  totalCents: number;
  refundedCents: number;
}): number {
  return Math.max(0, order.totalCents - order.refundedCents);
}

export type RefundCheck =
  | { ok: true; amountCents: number; refundedTotal: number; isFull: boolean }
  | { ok: false; reason: "not_positive" | "exceeds_remaining"; remaining: number };

/** Validates a requested refund against what the order has left. */
export function checkRefund(
  order: { totalCents: number; refundedCents: number },
  requestedCents: number,
): RefundCheck {
  const remaining = refundableCents(order);
  if (requestedCents <= 0) {
    return { ok: false, reason: "not_positive", remaining };
  }
  if (requestedCents > remaining) {
    return { ok: false, reason: "exceeds_remaining", remaining };
  }

  const refundedTotal = order.refundedCents + requestedCents;
  return {
    ok: true,
    amountCents: requestedCents,
    refundedTotal,
    // Full once nothing is left, not once one refund matches the total —
    // two halves make an order fully refunded just as one whole does.
    isFull: refundedTotal >= order.totalCents,
  };
}

export function canReverse(order: Pick<Order, "paymentMethod">): boolean {
  return (
    isPaymentMethodType(order.paymentMethod) &&
    order.paymentMethod in REVERSERS
  );
}

/**
 * Reverses a payment on whichever rail took it.
 *
 * Throws if the processor refuses — the caller must not record a refund that
 * didn't happen.
 */
export async function reversePayment(
  order: Order,
  amountCents: number,
): Promise<RefundOutcome> {
  if (!isPaymentMethodType(order.paymentMethod)) {
    return { kind: "manual", reason: "off_platform" };
  }

  const reverse = REVERSERS[order.paymentMethod];
  if (!reverse) return { kind: "manual", reason: "off_platform" };

  return reverse(order, amountCents);
}
