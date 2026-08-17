import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Wallet } from "lucide-react";
import { PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { Metric, MetricRow, Mono, When } from "@/app/hq/_components/hq-ui";
import { getPayoutPreview, getRecentPayouts } from "@/lib/hq/partners";
import { getProgramSettings } from "@sailo/partners/settings";
import { formatMoney } from "@sailo/core/currency";
import { PayNowButton, RunPayoutsButton } from "../_components/payout-buttons";

export const metadata: Metadata = { title: "Partner payouts" };

/**
 * What we owe partners, and the button that sends it.
 *
 * The money moves as a Stripe transfer from our platform balance to the
 * partner's connected account — see `lib/partners/payouts.ts` for why the
 * ledger rows are claimed before the transfer rather than after.
 *
 * Three lists rather than one, because "owed" hides three different problems:
 * a partner we can pay, a partner we owe but cannot reach, and a partner who
 * simply has not earned enough yet. Only the first is a payout; the second is
 * a support conversation and would otherwise sit invisible inside a total.
 */
export default async function HqPartnerPayoutsPage() {
  const [preview, history, settings] = await Promise.all([
    getPayoutPreview(),
    getRecentPayouts(),
    getProgramSettings(),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/hq/partners", label: "Partners" }}
        title="Payouts"
        description="Commission Sailo owes partners for the creators they brought us."
        action={
          <RunPayoutsButton
            disabled={preview.ready.length === 0}
            amount={formatMoney(preview.readyTotalCents, preview.currency)}
            count={preview.ready.length}
          />
        }
      />

      <MetricRow>
        <Metric
          label="Ready to send"
          value={formatMoney(preview.readyTotalCents, preview.currency)}
          hint={`${preview.ready.length} partner${preview.ready.length === 1 ? "" : "s"}`}
          icon={<Wallet className="size-4" />}
        />
        <Metric
          label="Owed but blocked"
          value={formatMoney(preview.blockedTotalCents, preview.currency)}
          hint={`${preview.blocked.length} can't receive transfers`}
          icon={<AlertTriangle className="size-4" />}
        />
        <Metric
          label="Under the minimum"
          value={preview.belowMinimum.length.toLocaleString()}
          hint={`Rolls over until ${formatMoney(preview.minimumCents, preview.currency)}`}
        />
        <Metric
          label="In flight"
          value={preview.pendingPayouts.toLocaleString()}
          hint={
            preview.pendingPayouts > 0
              ? "Unresolved — the cron reconciles these"
              : "Nothing stuck"
          }
        />
      </MetricRow>

      {/* ---- Ready ------------------------------------------------------- */}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">
        Ready to send
      </h2>
      <Table
        minWidth="52rem"
        head={
          <>
            <Th>Partner</Th>
            <Th align="end">Amount</Th>
            <Th align="end">Referred</Th>
            <Th>Last earned</Th>
            <Th align="end">Send</Th>
          </>
        }
      >
        {preview.ready.length === 0 ? (
          <EmptyRow colSpan={5}>
            Nobody is over the {formatMoney(preview.minimumCents, preview.currency)}{" "}
            minimum with a working payout account.
          </EmptyRow>
        ) : (
          preview.ready.map((row) => (
            <Tr key={row.id}>
              <Td className="max-w-64">
                <Link
                  href={`/hq/partners/${row.id}`}
                  className="block truncate text-sm font-medium text-ink-900 hover:underline"
                >
                  {row.name}
                </Link>
                <span className="block truncate text-xs text-ink-400">
                  {row.email}
                </span>
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Amount">
                <span className="font-medium text-amber-700">
                  {formatMoney(row.availableCents, row.currency)}
                </span>
              </Td>
              <Td align="end" className="tabular" label="Referred">
                {row.convertedCount} of {row.referredCount}
              </Td>
              <Td label="Last earned">
                <When value={row.lastEarnedAt} />
              </Td>
              <Td align="end" label="Send">
                <PayNowButton partnerId={row.id} currency={row.currency} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      {/* ---- Blocked ------------------------------------------------------ */}

      {preview.blocked.length > 0 ? (
        <>
          <h2 className="mb-1 mt-8 text-sm font-semibold text-ink-900">
            Owed, but we can&rsquo;t transfer
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            They&rsquo;ve earned it and it&rsquo;s out of hold, but Stripe
            won&rsquo;t accept a transfer — usually because they never finished
            Connect onboarding. &ldquo;Mark settled&rdquo; on their page records
            a payment made another way; it moves no money.
          </p>
          <Table
            minWidth="52rem"
            head={
              <>
                <Th>Partner</Th>
                <Th align="end">Amount</Th>
                <Th>Why</Th>
                <Th align="end" />
              </>
            }
          >
            {preview.blocked.map((row) => (
              <Tr key={row.id}>
                <Td className="max-w-64">
                  <Link
                    href={`/hq/partners/${row.id}`}
                    className="block truncate text-sm font-medium text-ink-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="block truncate text-xs text-ink-400">
                    {row.email}
                  </span>
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Amount">
                  {formatMoney(row.availableCents, row.currency)}
                </Td>
                <Td label="Why">
                  <span className="text-xs text-ink-500">
                    {row.payoutBlocker
                      ? {
                          no_shop: "No shop — not an active seller",
                          no_stripe: "Their shop hasn't connected Stripe",
                          stripe_incomplete: "Stripe is still verifying them",
                        }[row.payoutBlocker]
                      : "Ready — nothing blocking"}
                  </span>
                </Td>
                <Td align="end">
                  <Link
                    href={`/hq/partners/${row.id}`}
                    className="text-xs font-medium text-ink-700 underline hover:no-underline"
                  >
                    Open
                  </Link>
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      {/* ---- History ------------------------------------------------------ */}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">
        Everything we&rsquo;ve sent
      </h2>
      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Partner</Th>
            <Th align="end">Amount</Th>
            <Th>Status</Th>
            <Th>By</Th>
            <Th>Transfer</Th>
            <Th>When</Th>
          </>
        }
      >
        {history.length === 0 ? (
          <EmptyRow colSpan={6}>No payouts have been attempted yet.</EmptyRow>
        ) : (
          history.map((row) => (
            <Tr key={row.id}>
              <Td className="max-w-56">
                <Link
                  href={`/hq/partners/${row.partnerId}`}
                  className="block truncate text-sm font-medium text-ink-900 hover:underline"
                >
                  {row.partnerName}
                </Link>
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Amount">
                {formatMoney(row.amountCents, row.currency)}
              </Td>
              <Td label="Status">
                <PayoutStatus status={row.status} reason={row.failureReason} />
              </Td>
              <Td label="By">
                <span className="text-xs text-ink-500">
                  {row.initiatedByEmail ?? row.initiatedBy}
                </span>
              </Td>
              <Td label="Transfer">
                {row.stripeTransferId ? (
                  <Mono>{row.stripeTransferId}</Mono>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </Td>
              <Td label="When">
                <When value={row.paidAt ?? row.createdAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Transfers come out of Sailo&rsquo;s own Stripe balance. If one fails
        because the balance is short, the earnings go back in the pool and the
        next run picks them up — Stripe does not retry on its own, and adding
        funds does not retry it either.{" "}
        {settings.autoPayout
          ? `The automatic run fires on day ${settings.payoutDayOfMonth} of each month.`
          : "Automatic payouts are currently off."}
      </p>
    </>
  );
}

function PayoutStatus({
  status,
  reason,
}: {
  status: string;
  reason: string | null;
}) {
  if (status === "paid") {
    return <span className="text-xs font-medium text-emerald-700">Paid</span>;
  }
  if (status === "failed") {
    return (
      <span className="text-xs text-red-700" title={reason ?? undefined}>
        Failed{reason ? ` — ${reason}` : ""}
      </span>
    );
  }
  return <span className="text-xs font-medium text-amber-700">In flight</span>;
}
