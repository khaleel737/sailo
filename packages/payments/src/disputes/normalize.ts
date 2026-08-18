import type Stripe from "stripe";
import { fundsWithdrawn, isInquiry } from "@sailo/core/disputes";

/**
 * Reading a Stripe dispute into the handful of facts Sailo stores.
 *
 * Pure and vendor-shaped: the one place in the codebase that knows where Stripe
 * puts a network reason code. Everything downstream — the rate, the escalation,
 * the seller's panel — reads the flat record this produces, so a Stripe response
 * shape only ever moves in this file.
 *
 * No database, no clock. Verified against live test-mode responses on
 * 17 August 2026 rather than the docs, because two of the fields are not where
 * the docs suggest and one of them (`case_type`) is absent entirely on non-card
 * disputes.
 */

export type NormalizedDispute = {
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  amountCents: number;
  currency: string;
  feeCents: number;
  deductedCents: number;
  reason: string;
  networkReasonCode: string | null;
  network: string | null;
  caseType: string | null;
  status: string;
  dueBy: Date | null;
  submissionCount: number;
  hasEvidence: boolean;
  enhancedEligibility: Record<string, unknown> | null;
  enhancedEligibilityTypes: readonly string[];
  stripeCreatedAt: Date;
  /** True when the money is out of the balance as at this snapshot. */
  fundsOut: boolean;
  /** True when this is a retrieval request rather than a chargeback. */
  inquiry: boolean;
};

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The money that actually left, read from the balance transactions.
 *
 * Not `dispute.amount`. Verified in test mode against a $42 direct charge on a
 * connected account: the dispute reports `amount: 4200`, and its single balance
 * transaction reports `amount: -4200`, `fee: 1500` (`fee_details[0].description
 * = "Dispute fee"`) and `net: -5700`. The seller lost $57, not $42, and a
 * seller's panel that shows $42 is understating their loss by 36%.
 *
 * Summed across the list rather than read from `balance_transaction`, because a
 * dispute that is withdrawn and then reinstated carries both movements and the
 * net of the pair is the truth. An inquiry carries none at all, so this returns
 * zero — which is the correct answer and the one the first version of the
 * webhook handler got wrong by assuming a debit had happened.
 */
export function deductionOf(dispute: Stripe.Dispute): {
  feeCents: number;
  deductedCents: number;
} {
  const transactions = dispute.balance_transactions ?? [];
  if (transactions.length === 0) return { feeCents: 0, deductedCents: 0 };

  let fee = 0;
  let net = 0;
  for (const txn of transactions) {
    /*
     * Only the dispute fee, not every fee on the transaction. `fee` on a
     * reinstatement is a refund of the dispute fee and arrives negative, so
     * summing the raw field across both movements is right and picking
     * `transactions[0].fee` is not.
     */
    fee += txn.fee ?? 0;
    net += txn.net ?? 0;
  }

  /*
   * Reported positive. `net` is negative on a withdrawal because it is a
   * movement, and "deducted: -5700" reads as money returned on every surface
   * that shows it. A reinstated dispute nets to zero, which is exactly right.
   */
  return { feeCents: Math.abs(fee), deductedCents: Math.max(0, -net) };
}

export function normalizeDispute(dispute: Stripe.Dispute): NormalizedDispute {
  /*
   * `payment_method_details.card` is where the network's own verdict lives, and
   * it is absent on every non-card dispute — a SEPA return has
   * `payment_method_details.type = "sepa_debit"` and no card object at all. So
   * this is read defensively rather than asserted: reaching through it would
   * throw on the one dispute shape a seller can do nothing about.
   */
  const card = dispute.payment_method_details?.card;
  const { feeCents, deductedCents } = deductionOf(dispute);
  const details = dispute.evidence_details;

  return {
    stripeDisputeId: dispute.id,
    stripeChargeId: idOf(dispute.charge),
    stripePaymentIntentId: idOf(dispute.payment_intent),
    amountCents: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    feeCents,
    deductedCents,
    reason: dispute.reason,
    networkReasonCode: card?.network_reason_code ?? null,
    network: card?.network ?? dispute.payment_method_details?.type ?? null,
    caseType: card?.case_type ?? null,
    status: dispute.status,
    /*
     * Stripe sends epoch seconds. `new Date(1786924799)` is 1970 and would put
     * every dispute deadline fifty-six years in the past — which reads as "past
     * due" on every surface and would have the seller's panel telling them a
     * live case was already lost.
     */
    dueBy: details?.due_by ? new Date(details.due_by * 1000) : null,
    submissionCount: details?.submission_count ?? 0,
    hasEvidence: Boolean(details?.has_evidence),
    enhancedEligibility:
      (details?.enhanced_eligibility as Record<string, unknown> | undefined) ?? null,
    enhancedEligibilityTypes: dispute.enhanced_eligibility_types ?? [],
    stripeCreatedAt: new Date(dispute.created * 1000),
    /*
     * Derived from the status rather than from `balance_transactions`, because
     * the two disagree in a way that matters: a chargeback's `created` webhook
     * can arrive before its balance transaction is attached, so an empty list
     * is not proof the money is still there. The status is authoritative and
     * arrives complete. `deductedCents` catches up on the next event.
     */
    fundsOut: fundsWithdrawn(dispute.status),
    inquiry: isInquiry(dispute.status),
  };
}
