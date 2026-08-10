import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { ShopCell, When } from "@/app/hq/_components/hq-ui";
import { getReferrerBalances } from "@/lib/hq";
import {
  REFERRAL_PAYOUT_MINIMUM_CENTS,
  REFERRAL_SHARE_LABEL,
} from "@/lib/creator-referrals/program";
import { formatMoney } from "@/lib/utils";
import { PayoutButton } from "./_components/payout-button";

export const metadata: Metadata = { title: "Referrals" };

/**
 * What Sailo owes creators for the creators they brought us.
 *
 * Distinct from /hq/affiliates, which is commission a *seller* owes someone
 * for selling their products — money that never passes through us. This page
 * is our own liability, which is why it sits under Business next to Revenue
 * rather than beside the affiliate list it superficially resembles.
 *
 * No filters and no pagination: this is a monthly settlement list of a few
 * dozen rows, ordered by what we owe. When it needs paging it will have
 * earned it.
 */
export default async function HqReferralsPage() {
  const rows = await getReferrerBalances();

  const owed = rows.filter((row) => row.payable);
  const owedTotal = owed.reduce((sum, row) => sum + row.unpaidCents, 0);
  // The currency the ledger is actually in — read, not assumed.
  const currency = rows[0]?.currency ?? "USD";

  return (
    <>
      <PageHeader
        title="Referrals"
        description={`Creators who brought us other creators. They keep ${REFERRAL_SHARE_LABEL} of every invoice the creator they referred pays, for as long as that subscription runs.`}
      />

      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Referrer</Th>
            <Th align="end">Referred</Th>
            <Th align="end">Paying</Th>
            <Th align="end">Earned</Th>
            <Th align="end">Paid</Th>
            <Th align="end">Unpaid</Th>
            <Th>Last earned</Th>
            <Th align="end">Settle</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>
            Nobody has earned referral commission yet.
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={`${row.shopId}:${row.currency}`}>
              <Td className="max-w-56">
                <ShopCell
                  ownerId={row.ownerId}
                  name={row.shopName}
                  handle={row.shopHandle}
                />
                <span className="block truncate text-xs text-ink-400">
                  {row.ownerEmail}
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
              <Td align="end" className="tabular whitespace-nowrap" label="Paid">
                {formatMoney(row.paidCents, row.currency)}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Unpaid">
                {/*
                  A negative balance is a refund that landed after we paid out.
                  Shown as it is rather than clamped to zero — it works itself
                  off against the next invoice, and hiding it would mean the
                  column stopped summing to what the ledger says.
                */}
                {row.unpaidCents === 0 ? (
                  <span className="text-ink-400">—</span>
                ) : (
                  <span
                    className={
                      row.unpaidCents < 0
                        ? "font-medium text-red-700"
                        : row.payable
                          ? "font-medium text-amber-700"
                          : "text-ink-500"
                    }
                  >
                    {formatMoney(row.unpaidCents, row.currency)}
                  </span>
                )}
              </Td>
              <Td label="Last earned">
                <When value={row.lastEarnedAt} />
              </Td>
              <Td align="end" label="Settle">
                <PayoutButton shopId={row.shopId} disabled={!row.payable} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        {owed.length > 0
          ? `${owed.length} referrer${owed.length === 1 ? "" : "s"} over the ${formatMoney(
              REFERRAL_PAYOUT_MINIMUM_CENTS,
              currency,
            )} minimum, ${formatMoney(owedTotal, currency)} in total.`
          : `Nobody is over the ${formatMoney(REFERRAL_PAYOUT_MINIMUM_CENTS, currency)} minimum yet.`}{" "}
        Transfers are made by hand — &ldquo;Mark paid&rdquo; stamps the rows
        once the money has actually gone, and never edits an amount. Pressing
        it twice is safe.
      </p>
    </>
  );
}
