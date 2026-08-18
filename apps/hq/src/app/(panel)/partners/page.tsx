import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Clock, Handshake, Users, Wallet } from "lucide-react";
import { PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Metric, MetricRow } from "@/app/_components/hq-ui";
import { getPartners, getProgramTotals } from "@/lib/platform/partners";
import { getProgramSettings } from "@sailo/partners/settings";
import type { PayoutBlocker } from "@sailo/partners/eligibility";
import { shareLabel } from "@sailo/partners/program";
import { formatMoney } from "@sailo/core/currency";
import { DecideButtons } from "./_components/decide-buttons";
import { StatusFilter } from "./_components/status-filter";

export const metadata: Metadata = { title: "Partners" };

/**
 * Sailo's own partner programme: who is bringing us creators, and what we owe
 * them for it.
 *
 * Distinct from /hq/affiliates, which is commission a *seller* owes someone
 * for selling that seller's products — money that never passes through us.
 * This page is our own liability, paid out of our subscription revenue, which
 * is why it sits under Business next to Revenue rather than beside the
 * affiliate list it superficially resembles.
 *
 * Pending applications sort to the top regardless of balance. The queue is the
 * thing this page exists to clear, and an application buried under forty
 * earning partners is an application nobody answers.
 */
export default async function HqPartnersPage({
  searchParams,
}: PageProps<"/partners">) {
  const { status } = await searchParams;
  const filter = typeof status === "string" ? status : undefined;

  const [rows, totals, settings] = await Promise.all([
    getPartners(filter ? { status: filter } : undefined),
    getProgramTotals(),
    getProgramSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Partners"
        description={`People bringing creators to Sailo. They keep ${shareLabel(
          settings.commissionBp,
        )} of every invoice the creator they referred pays us, for as long as that subscription runs.`}
        action={
          <div className="flex gap-2">
            <Link
              href="/partners/payouts"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-sm font-medium text-white transition hover:bg-ink-800"
            >
              <Wallet className="size-4" />
              Payouts
            </Link>
            <Link
              href="/partners/settings"
              className="focus-ring inline-flex h-9 items-center rounded-xl border border-ink-200 px-3.5 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
            >
              Settings
            </Link>
          </div>
        }
      />

      <MetricRow>
        <Metric
          label="Approved"
          value={totals.approved.toLocaleString()}
          icon={<BadgeCheck className="size-4" />}
        />
        <Metric
          label="Awaiting review"
          value={totals.pending.toLocaleString()}
          icon={<Clock className="size-4" />}
          hint={totals.pending > 0 ? "Needs a decision" : undefined}
        />
        <Metric
          label="Creators referred"
          value={totals.referred.toLocaleString()}
          hint={`${totals.converted.toLocaleString()} now paying`}
          icon={<Users className="size-4" />}
        />
        <Metric
          label="Owed now"
          value={formatMoney(totals.owedCents, totals.currency)}
          hint={`${formatMoney(totals.paidCents, totals.currency)} paid to date`}
          icon={<Handshake className="size-4" />}
        />
      </MetricRow>

      <div className="mt-6">
        <StatusFilter active={filter} />
      </div>

      <Table
        className="mt-4"
        minWidth="72rem"
        head={
          <>
            <Th>Partner</Th>
            <Th>Status</Th>
            <Th align="end">Rate</Th>
            <Th align="end">Referred</Th>
            <Th align="end">Paying</Th>
            <Th align="end">Earned</Th>
            <Th align="end">Held</Th>
            <Th align="end">Ready</Th>
            <Th>Payouts</Th>
            <Th align="end">Decide</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={10}>
            {filter
              ? `Nobody is ${filter}.`
              : "Nobody has applied to the partner programme yet."}
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td className="max-w-64">
                <Link
                  href={`/partners/${row.id}`}
                  className="block truncate text-sm font-medium text-ink-900 hover:underline"
                >
                  {row.name}
                </Link>
                <span className="block truncate text-xs text-ink-400">
                  {row.email}
                  {row.shopHandle ? ` · /${row.shopHandle}` : " · no shop"}
                </span>
              </Td>

              <Td label="Status">
                <StatusPill status={row.status} />
              </Td>

              <Td align="end" className="tabular" label="Rate">
                <span className={row.hasCustomRate ? "font-medium text-brand-700" : ""}>
                  {shareLabel(row.commissionBp)}
                </span>
              </Td>

              <Td align="end" className="tabular" label="Referred">
                {row.referredCount.toLocaleString()}
              </Td>
              <Td align="end" className="tabular" label="Paying">
                {row.convertedCount.toLocaleString()}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Earned">
                {formatMoney(row.lifetimeCents, row.currency)}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Held">
                {row.heldCents === 0 ? (
                  <span className="text-ink-400">—</span>
                ) : (
                  <span className="text-ink-500">
                    {formatMoney(row.heldCents, row.currency)}
                  </span>
                )}
              </Td>

              <Td align="end" className="tabular whitespace-nowrap" label="Ready">
                {/*
                  A negative balance is a refund that landed after we paid out.
                  Shown as it is rather than clamped to zero — it works itself
                  off against the next invoice, and hiding it would mean the
                  column stopped summing to what the ledger says.
                */}
                {row.availableCents === 0 ? (
                  <span className="text-ink-400">—</span>
                ) : (
                  <span
                    className={
                      row.availableCents < 0
                        ? "font-medium text-red-700"
                        : row.payable
                          ? "font-medium text-amber-700"
                          : "text-ink-500"
                    }
                  >
                    {formatMoney(row.availableCents, row.currency)}
                  </span>
                )}
              </Td>

              <Td label="Payouts">
                <ConnectPill blocker={row.payoutBlocker} subscribed={row.subscribed} />
              </Td>

              <Td align="end" label="Decide">
                <DecideButtons partnerId={row.id} status={row.status} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        &ldquo;Ready&rdquo; is what has cleared the {settings.holdDays}-day hold
        and can be sent today; &ldquo;held&rdquo; is earned but still inside it,
        so a refund can still reverse it before the money leaves.{" "}
        {settings.autoPayout
          ? `Payouts run automatically on day ${settings.payoutDayOfMonth} of each month for anyone over ${formatMoney(settings.payoutMinimumCents, totals.currency)}.`
          : "Automatic payouts are off — nothing is sent until somebody runs them."}{" "}
        <Link href="/partners/settings" className="underline hover:no-underline">
          Change the terms
        </Link>
        .
      </p>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "pending"
        ? "bg-amber-50 text-amber-700"
        : status === "suspended"
          ? "bg-red-50 text-red-700"
          : "bg-ink-100 text-ink-600";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status}
    </span>
  );
}

/**
 * Whether Stripe would actually accept a transfer to this partner.
 *
 * Worth a column of its own: a partner sitting on a large balance they cannot
 * receive is a support problem rather than a payout problem, and it is
 * invisible if you only look at what is owed.
 */
function ConnectPill({
  blocker,
  subscribed,
}: {
  blocker: PayoutBlocker | null;
  subscribed: boolean;
}) {
  /*
   * Two independent facts in one cell, and the order matters. A partner can be
   * payable but lapsed — we owe them and they are no longer earning — and
   * showing only "Ready" would hide the thing HQ would actually want to know.
   */
  if (blocker) {
    const label: Record<PayoutBlocker, string> = {
      no_shop: "No shop",
      no_stripe: "No Stripe",
      stripe_incomplete: "Verifying",
    };
    const tone = blocker === "stripe_incomplete" ? "text-amber-700" : "text-ink-400";
    return <span className={`text-xs font-medium ${tone}`}>{label[blocker]}</span>;
  }

  return (
    <span className="text-xs font-medium text-emerald-700">
      Ready{subscribed ? "" : " · lapsed"}
    </span>
  );
}
