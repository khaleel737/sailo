import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@sailo/design-system/web";
import { PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Detail, Metric, MetricRow, Mono, When } from "@/app/_components/hq-ui";
import { getPartnerDetail } from "@/lib/platform/partners";
import { getProgramSettings } from "@sailo/partners/settings";
import { referralUrl, shareLabel } from "@sailo/partners/program";
import { formatMoney } from "@sailo/core/currency";
import { DecideButtons } from "../_components/decide-buttons";
import { MarkSettledButton, PayNowButton } from "../_components/payout-buttons";
import { PartnerControls } from "../_components/partner-controls";

export const metadata: Metadata = { title: "Partner" };

/**
 * One partner, in full: who they are, what they've brought us, every ledger
 * row and every payout we've attempted.
 *
 * The earnings table shows the rate each row was computed at. That column
 * looks redundant until the day somebody changes the programme rate — every
 * row keeps the terms it was written under, and this is where you can see it.
 */
export default async function HqPartnerDetailPage({
  params,
}: PageProps<"/partners/[id]">) {
  const { id } = await params;
  const [detail, settings] = await Promise.all([
    getPartnerDetail(id),
    getProgramSettings(),
  ]);
  if (!detail) notFound();

  const { partner, referrals, earnings, payouts } = detail;
  const money = (cents: number) => formatMoney(cents, partner.currency);

  return (
    <>
      <PageHeader
        back={{ href: "/partners", label: "Partners" }}
        title={partner.name}
        description={partner.email}
        action={<DecideButtons partnerId={partner.id} status={partner.status} />}
      />

      <MetricRow>
        <Metric
          label="Ready to pay"
          value={money(partner.availableCents)}
          hint={
            partner.payable
              ? "Over the minimum"
              : `Under the ${money(settings.payoutMinimumCents)} minimum`
          }
        />
        <Metric
          label="Held"
          value={money(partner.heldCents)}
          hint={`${settings.holdDays}-day hold`}
        />
        <Metric label="Paid to date" value={money(partner.paidCents)} />
        <Metric
          label="Creators"
          value={`${partner.convertedCount} of ${partner.referredCount}`}
          hint="Paying / referred"
        />
      </MetricRow>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* ---- Who they are -------------------------------------------- */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            The application
          </h2>
          <dl className="space-y-2.5">
            <Detail label="Status">
              <span className="capitalize">{partner.status}</span>
            </Detail>
            <Detail label="Applied">
              <When value={partner.appliedAt} />
            </Detail>
            {detail.reviewedAt ? (
              <Detail label="Reviewed">
                <When value={detail.reviewedAt} />
                {detail.reviewedBy ? ` by ${detail.reviewedBy}` : ""}
              </Detail>
            ) : null}
            <Detail label="Shop">
              {partner.shopHandle ? (
                <Link
                  href={`/${partner.shopHandle}`}
                  className="underline hover:no-underline"
                >
                  /{partner.shopHandle}
                </Link>
              ) : (
                <span className="text-ink-400">
                  No shop — audience partner
                </span>
              )}
            </Detail>
            <Detail label="Promoting on">
              {partner.website ? (
                <a
                  href={partner.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:no-underline"
                >
                  {partner.website}
                </a>
              ) : (
                <span className="text-ink-400">—</span>
              )}
            </Detail>
            <Detail label="Audience">
              {partner.audience ?? <span className="text-ink-400">—</span>}
            </Detail>
            <Detail label="Link">
              {partner.code ? (
                <Mono>{referralUrl(partner.code)}</Mono>
              ) : (
                <span className="text-ink-400">Not issued yet</span>
              )}
            </Detail>
          </dl>

          {detail.pitch ? (
            <>
              <h3 className="mb-1 mt-4 text-xs font-medium text-ink-500">
                What they told us
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                {detail.pitch}
              </p>
            </>
          ) : null}

          {detail.reviewNote ? (
            <>
              <h3 className="mb-1 mt-4 text-xs font-medium text-ink-500">
                Note shown to them
              </h3>
              <p className="text-sm text-ink-700">{detail.reviewNote}</p>
            </>
          ) : null}
        </Card>

        {/* ---- What we control ----------------------------------------- */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink-900">Payouts</h2>
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              {partner.connectReady
                ? "Commission goes to the same Stripe account their shop sells through."
                : "Their shop's Stripe account can't take a transfer yet."}
            </p>
            <dl className="space-y-2.5">
              <Detail label="Connect">
                <span>
                  {partner.payoutBlocker
                    ? {
                        no_shop: "No shop",
                        no_stripe: "Stripe not connected",
                        stripe_incomplete: "Stripe still verifying",
                      }[partner.payoutBlocker]
                    : "Ready"}
                </span>
              </Detail>
              <Detail label="Country">
                {partner.stripeAccountCountry ?? (
                  <span className="text-ink-400">—</span>
                )}
              </Detail>
              {/*
                Whether they can accrue at all. Separate from Connect on
                purpose: a lapsed partner is payable (we still owe them) but
                not earning, and one line conflating the two would have HQ
                chasing a Stripe problem that isn't there.
              */}
              <Detail label="Subscription">
                {partner.subscribed ? (
                  "Active"
                ) : (
                  <span className="text-amber-700">
                    Lapsed — not accruing new commission
                  </span>
                )}
              </Detail>
            </dl>

            <div className="mt-4 space-y-2">
              {partner.payable && partner.connectReady ? (
                <PayNowButton partnerId={partner.id} currency={partner.currency} />
              ) : null}
              {partner.availableCents > 0 ? (
                <MarkSettledButton partnerId={partner.id} />
              ) : null}
            </div>
          </Card>

          <PartnerControls
            partnerId={partner.id}
            commissionBp={partner.commissionBp}
            hasCustomRate={partner.hasCustomRate}
            defaultBp={settings.commissionBp}
            notes={detail.notes}
          />
        </div>
      </div>

      {/* ---- Who they brought ------------------------------------------ */}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">
        Creators they brought
      </h2>
      <Table
        minWidth="48rem"
        head={
          <>
            <Th>Creator</Th>
            <Th>Joined</Th>
            <Th>Converted</Th>
            <Th align="end">Earned</Th>
          </>
        }
      >
        {referrals.length === 0 ? (
          <EmptyRow colSpan={4}>Nobody has signed up through their link.</EmptyRow>
        ) : (
          referrals.map((row) => (
            <Tr key={row.shopHandle}>
              <Td>
                <Link
                  href={`/${row.shopHandle}`}
                  className="text-sm font-medium text-ink-900 hover:underline"
                >
                  {row.shopName}
                </Link>
                <span className="block text-xs text-ink-400">/{row.shopHandle}</span>
              </Td>
              <Td label="Joined">
                <When value={row.attributedAt} />
              </Td>
              <Td label="Converted">
                {row.convertedAt ? (
                  <When value={row.convertedAt} />
                ) : (
                  <span className="text-xs text-ink-400">Still on free</span>
                )}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Earned">
                {money(row.earnedCents)}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      {/* ---- The ledger ------------------------------------------------- */}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">
        Ledger
      </h2>
      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Invoice</Th>
            <Th>Kind</Th>
            <Th align="end">Rate</Th>
            <Th align="end">Amount</Th>
            <Th>Earned</Th>
            <Th>Matures</Th>
            <Th>Settled</Th>
          </>
        }
      >
        {earnings.length === 0 ? (
          <EmptyRow colSpan={7}>Nothing earned yet.</EmptyRow>
        ) : (
          earnings.map((row) => (
            <Tr key={row.id}>
              <Td>
                <Mono>{row.stripeInvoiceId}</Mono>
              </Td>
              <Td label="Kind">
                <span
                  className={`text-xs font-medium ${
                    row.kind === "reversal" ? "text-red-700" : "text-ink-600"
                  }`}
                >
                  {row.kind}
                </span>
              </Td>
              <Td align="end" className="tabular" label="Rate">
                {shareLabel(row.commissionBp)}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Amount">
                <span className={row.amountCents < 0 ? "text-red-700" : ""}>
                  {formatMoney(row.amountCents, row.currency)}
                </span>
              </Td>
              <Td label="Earned">
                <When value={row.createdAt} />
              </Td>
              <Td label="Matures">
                {row.matureAt > new Date() ? (
                  <span className="text-xs font-medium text-amber-700">
                    <When value={row.matureAt} />
                  </span>
                ) : (
                  <span className="text-xs text-ink-400">Out of hold</span>
                )}
              </Td>
              <Td label="Settled">
                {row.paidOutAt ? (
                  <When value={row.paidOutAt} />
                ) : (
                  <span className="text-xs text-ink-400">—</span>
                )}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      {/* ---- Payout history --------------------------------------------- */}

      {payouts.length > 0 ? (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">
            Payouts
          </h2>
          <Table
            minWidth="56rem"
            head={
              <>
                <Th align="end">Amount</Th>
                <Th>Status</Th>
                <Th>By</Th>
                <Th>Transfer</Th>
                <Th>When</Th>
              </>
            }
          >
            {payouts.map((row) => (
              <Tr key={row.id}>
                <Td align="end" className="tabular whitespace-nowrap" label="Amount">
                  {formatMoney(row.amountCents, row.currency)}
                </Td>
                <Td label="Status">
                  <span
                    className={`text-xs font-medium ${
                      row.status === "paid"
                        ? "text-emerald-700"
                        : row.status === "failed"
                          ? "text-red-700"
                          : "text-amber-700"
                    }`}
                  >
                    {row.status === "paid"
                      ? "Paid"
                      : row.status === "failed"
                        ? `Failed${row.failureReason ? ` — ${row.failureReason}` : ""}`
                        : "In flight"}
                  </span>
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
            ))}
          </Table>
        </>
      ) : null}
    </>
  );
}
