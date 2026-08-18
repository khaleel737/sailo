import "server-only";
import type Stripe from "stripe";
import {
  CE3_REQUIRED_PRIORS,
  type AssembledEvidence,
  type Ce3Submission,
} from "@sailo/core/disputes";
import { stripe } from "../stripe/client";
import { actingAs } from "../connect/accounts";
import { normalizeDispute, type NormalizedDispute } from "./normalize";

/**
 * Sending a dispute response to Stripe, on whichever account it belongs to.
 *
 * The account is the whole difficulty. A buyer's chargeback against a seller
 * lives on the seller's connected account and is invisible from the platform's
 * — `stripe.disputes.retrieve(id)` with no `Stripe-Account` header returns "No
 * such dispute", which reads exactly like a bad id and is the mistake that
 * makes a platform believe its evidence pipeline works when nothing has ever
 * been submitted. So every call here takes the account explicitly and
 * `actingAs` puts it on the request.
 */

export type SubmitResult =
  | { ok: true; dispute: NormalizedDispute }
  | { ok: false; error: string; code?: string };

/**
 * Whether Stripe will accept evidence at all.
 *
 * Checked before building anything, because the two refusals below are the
 * common ones and both produce an API error that names no field:
 *
 * - Past `due_by`. Stripe closes the window server-side and there is no
 *   override; a submission a minute late is not a submission.
 * - Already submitted. `submission_count > 0` with `submit: true` is refused —
 *   one response per dispute, and the second attempt loses the first.
 */
export function canSubmit(dispute: NormalizedDispute, now: Date): {
  allowed: boolean;
  why?: string;
} {
  if (dispute.status !== "needs_response" && dispute.status !== "warning_needs_response") {
    return { allowed: false, why: `Stripe is not accepting evidence: status is ${dispute.status}.` };
  }
  if (dispute.dueBy && dispute.dueBy.getTime() <= now.getTime()) {
    return { allowed: false, why: "The response deadline has passed." };
  }
  if (dispute.submissionCount > 0) {
    return {
      allowed: false,
      why: "Evidence has already been submitted. Stripe accepts one response per dispute.",
    };
  }
  return { allowed: true };
}

/**
 * A dispute, read from the account that owns it.
 *
 * `accountId` null means the platform's own — a seller charging back their Sailo
 * subscription — and is a real case rather than a default.
 */
export async function retrieveDispute(
  disputeId: string,
  accountId: string | null,
): Promise<NormalizedDispute | null> {
  try {
    const dispute = await stripe().disputes.retrieve(
      disputeId,
      /*
       * Expanded, because `balance_transactions` is where the deduction is and
       * it is not included by default on a retrieve. Without it the dispute
       * comes back looking like a $42 loss when $57 left the balance.
       */
      { expand: ["balance_transactions"] },
      actingAs(accountId),
    );
    return normalizeDispute(dispute);
  } catch {
    return null;
  }
}

/**
 * The charge id behind a payment intent, on the account that holds it.
 *
 * Needed because CE3.0's `prior_undisputed_transactions[].charge` wants a
 * `ch_…`, and `orders` stores a `pi_…`. The two are not interchangeable and
 * Stripe does not coerce: a payment intent id in that field is rejected, which
 * takes the whole `disputes.update` with it — so a CE3.0 submission built from
 * order rows alone fails every time, for a reason the error message does not
 * name.
 *
 * Resolved at dispute time rather than stored on the order. A column would mean
 * a migration and a backfill of every historical order, to hold a value that is
 * read at most twice per dispute — and disputes are rare enough that two API
 * calls cost nothing. `latest_charge` is the right field: a payment intent can
 * carry several charges across retries, and the one that settled is the one Visa
 * has a record of.
 */
export async function chargeIdForIntent(
  intentId: string,
  accountId: string | null,
): Promise<string | null> {
  try {
    const intent = await stripe().paymentIntents.retrieve(
      intentId,
      {},
      actingAs(accountId),
    );
    const latest = intent.latest_charge;
    if (!latest) return null;
    return typeof latest === "string" ? latest : latest.id;
  } catch {
    return null;
  }
}

/**
 * Submit the assembled evidence, and the CE3.0 payload when it qualifies.
 *
 * `submit: true` is the difference between saving a draft and answering the
 * case. Stripe accepts evidence without it and does nothing with it — a
 * platform that omits the flag has a pipeline that appears to work, a
 * `has_evidence: true` on every dispute, and a 0% win rate. It is passed
 * explicitly here so it cannot be forgotten by omission.
 */
export async function submitEvidence(opts: {
  disputeId: string;
  accountId: string | null;
  evidence: AssembledEvidence;
  ce3?: Ce3Submission | null;
  /**
   * When false, Stripe stores the evidence without answering the case.
   *
   * Used by /hq to stage a response a human then releases, and by the tests. A
   * draft can be replaced; a submission cannot.
   */
  submit: boolean;
}): Promise<SubmitResult> {
  const evidence: Stripe.DisputeUpdateParams.Evidence = {
    ...opts.evidence.payload,
    ...opts.evidence.fileIds,
  };

  if (opts.ce3) {
    const ce3 = toStripeCe3(opts.ce3);
    if (ce3) evidence.enhanced_evidence = { visa_compelling_evidence_3: ce3 };
  }

  try {
    const updated = await stripe().disputes.update(
      opts.disputeId,
      { evidence, submit: opts.submit, expand: ["balance_transactions"] },
      actingAs(opts.accountId),
    );
    return { ok: true, dispute: normalizeDispute(updated) };
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    return {
      ok: false,
      error: stripeError.message ?? "Stripe refused the submission.",
      ...(stripeError.code ? { code: stripeError.code } : {}),
    };
  }
}

/**
 * Acknowledge the network fee on a compliance case.
 *
 * Stripe will not accept evidence for a Visa or Mastercard compliance dispute
 * until the fee is acknowledged, and it is not a formality: Visa collects **$500**
 * to resolve one, refunded only on a win. So this is deliberately a separate
 * call that a human makes rather than something `submitEvidence` does on their
 * behalf — nobody should spend $500 as a side effect of pressing "send
 * evidence" on a $34 mug.
 */
export async function acknowledgeComplianceFee(opts: {
  disputeId: string;
  accountId: string | null;
  network: "visa" | "mastercard";
}): Promise<SubmitResult> {
  const enhanced: Stripe.DisputeUpdateParams.Evidence.EnhancedEvidence =
    opts.network === "visa"
      ? { visa_compliance: { fee_acknowledged: true } }
      : { mastercard_compliance: { fee_acknowledged: true } };

  try {
    const updated = await stripe().disputes.update(
      opts.disputeId,
      { evidence: { enhanced_evidence: enhanced }, expand: ["balance_transactions"] },
      actingAs(opts.accountId),
    );
    return { ok: true, dispute: normalizeDispute(updated) };
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    return { ok: false, error: stripeError.message ?? "Stripe refused the acknowledgement." };
  }
}

/**
 * Whether Stripe has decided this dispute can use CE3.0, and what it wants next.
 *
 * `enhanced_eligibility_types` is Stripe's answer and it is the only one that
 * counts — a submission built for a dispute Stripe has not marked eligible is
 * rejected. `requires_action` is the state to act on: Visa has agreed the case
 * qualifies and is waiting for the two prior transactions. `qualified` means it
 * has already been accepted.
 */
export function ce3Eligibility(dispute: NormalizedDispute): {
  offered: boolean;
  status: string | null;
} {
  const offered = dispute.enhancedEligibilityTypes.includes(
    "visa_compelling_evidence_3",
  );
  const entry = dispute.enhancedEligibility?.["visa_compelling_evidence_3"] as
    | { status?: string }
    | undefined;
  return { offered, status: entry?.status ?? null };
}

/**
 * Map Sailo's vendor-free CE3.0 shape onto Stripe's parameters.
 *
 * Returns null rather than a partial payload when the pair is not exactly two.
 * Stripe's own type says "exactly two prior undisputed transaction objects" and
 * the API enforces it — sending one is rejected, and a rejection takes the whole
 * `disputes.update` with it, losing the ordinary evidence that was correct.
 */
function toStripeCe3(
  submission: Ce3Submission,
): Stripe.DisputeUpdateParams.Evidence.EnhancedEvidence.VisaCompellingEvidence3 | null {
  if (submission.priors.length !== CE3_REQUIRED_PRIORS) return null;

  /*
   * `undefined`, not null, and Stripe's types insist on the difference.
   *
   * Visa requires *every* field of a CE3.0 shipping address to be present, so a
   * partial one is worse than none — it fails validation for the whole
   * submission. Sailo holds the address as one formatted string rather than
   * component parts, so `line1` is all that can honestly be sent, and an order
   * with nothing to ship sends the field not at all.
   */
  const address = (
    value: string | null,
  ): Stripe.AddressParam | undefined => (value ? { line1: value } : undefined);

  return {
    disputed_transaction: {
      customer_account_id: submission.disputed.identity.accountId,
      customer_device_fingerprint: submission.disputed.identity.deviceFingerprint,
      customer_device_id: submission.disputed.identity.deviceId,
      customer_email_address: submission.disputed.identity.email,
      customer_purchase_ip: submission.disputed.identity.purchaseIp,
      merchandise_or_services: submission.disputed.merchandiseOrServices,
      product_description: submission.disputed.productDescription,
      shipping_address: address(submission.disputed.identity.shippingAddress),
    },
    prior_undisputed_transactions: submission.priors.map((prior) => ({
      charge: prior.chargeId,
      customer_account_id: prior.identity.accountId,
      customer_device_fingerprint: prior.identity.deviceFingerprint,
      customer_device_id: prior.identity.deviceId,
      customer_email_address: prior.identity.email,
      customer_purchase_ip: prior.identity.purchaseIp,
      product_description: prior.productDescription,
      shipping_address: address(prior.identity.shippingAddress),
    })),
  };
}
