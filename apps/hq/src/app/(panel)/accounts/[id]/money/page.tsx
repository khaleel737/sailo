import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import {
  BillingBadge,
  Detail,
  SectionTitle,
  StripeLink,
  When,
} from "@/app/_components/hq-ui";
import { getAccountHeader, getAccountMoney } from "@/lib/platform";
import { billingState } from "@/lib/metrics";
import { formatMoney } from "@sailo/core/currency";
import { isPaymentStatus, PAYMENT_STATUS_TONES } from "@sailo/core/payment-status";
import {
  disputeOutcome,
  DISPUTE_OUTCOME_TONES,
  type DisputeOutcome,
} from "@sailo/core/disputes";

/** The same four words the platform payments desk uses. See its note. */
const OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  needs_evidence: "Needs evidence",
  under_review: "With the bank",
  won: "Won",
  lost: "Lost",
  closed_no_loss: "Closed, no loss",
};
import { planFor } from "@sailo/core/plans";

export const metadata: Metadata = { title: "Money" };

/**
 * The two directions money moves around this shop.
 *
 * Up: what they pay Sailo — the plan, the Stripe subscription, whether a comp
 * is overriding it. Down: what their buyers paid them, one payment at a time,
 * with the refunds and disputes against each.
 *
 * They are on one tab because the question that brings somebody here is almost
 * always about the relationship between them: a shop that stopped paying us
 * while its buyers kept paying it, or one taking real money on a free plan. On
 * separate screens that comparison needs two tabs and a memory.
 */
export default async function HqAccountMoneyPage({
  params,
}: PageProps<"/accounts/[id]/money">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header?.shop) notFound();

  const shop = header.shop;
  const detail = await getAccountMoney(shop.id);
  const money = (cents: number) => formatMoney(cents, shop.currency);
  const plan = planFor(shop);
  const state = billingState(shop);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <SectionTitle>Payments taken</SectionTitle>
        <Table
          minWidth="46rem"
          head={
            <>
              <Th>When</Th>
              <Th>Buyer</Th>
              <Th>Rail</Th>
              <Th align="end">Charged</Th>
              <Th align="end">Refunded</Th>
              <Th>State</Th>
              <Th>Stripe</Th>
            </>
          }
        >
          {detail.payments.length === 0 ? (
            <EmptyRow colSpan={7}>
              This shop has never taken a payment.
            </EmptyRow>
          ) : (
            detail.payments.map((row) => (
              <Tr key={row.orderId}>
                <Td className="text-ink-500">
                  <When value={row.createdAt} withTime />
                </Td>
                <Td label="Buyer">
                  <span className="block truncate text-ink-900">
                    {row.buyerName ?? "—"}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {row.buyerEmail ?? ""}
                  </span>
                </Td>
                <Td label="Rail">
                  {/* Stripe processed it, or it settled off-platform. The
                      `payment_method` column is what the buyer chose, which a
                      seller can name anything. */}
                  {row.stripePaymentIntentId ? (
                    <Badge tone="blue">Card</Badge>
                  ) : (
                    <span className="text-xs text-ink-500">
                      {row.paymentMethod}
                    </span>
                  )}
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Charged">
                  {formatMoney(row.totalCents, row.currency)}
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Refunded">
                  {row.refundedCents > 0 ? (
                    <span
                      className={
                        row.refundedCents >= row.totalCents
                          ? "text-red-600"
                          : "text-amber-700"
                      }
                    >
                      {formatMoney(row.refundedCents, row.currency)}
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
                <Td label="State">
                  {/* One chip — see the note on the platform payments desk. */}
                  {row.disputeId ? (
                    <Link href={`/disputes/${row.disputeId}`} className="focus-ring rounded">
                      <Badge
                        tone={
                          DISPUTE_OUTCOME_TONES[disputeOutcome(row.disputeStatus ?? "")]
                        }
                        dot
                      >
                        {OUTCOME_LABELS[disputeOutcome(row.disputeStatus ?? "")]}
                      </Badge>
                    </Link>
                  ) : (
                    <Badge
                      tone={
                        isPaymentStatus(row.paymentStatus)
                          ? PAYMENT_STATUS_TONES[row.paymentStatus]
                          : "neutral"
                      }
                    >
                      {row.paymentStatus.charAt(0).toUpperCase() + row.paymentStatus.slice(1)}
                    </Badge>
                  )}
                </Td>
                <Td label="Stripe">
                  <StripeLink
                    id={row.stripePaymentIntentId}
                    kind="payments"
                    account={row.stripeAccountId}
                  />
                </Td>
              </Tr>
            ))
          )}
        </Table>

        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          The thirty most recent. Everything this shop has ever taken is on{" "}
          <Link
            href={`/payments?q=${encodeURIComponent(shop.handle)}`}
            className="underline decoration-ink-300 underline-offset-2 hover:text-ink-700"
          >
            the payments desk
          </Link>
          .
        </p>
      </div>

      <aside className="min-w-0 space-y-3">
        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            What they pay us
          </h3>
          <div className="space-y-3">
            <Detail label="Entitled to">
              {plan.name}
              {state === "comped" ? " (comped by us)" : ""}
            </Detail>
            <Detail label="State">
              <BillingBadge shop={shop} />
            </Detail>
            <Detail label="Billing plan on Stripe">
              {shop.plan === "free" ? "Free" : shop.plan}
              {shop.subscriptionInterval ? ` · ${shop.subscriptionInterval}ly` : ""}
            </Detail>
            <Detail label="Stripe status">{shop.subscriptionStatus ?? "—"}</Detail>
            <Detail label="Renews">
              <When value={shop.currentPeriodEnd} />
              {shop.cancelAtPeriodEnd ? " · cancelling" : ""}
            </Detail>
            {shop.compNote ? (
              <Detail label="Comp reason">{shop.compNote}</Detail>
            ) : null}
            <Detail label="Customer">
              <StripeLink id={shop.stripeCustomerId} kind="customers" />
            </Detail>
            <Detail label="Subscription">
              <StripeLink id={shop.stripeSubscriptionId} kind="subscriptions" />
            </Detail>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            What their buyers pay them
          </h3>
          <div className="space-y-3">
            <Detail label="Gross">{money(detail.grossCents)}</Detail>
            <Detail label="Refunded">{money(detail.refundedCents)}</Detail>
            <Detail label="Net">
              {money(detail.grossCents - detail.refundedCents)}
            </Detail>
            <Detail label="First order">
              <When value={detail.firstOrderAt} />
            </Detail>
            <Detail label="Last order">
              <When value={detail.lastOrderAt} />
            </Detail>
            <Detail label="Invoices">
              {detail.invoiceCount} issued · next {shop.invoicePrefix}-
              {String(shop.invoiceNextNumber).padStart(4, "0")}
            </Detail>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            Card payments
          </h3>
          {shop.stripeAccountId ? (
            <div className="space-y-3">
              <Detail label="Connected account">
                <StripeLink id={shop.stripeAccountId} kind="connect/accounts" />
              </Detail>
              <Detail label="Charges enabled">
                {shop.stripeChargesEnabled ? "Yes" : "Not yet"}
              </Detail>
              <Detail label="Details submitted">
                {shop.stripeDetailsSubmitted ? "Yes" : "No"}
              </Detail>
              <Detail label="Country">{shop.stripeAccountCountry ?? "—"}</Detail>
              <Detail label="Connected">
                <When value={shop.stripeConnectedAt} />
              </Detail>
              {shop.payoutsPausedAt ? (
                <Detail label="Payouts">
                  {/* The one place a hold is explained rather than badged. The
                      release button is on the dispute that caused it, because
                      that is where the evidence to justify releasing lives. */}
                  <span className="text-amber-700">
                    Held since{" "}
                    <When value={shop.payoutsPausedAt} />
                    {shop.payoutsPausedReason ? ` — ${shop.payoutsPausedReason}` : ""}
                  </span>
                </Detail>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              No Stripe account connected — this shop settles out of band.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            Tax
          </h3>
          <div className="space-y-3">
            <Detail label="Mode">
              {shop.taxMode === "stripe" ? "Stripe Tax" : "Flat rate"}
            </Detail>
            <Detail label="Charging">
              {shop.taxEnabled
                ? `${shop.taxName} ${(shop.taxRateBp / 100).toFixed(2)}%${shop.taxInclusive ? " inclusive" : ""}`
                : "Off"}
            </Detail>
            <Detail label="Registration">{shop.taxId ?? "—"}</Detail>
            <Detail label="Invoicing as">
              {shop.invoiceLegalName ?? shop.name}
              {shop.invoiceCountry ? ` · ${shop.invoiceCountry}` : ""}
            </Detail>
          </div>
        </Card>
      </aside>
    </div>
  );
}
