/* What a card dispute is, and what it has already done to the money. */

/**
 * Every status Stripe reports on a dispute.
 *
 * Read off `stripe@22.5.0`'s own union rather than the docs page, because the
 * docs page omits `prevented` — the status a dispute lands in when a
 * deflection service (Visa Order Insight / RDR, Ethoca) resolved it before it
 * became a chargeback. A shape we do not know about is a shape that renders as
 * whatever is first in a `<select>`, which is exactly how `disputed` came to
 * display as "Unpaid" (see `payment-status.ts`).
 */
export const DISPUTE_STATUSES = [
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "won",
  "lost",
  "prevented",
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export function isDisputeStatus(value: string): value is DisputeStatus {
  return (DISPUTE_STATUSES as readonly string[]).includes(value);
}

/**
 * `payment_method_details.card.case_type`, which is the field that decides
 * whether any of this costs the seller anything.
 *
 * `inquiry` and `chargeback` are the two that arrive in practice. The others
 * are in Stripe's union and are carried here so an unfamiliar one is handled
 * rather than crashed on: `compliance` is a network rules case (Visa charges
 * $500 to contest one — see `visa_compliance.fee_acknowledged`), `block` and
 * `resolution` are deflection outcomes.
 */
export const DISPUTE_CASE_TYPES = [
  "inquiry",
  "chargeback",
  "compliance",
  "block",
  "resolution",
] as const;

export type DisputeCaseType = (typeof DISPUTE_CASE_TYPES)[number];

/**
 * Whether this is a retrieval request rather than a chargeback.
 *
 * **The single most consequential distinction in this file, and the one the
 * first version of the webhook handler got wrong.**
 *
 * `charge.dispute.created` fires for both. An inquiry — Visa calls it a
 * retrieval request, Mastercard a retrieval — is the issuer asking a question
 * on the cardholder's behalf. Measured against the API in test mode
 * (`pm_card_createDisputeInquiry`), an inquiry arrives with
 * `balance_transactions: []` and `is_charge_refundable: true`: **no money has
 * moved.** A chargeback (`pm_card_createDispute`) arrives with one balance
 * transaction of `net: -5700` on a $42 charge — the amount plus a $15 dispute
 * fee — and `is_charge_refundable: false`.
 *
 * Three things followed from treating them alike:
 *
 * 1. An inquiry marked the order `disputed`, telling the seller money had left
 *    their balance when none had.
 * 2. `warning_closed` — an inquiry that closed with no chargeback behind it,
 *    which is the *good* outcome — took the `lost` branch, because that branch
 *    was `status !== "won"`. The order was marked `refunded`, the stock went
 *    back on the shelf and the affiliate's commission was reversed, on a sale
 *    the seller had been paid for and still held.
 * 3. Counted into a dispute ratio, inquiries inflate it. Neither Visa's VAMP
 *    nor Mastercard's MMP counts them, so a rate that does is not the rate we
 *    are measured on — see `rate.ts`.
 *
 * The status prefix is the test rather than `case_type`, because the status is
 * the field Stripe always populates: `case_type` lives under
 * `payment_method_details.card` and is absent on every non-card dispute.
 */
export function isInquiry(status: string): boolean {
  return status.startsWith("warning_");
}

/**
 * Whether the money is out of the seller's balance *right now*.
 *
 * True from the moment a chargeback is created — Stripe debits on arrival,
 * before anybody decides who is right — and stays true while it is under
 * review and if it is lost. False for an inquiry, which debits nothing, and
 * false once a dispute is won, because winning reinstates the funds.
 *
 * `prevented` is false: the dispute was resolved by deflection before it
 * became a chargeback, so there was never a debit.
 */
export function fundsWithdrawn(status: string): boolean {
  return (
    status === "needs_response" || status === "under_review" || status === "lost"
  );
}

/** Whether the deadline still matters: evidence can be submitted. */
export function needsResponse(status: string): boolean {
  return status === "needs_response" || status === "warning_needs_response";
}

/** Decided. Nothing further to send and no deadline left to miss. */
export function isClosed(status: string): boolean {
  return (
    status === "won" ||
    status === "lost" ||
    status === "warning_closed" ||
    status === "prevented"
  );
}

/**
 * What the seller should be told happened, in four words the UI can colour.
 *
 * Deliberately not a re-labelling of Stripe's eight statuses one-for-one. A
 * seller does not need to distinguish `warning_under_review` from
 * `under_review`; they need to know whether they owe a response, whether their
 * money is gone, and whether it is over.
 */
export type DisputeOutcome =
  | "needs_evidence"
  | "under_review"
  | "won"
  | "lost"
  | "closed_no_loss";

export function disputeOutcome(status: string): DisputeOutcome {
  if (needsResponse(status)) return "needs_evidence";
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  /*
   * An inquiry that closed, or one a deflection service resolved. The seller
   * kept the money and owes nothing further — which is why this is its own
   * outcome and not `won`: nothing was won, because nothing was taken. Calling
   * it `won` would have it counted in a win rate whose denominator never
   * included it.
   */
  if (status === "warning_closed" || status === "prevented") {
    return "closed_no_loss";
  }
  return "under_review";
}

/** One tone per outcome, so HQ and the seller's panel colour them alike. */
export const DISPUTE_OUTCOME_TONES = {
  needs_evidence: "amber",
  under_review: "neutral",
  won: "green",
  lost: "red",
  closed_no_loss: "green",
} as const satisfies Record<DisputeOutcome, string>;

/**
 * Whether a status change may be applied.
 *
 * Stripe delivers webhooks at least once and in no guaranteed order, so a
 * `charge.dispute.updated` carrying `needs_response` can arrive *after* the
 * `charge.dispute.closed` carrying `won` — the retry of an earlier delivery.
 * Applying it would reopen a decided dispute, put the deadline back on the
 * seller's dashboard and, through `fundsWithdrawn`, tell them money that had
 * been reinstated was gone again.
 *
 * A closed dispute therefore accepts nothing but another closed status, and
 * the event's own `created` timestamp is what orders two open ones.
 */
export function acceptsStatusChange(
  current: { status: string; stripeUpdatedAt: Date | null },
  incoming: { status: string; occurredAt: Date },
): boolean {
  if (current.status === incoming.status) return false;
  if (isClosed(current.status)) return isClosed(incoming.status);
  if (!current.stripeUpdatedAt) return true;
  /*
   * `>=` rather than `>`: `charge.dispute.created` and the
   * `charge.dispute.funds_withdrawn` that accompanies it share a second, and
   * dropping the second one would leave the deduction unrecorded.
   */
  return incoming.occurredAt.getTime() >= current.stripeUpdatedAt.getTime();
}

/**
 * How long is left to respond, in whole days, or null when nothing is owed.
 *
 * Rounded *down*, and that is not a cosmetic choice. Stripe's `due_by` is a
 * hard cut-off — evidence submitted a minute late is not submitted at all —
 * and a banker's-rounded "1 day left" shown to a seller with eleven hours is
 * the kind of help that loses the case. `0` means today.
 */
export function daysToRespond(
  dispute: { status: string; dueBy: Date | null },
  now: Date,
): number | null {
  if (!dispute.dueBy || !needsResponse(dispute.status)) return null;
  const ms = dispute.dueBy.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * The window in which a seller is nagged rather than merely informed.
 *
 * Seven days, because Stripe's own guidance is that evidence wants assembling
 * rather than typing, and because the shipping carrier a
 * `product_not_received` rebuttal depends on takes days to answer a proof-of-
 * delivery request. A reminder on the last day is a reminder about a case
 * already lost.
 */
export const RESPONSE_URGENT_DAYS = 7;

export function isUrgent(
  dispute: { status: string; dueBy: Date | null },
  now: Date,
): boolean {
  const days = daysToRespond(dispute, now);
  return days !== null && days <= RESPONSE_URGENT_DAYS;
}
