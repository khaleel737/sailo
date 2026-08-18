import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, orders, shops } from "@sailo/db/schema";
import {
  EVIDENCE_FILE_BUDGET_BYTES,
  assembleEvidence,
  buildCe3Submission,
  formatBytes,
  selectPriors,
  type AssembledEvidence,
  type Ce3Selection,
  type EvidenceField,
} from "@sailo/core/disputes";
import {
  canSubmit,
  ce3Eligibility,
  chargeIdForIntent,
  retrieveDispute,
  submitEvidence,
} from "@sailo/payments/disputes";
import { ce3CandidatesFor, holdingsForOrder, identityOf } from "./holdings";
import { evidenceBudget, evidenceFileIdsFor, evidenceFilesFor } from "./files";

/**
 * Answering a dispute: assemble, check the rule, submit, record.
 *
 * The order of operations is the point. Every step can fail in a way that must
 * not lose the ones before it:
 *
 *   1. Read the dispute from Stripe, on its own account. Not from our row — our
 *      row is a mirror and the deadline is Stripe's.
 *   2. Check Stripe will accept a submission at all, before building one. Past
 *      the deadline or already submitted, and the work is wasted.
 *   3. Assemble the ordinary evidence. Never empty: a submission with gaps beats
 *      no submission, and an empty response is an automatic loss.
 *   4. Try CE3.0, and let it fail softly. A rejected enhanced payload takes the
 *      whole `disputes.update` with it, so the CE3.0 attempt must never be able
 *      to lose the evidence that was correct.
 *   5. Record what was sent, as sent.
 */

export type DisputeReadiness = {
  evidence: AssembledEvidence;
  ce3: {
    /** Whether Stripe says this dispute may use CE3.0 at all. */
    offered: boolean;
    stripeStatus: string | null;
    selection: Ce3Selection | null;
  };
  /** Whether Stripe would accept a submission right now, and why not. */
  submittable: { allowed: boolean; why?: string };
};

/**
 * Everything known about how well this dispute can be answered.
 *
 * The read behind both the seller's panel and /hq, and it makes no writes and no
 * submissions — so it can be called on every page load without a dispute ever
 * being answered by someone opening a tab.
 */
export async function disputeReadiness(
  disputeId: string,
  now = new Date(),
): Promise<DisputeReadiness | null> {
  const db = getDb();
  const row = await db.query.disputes.findFirst({ where: eq(disputes.id, disputeId) });
  if (!row) return null;

  const live = await retrieveDispute(row.stripeDisputeId, row.stripeAccountId);

  const order = row.orderId
    ? await db.query.orders.findFirst({ where: eq(orders.id, row.orderId) })
    : undefined;

  /*
   * A dispute with no order behind it.
   *
   * A seller's own subscription chargeback, or a charge taken from Stripe's
   * dashboard that Sailo never saw. There is nothing to assemble from, and
   * returning null would leave the surface unable to show the deadline or the
   * amount — which are the two things a human needs most on exactly this case.
   * So the evidence is empty and honest.
   */
  if (!order) {
    return {
      evidence: assembleEvidence(row.reason, {
        customerName: null,
        customerEmail: null,
        buyerIp: null,
        buyerUserAgent: null,
        buyerDeviceFingerprint: null,
        buyerAccountId: null,
        billingAddress: null,
        shippingAddress: null,
        productDescription: null,
        soldKind: "digital",
        currency: row.currency,
        totalCents: row.amountCents,
        orderReference: row.stripeChargeId ?? row.stripeDisputeId,
        placedAt: row.stripeCreatedAt,
        shippingCarrier: null,
        shippingTrackingNumber: null,
        shippedAt: null,
        serviceAt: null,
        accessLog: [],
        termsAcceptedAt: null,
        refundPolicyText: null,
        refundPolicyUrl: null,
        cancellationPolicyText: null,
        refundedCents: 0,
        refundedAt: null,
        refundRefusalExplanation: null,
        duplicateChargeId: null,
        duplicateIsDistinct: false,
        cancelledAt: null,
        customerCommunicationSummary: null,
        files: {},
      }),
      ce3: { offered: false, stripeStatus: null, selection: null },
      submittable: live
        ? canSubmit(live, now)
        : { allowed: false, why: "Stripe could not be reached." },
    };
  }

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, order.shopId) });
  const holdings = await holdingsForOrder(order, shop);
  /*
   * The documents, which belong to the dispute rather than to the order.
   *
   * `holdingsForOrder` cannot know them — an order has no proof of delivery, a
   * *case* does — so they are merged here, and this is the difference between a
   * seller who has uploaded their carrier receipt being told the case is ready
   * and being told it is still missing the one thing they have already sent.
   */
  const evidence = assembleEvidence(row.reason, {
    ...holdings,
    files: { ...holdings.files, ...(await evidenceFileIdsFor(row.id)) },
  });

  const eligibility = live
    ? ce3Eligibility(live)
    : { offered: false, status: null as string | null };

  /*
   * The prior-transaction selection runs whether or not Stripe has offered
   * CE3.0.
   *
   * It is the only way to answer "could this have been won?", and that is the
   * question /hq needs: a shop whose disputes consistently fail the rule for want
   * of a captured IP address is a reporting problem about Sailo, not a fraud
   * problem about the seller. The selection is shown; only a Stripe-offered
   * dispute has it submitted.
   */
  const candidates = await ce3CandidatesFor(order);
  const selection = selectPriors(
    { at: order.createdAt, identity: identityOf(order) },
    candidates,
  );

  return {
    evidence,
    ce3: { offered: eligibility.offered, stripeStatus: eligibility.status, selection },
    submittable: live
      ? canSubmit(live, now)
      : { allowed: false, why: "Stripe could not be reached." },
  };
}

export type RespondResult =
  | {
      ok: true;
      submitted: boolean;
      completenessBp: number;
      ce3Submitted: boolean;
      ce3Note: string;
      gaps: readonly EvidenceField[];
    }
  | { ok: false; error: string };

/**
 * Send the response.
 *
 * `submit: false` stages evidence without answering the case, which is what /hq
 * uses to let a human look before it goes. The distinction is Stripe's and it is
 * absolute: without the flag the evidence is stored and never read, which
 * produces a pipeline that looks like it works — `has_evidence: true` on every
 * dispute — and wins nothing.
 */
export async function respondToDispute(opts: {
  disputeId: string;
  submit: boolean;
  /** Seller-supplied file ids and text, merged over what was assembled. */
  overrides?: {
    files?: Partial<Record<EvidenceField, string>>;
    refundRefusalExplanation?: string;
  };
  now?: Date;
}): Promise<RespondResult> {
  const now = opts.now ?? new Date();
  const db = getDb();

  const row = await db.query.disputes.findFirst({
    where: eq(disputes.id, opts.disputeId),
  });
  if (!row) return { ok: false, error: "Dispute not found." };

  const live = await retrieveDispute(row.stripeDisputeId, row.stripeAccountId);
  if (!live) return { ok: false, error: "Stripe could not be reached." };

  const gate = canSubmit(live, now);
  if (opts.submit && !gate.allowed) {
    return { ok: false, error: gate.why ?? "Stripe is not accepting evidence." };
  }

  const order = row.orderId
    ? await db.query.orders.findFirst({ where: eq(orders.id, row.orderId) })
    : undefined;
  if (!order) {
    return {
      ok: false,
      error:
        "No Sailo order behind this charge, so there is nothing to assemble. " +
        "Respond from the Stripe dashboard, or refund it.",
    };
  }

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, order.shopId) });
  const holdings = await holdingsForOrder(order, shop);
  /*
   * The combined size, re-checked at the last possible moment.
   *
   * `attachEvidenceFile` enforces the 4.5 MB ceiling per upload against what was
   * held *at that moment*, which is right and is not quite enough: two people
   * attaching to different fields of one dispute at the same time can each be
   * told yes and jointly land over it. The window is small and the cost is not —
   * Stripe rejects the whole update, and it does so at the point somebody is
   * pressing Send with a deadline in hours.
   *
   * So it is checked again here, where the set is final, and refused with the
   * one thing that helps: which documents are on the case and how big they are.
   */
  const attachedFiles = await evidenceFilesFor(row.id);
  const budget = evidenceBudget(attachedFiles);
  if (budget.remainingBytes === 0 && budget.usedBytes > EVIDENCE_FILE_BUDGET_BYTES) {
    const heaviest = [...attachedFiles].sort((a, b) => b.bytes - a.bytes);
    return {
      ok: false,
      error:
        `The documents on this dispute come to ${formatBytes(budget.usedBytes)}, over the ` +
        `${formatBytes(EVIDENCE_FILE_BUDGET_BYTES)} the card networks accept. Remove or ` +
        `compress one before sending — the largest is ${heaviest[0]?.filename} at ` +
        `${formatBytes(heaviest[0]?.bytes ?? 0)}.`,
    };
  }

  const uploaded = await evidenceFileIdsFor(row.id);
  const evidence = assembleEvidence(row.reason, {
    ...holdings,
    /*
     * Uploaded documents first, then any explicit override. The order is the
     * point: an override is a caller naming a file id directly, which only /hq
     * does and only to correct something, so it must win over the stored row.
     */
    files: { ...holdings.files, ...uploaded, ...opts.overrides?.files },
    ...(opts.overrides?.refundRefusalExplanation
      ? { refundRefusalExplanation: opts.overrides.refundRefusalExplanation }
      : {}),
  });

  /*
   * CE3.0, attempted only when Stripe has offered it.
   *
   * Building the payload for a dispute Stripe has not marked eligible is not a
   * harmless extra: the API rejects the enhanced evidence and the rejection takes
   * the ordinary evidence with it, so an unqualified attempt turns a submission
   * with a real chance into no submission at all.
   */
  const eligibility = ce3Eligibility(live);
  let ce3 = null;
  let ce3Note = "not offered by Stripe for this dispute";

  if (eligibility.offered) {
    const candidates = await ce3CandidatesFor(order);
    const selection = selectPriors(
      { at: order.createdAt, identity: identityOf(order) },
      candidates,
    );

    if (!selection.qualifies) {
      ce3Note = selection.reason;
    } else {
      /*
       * Payment intent ids become charge ids here, and only here.
       *
       * Visa wants `ch_…`; `orders` holds `pi_…`. Two extra API calls on a path
       * that runs a handful of times a month, and the alternative was a column
       * and a backfill of every historical order.
       */
      const resolved = await Promise.all(
        selection.priors.map(async (prior) => ({
          prior,
          chargeId: await chargeIdForIntent(prior.chargeId, row.stripeAccountId),
        })),
      );

      /*
       * Both charge ids, read out and checked. `every(entry => entry.chargeId)`
       * satisfies a human and narrows nothing for TypeScript, so the version
       * that reads well needs four assertions — on the two ids that become
       * Visa's `prior_undisputed_transactions[].charge`.
       */
      const [firstPrior, secondPrior] = resolved;
      if (firstPrior?.chargeId && secondPrior?.chargeId) {
        ce3 = buildCe3Submission(
          {
            identity: identityOf(order),
            soldKind: holdings.soldKind,
            productDescription: holdings.productDescription,
          },
          [
            { ...firstPrior.prior, chargeId: firstPrior.chargeId },
            { ...secondPrior.prior, chargeId: secondPrior.chargeId },
          ],
        );
        ce3Note = `two qualifying prior transactions matched on ${(selection.matched[0] ?? []).join(", ")}`;
      } else {
        ce3Note =
          "qualifying priors found, but Stripe returned no settled charge for them — " +
          "submitted without the Visa rule.";
      }
    }
  }

  const result = await submitEvidence({
    disputeId: row.stripeDisputeId,
    accountId: row.stripeAccountId,
    evidence,
    ce3,
    submit: opts.submit,
  });

  if (!result.ok) return { ok: false, error: result.error };

  await db
    .update(disputes)
    .set({
      /*
       * A snapshot, not a reference. The order it was assembled from keeps
       * changing — the seller edits a product, marks something shipped, issues a
       * refund — so re-assembling three months later when the case is lost
       * answers a different question. This is the only record of what we claimed,
       * and Stripe will not give it back in full.
       */
      evidenceSnapshot: {
        payload: evidence.payload,
        fileIds: evidence.fileIds,
        ce3: ce3 ? { priors: ce3.priors.map((p) => p.chargeId) } : null,
        ce3Note,
        submitted: opts.submit,
        at: now.toISOString(),
      },
      completenessBp: evidence.completenessBp,
      submissionCount: result.dispute.submissionCount,
      ce3Status: ce3 ? "submitted" : eligibility.offered ? "offered_not_met" : "not_offered",
      ce3Note,
      status: result.dispute.status,
      ...(opts.submit ? { evidenceSubmittedAt: now } : {}),
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, row.id));

  return {
    ok: true,
    submitted: opts.submit,
    completenessBp: evidence.completenessBp,
    ce3Submitted: Boolean(ce3),
    ce3Note,
    gaps: evidence.blockedOnSeller,
  };
}
