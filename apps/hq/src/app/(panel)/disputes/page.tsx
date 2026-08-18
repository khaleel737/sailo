import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Clock,
  Fingerprint,
  Gavel,
  PauseCircle,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { PageHeader, Badge, Card, Alert } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Metric, MetricRow, SectionTitle } from "@/app/_components/hq-ui";
import {
  ReleaseHold,
  RefundInstead,
  SendEvidence,
  StageEvidence,
} from "@/app/_components/dispute-actions";
import {
  getDisputeQueue,
  getOpenFraudWarnings,
  getPlatformDisputeHealth,
  getShopExposure,
} from "@/lib/platform/disputes";
import { formatMoney } from "@sailo/core/currency";
import {
  DISPUTE_OUTCOME_TONES,
  formatBp,
  type DisputeOutcome,
} from "@sailo/core/disputes";

export const metadata: Metadata = { title: "Chargebacks" };

/**
 * The chargeback desk.
 *
 * Four questions, in the order they get asked when something is wrong:
 *
 *   1. **What is on fire?** Disputes owing a response, soonest deadline first.
 *      A deadline is the only thing here that cannot be recovered — Stripe closes
 *      the window server-side and evidence a minute late is not evidence.
 *   2. **Whose money is it?** Shops by exposure: what Sailo would cover if their
 *      balances cannot, which is the number the platform's own liability turns on.
 *   3. **Are we about to be fined?** The platform ratio the networks actually
 *      compute — disputes raised this month over this month's volume — which is a
 *      different question from whether any one seller is a problem, and the only
 *      place in the codebase where an arrival-month count is the right answer.
 *   4. **Can we defend the next four months?** How much recent volume carries a
 *      purchase IP, because an order without one cannot use Visa's Compelling
 *      Evidence 3.0 and cannot be fixed later.
 *
 * The last one is the one nobody would think to ask, and it is the one that
 * decides whether any of the rest works. A platform that starts capturing IP
 * addresses today has no fraud defence until December.
 */
export default async function HqDisputesPage() {
  const [queue, exposure, health, warnings] = await Promise.all([
    getDisputeQueue(),
    getShopExposure(),
    getPlatformDisputeHealth(),
    getOpenFraudWarnings(),
  ]);

  const held = exposure.filter((shop) => shop.payoutsPausedAt);
  const coveragePct =
    health.coverage.orders > 0
      ? Math.round((health.coverage.ce3Capable / health.coverage.orders) * 100)
      : null;

  return (
    <>
      <PageHeader
        title="Chargebacks"
        description="What is owed a response, whose money is at risk, and whether the next four months can be defended."
        meta={
          health.pastDue > 0 ? (
            <Badge tone="red" dot>
              {health.pastDue} past due
            </Badge>
          ) : health.awaiting > 0 ? (
            <Badge tone="amber" dot>
              {health.awaiting} awaiting a response
            </Badge>
          ) : (
            <Badge tone="green" dot>
              Nothing owed
            </Badge>
          )
        }
      />

      <MetricRow>
        <Metric
          label="Awaiting a response"
          value={health.awaiting}
          hint={health.pastDue > 0 ? `${health.pastDue} already past due` : "None past due"}
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="Out of sellers' balances"
          value={formatMoney(health.openCents, "USD")}
          hint="Open chargebacks, amount plus fee"
          icon={<Banknote className="size-4" />}
        />
        <Metric
          label="Won"
          value={formatBp(health.winRateBp)}
          hint={`${health.won} won, ${health.lost} lost — ${health.answered} of ${health.total} answered`}
          icon={<Gavel className="size-4" />}
        />
        <Metric
          label="Defensible orders"
          value={coveragePct === null ? "—" : `${coveragePct}%`}
          /*
           * The forward-looking number. An order without a purchase IP cannot
           * use Visa's prior-transaction rule and cannot be repaired — the
           * buyer's connection existed for one request.
           */
          hint={`${health.coverage.ce3Capable} of ${health.coverage.orders} recent orders carry what Visa CE3.0 needs`}
          icon={<Fingerprint className="size-4" />}
        />
      </MetricRow>

      {coveragePct !== null && coveragePct < 90 ? (
        <Alert
          tone="warning"
          title="Some recent orders cannot be defended against a fraud claim"
          icon={<Fingerprint className="size-5" />}
          className="mt-4"
        >
          Visa&rsquo;s Compelling Evidence 3.0 needs a purchase IP or device id on the
          disputed order <em>and</em> on two prior orders from the same buyer, 120 to
          365 days earlier. Orders placed before Sailo began recording those cannot
          use it, and nothing can add them afterwards — the buyer&rsquo;s connection
          existed for one request. This figure only rises with time.
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Owing a response</SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
        Soonest deadline first. Stripe closes the window server-side — a minute late is not late, it is unanswered.
      </p>
      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Deadline</Th>
            <Th>Shop</Th>
            <Th>Reason</Th>
            <Th align="end">Taken</Th>
            <Th>Evidence</Th>
            <Th>Answer</Th>
          </>
        }
      >
          {queue.length === 0 ? (
            <EmptyRow colSpan={6}>Nothing owes a response.</EmptyRow>
          ) : (
            queue.map((dispute) => (
              <Tr key={dispute.id}>
                <Td>
                  <span
                    className={
                      dispute.daysLeft !== null && dispute.daysLeft <= 3
                        ? "font-semibold text-red-600"
                        : "text-ink-700"
                    }
                  >
                    {dispute.daysLeft === null
                      ? "—"
                      : dispute.daysLeft === 0
                        ? "Today"
                        : `${dispute.daysLeft} days`}
                  </span>
                  <span className="block text-xs text-ink-400">
                    {dispute.dueBy?.toISOString().slice(0, 10) ?? "no deadline"}
                  </span>
                </Td>
                <Td>
                  {dispute.shopHandle ? (
                    <Link
                      href={`/hq/accounts/${dispute.ownerId}`}
                      className="focus-ring rounded font-medium text-ink-900 underline underline-offset-4"
                    >
                      {dispute.shopName}
                    </Link>
                  ) : (
                    <span className="text-ink-400">unknown shop</span>
                  )}
                  <span className="block text-xs text-ink-400">
                    {dispute.scope === "platform"
                      ? "their Sailo subscription"
                      : dispute.orderId
                        ? "a buyer's order"
                        : "no Sailo order"}
                  </span>
                </Td>
                <Td>
                  {/*
                    The way into the case. The queue answers "what is on fire";
                    everything needed to decide what to send is a screen down,
                    because a row cannot hold thirty evidence fields and the
                    documents attached to them.
                  */}
                  <Link
                    href={`/hq/disputes/${dispute.id}`}
                    className="focus-ring rounded underline underline-offset-4"
                  >
                    <Badge tone={DISPUTE_OUTCOME_TONES[dispute.outcome as DisputeOutcome]}>
                      {dispute.inquiry ? "Enquiry" : "Chargeback"}
                    </Badge>
                  </Link>
                  <span className="mt-1 block text-xs text-ink-600">
                    {dispute.reasonLabel}
                    {dispute.networkReasonCode ? ` · ${dispute.networkReasonCode}` : ""}
                  </span>
                </Td>
                <Td align="end">
                  <span className="tabular font-medium">
                    {formatMoney(
                      /*
                       * The deduction, not the sale price. An enquiry has taken
                       * nothing, which is the distinction this whole column
                       * exists to make visible.
                       */
                      dispute.inquiry ? 0 : dispute.deductedCents,
                      dispute.currency,
                    )}
                  </span>
                  <span className="block text-xs text-ink-400">
                    on {formatMoney(dispute.amountCents, dispute.currency)}
                  </span>
                </Td>
                <Td>
                  {dispute.completenessBp !== null ? (
                    <span className="tabular text-sm">
                      {(dispute.completenessBp / 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-xs text-ink-400">not assembled</span>
                  )}
                  {dispute.ce3Status === "submitted" ? (
                    <Badge tone="green" className="ml-1">
                      CE3.0
                    </Badge>
                  ) : null}
                  <span className="mt-1 block max-w-xs text-xs text-ink-500">
                    {dispute.guidance}
                  </span>
                </Td>
                <Td>
                  {dispute.submittedAt ? (
                    <span className="text-xs text-ink-500">
                      Sent {dispute.submittedAt.toISOString().slice(0, 10)}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      <SendEvidence
                        disputeId={dispute.id}
                        complete={(dispute.completenessBp ?? 0) >= 10_000}
                      />
                      <StageEvidence disputeId={dispute.id} />
                      {dispute.inquiry ? <RefundInstead disputeId={dispute.id} /> : null}
                    </div>
                  )}
                </Td>
              </Tr>
            ))
          )}
      </Table>

      {/* ---------------------------------------------------------------- */}

      {warnings.length > 0 ? (
        <>
          <SectionTitle>Early fraud warnings</SectionTitle>
          <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
            The issuer has called these fraud and a chargeback usually follows within
            days. Refunding now avoids the chargeback and its fee — though not the
            fraud report, which counts towards Visa&rsquo;s ratio either way.
          </p>
          <Table
            minWidth="40rem"
            head={
              <>
                <Th>Raised</Th>
                <Th>Shop</Th>
                <Th>Kind</Th>
                <Th>Charge</Th>
              </>
            }
          >
              {warnings.map(({ warning, shopName }) => (
                <Tr key={warning.id}>
                  <Td>{warning.stripeCreatedAt.toISOString().slice(0, 10)}</Td>
                  <Td>{shopName ?? "unknown"}</Td>
                  <Td>{warning.fraudType.replace(/_/g, " ")}</Td>
                  <Td>
                    <code className="text-xs">{warning.stripeChargeId}</code>
                  </Td>
                </Tr>
              ))}
          </Table>
        </>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Shops by exposure</SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
        What Sailo would cover if these balances cannot. The rate here is a crude
        screen over all settled orders — a shop&rsquo;s own page runs the real one,
        pooled over the cohorts the disputes came from.
      </p>

      {held.length > 0 ? (
        <Alert
          tone="warning"
          title={`${held.length} shop${held.length === 1 ? "" : "s"} on a payout hold`}
          icon={<PauseCircle className="size-5" />}
          className="mb-4"
        >
          Their storefronts are open and they can still take payments. The money is
          in their own Stripe balance, where a chargeback can still be debited from
          it — it is simply not being sent onward. Releasing is a decision for a
          person, not for the arithmetic that applied it.
        </Alert>
      ) : null}

      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Shop</Th>
            <Th align="end">Chargebacks</Th>
            <Th align="end">Rate (screen)</Th>
            <Th align="end">At risk</Th>
            <Th>Standing</Th>
            <Th>Payouts</Th>
          </>
        }
      >
          {exposure.length === 0 ? (
            <EmptyRow colSpan={6}>No shop has had a chargeback.</EmptyRow>
          ) : (
            exposure.map((shop) => (
              <Tr key={shop.shopId}>
                <Td>
                  <Link
                    href={`/hq/accounts/${shop.ownerId}`}
                    className="focus-ring rounded font-medium text-ink-900 underline underline-offset-4"
                  >
                    {shop.name}
                  </Link>
                  <span className="block text-xs text-ink-400">{shop.ownerEmail}</span>
                </Td>
                <Td align="end">
                  <span className="tabular">{shop.chargebacks}</span>
                  {shop.inquiries > 0 ? (
                    <span className="block text-xs text-ink-400">
                      +{shop.inquiries} enquiries
                    </span>
                  ) : null}
                </Td>
                <Td align="end">
                  <span className="tabular">{formatBp(shop.chargebackBp)}</span>
                  <span className="block text-xs text-ink-400">
                    {/*
                      The denominator, always. A rate with no visible denominator
                      is a rate somebody will act on at n=3.
                    */}
                    of {shop.settledOrders} card orders
                  </span>
                </Td>
                <Td align="end">
                  <span className="tabular font-medium">
                    {formatMoney(shop.openDisputeCents, "USD")}
                  </span>
                </Td>
                <Td>
                  {shop.suspendedAt ? (
                    <Badge tone="red">Suspended</Badge>
                  ) : shop.disputeClearedAt ? (
                    <Badge tone="green">Cleared by staff</Badge>
                  ) : shop.awaitingResponse > 0 ? (
                    <Badge tone="amber">{shop.awaitingResponse} to answer</Badge>
                  ) : (
                    <span className="text-xs text-ink-400">—</span>
                  )}
                </Td>
                <Td>
                  {shop.payoutsPausedAt ? (
                    <div className="max-w-sm">
                      <p className="mb-2 text-xs text-ink-600">
                        {shop.payoutsPausedReason}
                      </p>
                      <ReleaseHold shopId={shop.shopId} />
                    </div>
                  ) : (
                    <span className="text-xs text-ink-400">Running</span>
                  )}
                </Td>
              </Tr>
            ))
          )}
      </Table>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>The platform&rsquo;s own ratio</SectionTitle>
      <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
        Disputes raised in a month over that month&rsquo;s settled volume — the sum
        Visa and Mastercard actually compute. This is the only figure here measured
        by arrival rather than by the order&rsquo;s own month, because it answers
        whether Sailo is about to be fined rather than whether a seller is a problem.
      </p>
      <Table
        minWidth="40rem"
        head={
          <>
            <Th>Month</Th>
            <Th align="end">Card orders</Th>
            <Th align="end">Chargebacks</Th>
            <Th align="end">Fraud</Th>
            <Th align="end">Ratio</Th>
          </>
        }
      >
          {health.months.length === 0 ? (
            <EmptyRow colSpan={5}>No card volume yet.</EmptyRow>
          ) : (
            health.months.map((month) => (
              <Tr key={month.month.toISOString()}>
                <Td>{month.month.toISOString().slice(0, 7)}</Td>
                <Td align="end" className="tabular">
                  {month.settledOrders}
                </Td>
                <Td align="end" className="tabular">
                  {month.chargebacks}
                </Td>
                <Td align="end" className="tabular">
                  {month.fraudChargebacks}
                </Td>
                <Td align="end">
                  <span
                    className={
                      (month.arrivalBp ?? 0) >= health.sailoThresholds.payoutHoldBp
                        ? "tabular font-semibold text-red-600"
                        : "tabular"
                    }
                  >
                    {formatBp(month.arrivalBp)}
                  </span>
                </Td>
              </Tr>
            ))
          )}
      </Table>

      <Card className="mt-4 p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-700">
          <ShieldAlert className="size-4" />
          What we are measured against
        </p>
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          {health.thresholds.map((programme) => (
            <li key={programme.programme}>
              <span className="font-medium">{programme.programme}</span> —{" "}
              {formatBp(programme.thresholdBp)} with at least{" "}
              {programme.minChargebacks} chargebacks, over{" "}
              {programme.denominator === "previous_month"
                ? "the previous month's"
                : "the same month's"}{" "}
              volume.{" "}
              {programme.needsConfirmation ? (
                <span className="text-amber-700">Confirm with Stripe before relying on it.</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
          <TrendingDown className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Sailo acts far below all of these: a human is asked to look at{" "}
            {formatBp(health.sailoThresholds.reviewBp)} and payouts are held at{" "}
            {formatBp(health.sailoThresholds.payoutHoldBp)}, per shop. The network
            counts are platform-wide and in the thousands — by the time Visa
            notices, Stripe has already reserved against our account.
          </span>
        </p>
      </Card>

      {health.warnings.total > 0 ? (
        <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {health.warnings.total} early fraud warnings in the last 90 days;{" "}
            {health.warnings.becameDisputes} became chargebacks and{" "}
            {health.warnings.refunded} were refunded first.
          </span>
        </p>
      ) : null}
    </>
  );
}
