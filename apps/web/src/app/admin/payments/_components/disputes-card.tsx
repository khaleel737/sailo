import Link from "next/link";
import { AlertTriangle, PauseCircle, ShieldCheck } from "lucide-react";
import { Alert, Badge, Card } from "@sailo/design-system/web";
import { EvidenceFileRow } from "@/components/shared/evidence-files";
import { removeSellerDisputeFile } from "@/lib/actions/dispute-files";
import { formatMoney } from "@sailo/core/currency";
import { interpolate } from "@sailo/i18n";
import type { AdminDictionary } from "@sailo/i18n/admin/en";
import {
  DISPUTE_OUTCOME_TONES,
  daysToRespond,
  disputeOutcome,
  isInquiry,
  playbookFor,
  type DisputeOutcome,
  type EvidenceFileField,
} from "@sailo/core/disputes";

/**
 * The seller's own view of a chargeback.
 *
 * Written to a rule: **never show a seller a rate**. A ratio is not a thing they
 * can act on, and one they are close to reads as a threat from their own
 * software. What they can act on is the deadline on the case in front of them
 * and the one document missing from it, so that is what this shows and roughly
 * all it shows.
 *
 * The other rule is that an enquiry and a chargeback are described differently,
 * because the difference is whether their money has gone. Telling a seller
 * "$42 has been taken" when their bank has merely asked a question is a support
 * ticket and an hour of somebody's afternoon; the old webhook did exactly that
 * to the order status, which is where this distinction came from.
 */

export type SellerDispute = {
  id: string;
  status: string;
  reason: string;
  amountCents: number;
  deductedCents: number;
  feeCents: number;
  currency: string;
  dueBy: Date | null;
  evidenceSubmittedAt: Date | null;
  orderId: string | null;
  /** Required evidence fields we do not hold, in the seller's words. */
  missing: readonly string[];
  ready: boolean;
  /**
   * The documents this case wants, and which are already on it.
   *
   * The only part of a submission a seller can supply. Everything else is
   * assembled from rows Sailo already holds — the buyer's address, the download
   * log, the policy disclosure — but the carrier's proof of delivery exists
   * nowhere except on their computer, and it is the field a "never arrived" case
   * is decided on.
   */
  uploads: readonly {
    field: EvidenceFileField;
    required: boolean;
    attached: {
      field: EvidenceFileField;
      filename: string;
      bytes: number;
      uploadedBy: string | null;
      createdAt: Date;
    } | null;
  }[];
};

function deadlineLine(
  dispute: SellerDispute,
  a: AdminDictionary,
  now: Date,
): string | null {
  const days = daysToRespond(dispute, now);
  if (days === null) return null;
  /*
   * Past due is not "today". `daysToRespond` floors at zero — it answers "how
   * many whole days are left", and a deadline that went an hour ago has none —
   * so a case nobody can answer any more read as one that still needed doing
   * before the sun went down. That sends a seller looking for a document to
   * upload into a window the bank has already closed server-side.
   */
  if (dispute.dueBy && dispute.dueBy.getTime() <= now.getTime()) {
    return a.payments.disputeOverdue;
  }
  if (days === 0) return a.payments.disputeToday;
  if (days === 1) return a.payments.disputeDayLeft;
  return interpolate(a.payments.disputeDaysLeft, { count: days });
}

const OUTCOME_LABEL = (a: AdminDictionary): Record<DisputeOutcome, string> => ({
  needs_evidence: a.payments.disputeWhatWins,
  under_review: a.payments.disputeUnderReview,
  won: a.payments.disputeWon,
  lost: a.payments.disputeLost,
  closed_no_loss: a.payments.disputeClosedNoLoss,
});

export function DisputesCard({
  disputes,
  payoutsPausedAt,
  a,
  now = new Date(),
}: {
  disputes: readonly SellerDispute[];
  payoutsPausedAt: Date | null;
  a: AdminDictionary;
  now?: Date;
}) {
  const open = disputes.filter((d) => daysToRespond(d, now) !== null);

  /*
   * Nothing at all is the common case and gets one quiet line rather than a
   * card. A payments page that devotes a panel to chargebacks a seller has never
   * had is a page teaching them to worry about something that has not happened.
   */
  if (disputes.length === 0 && !payoutsPausedAt) return null;

  return (
    <section className="mt-8">
      {payoutsPausedAt ? (
        <Alert
          tone="warning"
          title={a.payments.payoutsHeldTitle}
          icon={<PauseCircle className="size-5" />}
          className="mb-4"
        >
          <p>{a.payments.payoutsHeldBody}</p>
          <p className="mt-2 text-ink-500">{a.payments.payoutsHeldContact}</p>
        </Alert>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-900">
          {a.payments.disputesTitle}
        </h2>
        {open.length > 0 ? (
          <Badge tone="amber" dot>
            {open.length === 1
              ? a.payments.disputesOpenOne
              : interpolate(a.payments.disputesOpen, { count: open.length })}
          </Badge>
        ) : null}
      </div>

      {disputes.length === 0 ? (
        <p className="text-sm text-ink-500">{a.payments.disputesNone}</p>
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => {
            const inquiry = isInquiry(dispute.status);
            const outcome = disputeOutcome(dispute.status);
            const deadline = deadlineLine(dispute, a, now);
            const playbook = playbookFor(dispute.reason);

            return (
              <Card key={dispute.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={DISPUTE_OUTCOME_TONES[outcome]}>
                        {inquiry
                          ? a.payments.disputeInquiry
                          : OUTCOME_LABEL(a)[outcome]}
                      </Badge>
                      {deadline ? (
                        <span className="text-xs font-medium text-ink-500">
                          {deadline}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-medium text-ink-900">
                      {playbook.label}
                    </p>
                    <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-500">
                      {inquiry
                        ? a.payments.disputeInquiryBody
                        : interpolate(a.payments.disputeChargebackBody, {
                            /*
                             * The deduction, not the sale price. A $42 chargeback
                             * costs $57 — Stripe takes a $15 fee on top — and a
                             * seller told $42 will reconcile their bank against a
                             * number that is 36% short.
                             */
                            amount: formatMoney(dispute.deductedCents, dispute.currency),
                            fee: formatMoney(dispute.feeCents, dispute.currency),
                          })}
                    </p>
                  </div>
                  {dispute.orderId ? (
                    <Link
                      href={`/admin/orders/${dispute.orderId}`}
                      className="focus-ring shrink-0 rounded-lg text-sm font-medium text-ink-700 underline underline-offset-4"
                    >
                      {formatMoney(dispute.amountCents, dispute.currency)}
                    </Link>
                  ) : (
                    <span className="tabular shrink-0 text-sm font-medium text-ink-700">
                      {formatMoney(dispute.amountCents, dispute.currency)}
                    </span>
                  )}
                </div>

                {daysToRespond(dispute, now) !== null ? (
                  <div className="mt-3 rounded-xl bg-ink-50 p-3">
                    <p className="text-xs font-medium text-ink-700">
                      {a.payments.disputeWhatWins}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">
                      {playbook.guidance}
                    </p>

                    {dispute.ready ? (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                        <ShieldCheck className="size-4" />
                        {a.payments.disputeReady}
                      </p>
                    ) : (
                      <div className="mt-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                          <AlertTriangle className="size-4" />
                          {a.payments.disputeMissing}
                        </p>
                        <ul className="mt-1 space-y-1 text-sm text-ink-600">
                          {dispute.missing.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {dispute.uploads.length > 0 ? (
                      <div className="mt-3 border-t border-ink-200 pt-2">
                        <p className="text-xs font-medium text-ink-700">
                          {a.payments.disputeDocuments}
                        </p>
                        <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-500">
                          {a.payments.disputeDocumentsBody}
                        </p>
                        {dispute.uploads.map((slot) => (
                          <EvidenceFileRow
                            key={slot.field}
                            disputeId={dispute.id}
                            field={slot.field}
                            attached={slot.attached}
                            required={slot.required}
                            as="seller"
                            removeAction={removeSellerDisputeFile}
                            previewHref={
                              slot.attached
                                ? `/api/disputes/${dispute.id}/evidence/${slot.field}?as=seller`
                                : null
                            }
                            disabled={Boolean(dispute.evidenceSubmittedAt)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {dispute.evidenceSubmittedAt ? (
                  <p className="mt-2 text-xs text-ink-500">
                    {a.payments.disputeEvidenceSent}
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
