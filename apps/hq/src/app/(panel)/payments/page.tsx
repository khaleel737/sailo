import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Gavel, Undo2, Wallet } from "lucide-react";
import { Badge, PageHeader } from "@sailo/design-system/web";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Metric, MetricRow, Money, ShopCell, StripeLink, When } from "@/app/_components/hq-ui";
import { first, getPayments, pageNumber } from "@/lib/platform";
import { formatMoney } from "@sailo/core/currency";
import { isPaymentStatus, PAYMENT_STATUS_TONES } from "@sailo/core/payment-status";
import {
  disputeOutcome,
  DISPUTE_OUTCOME_TONES,
  type DisputeOutcome,
} from "@sailo/core/disputes";

/**
 * What a dispute's status is called on a staff screen.
 *
 * Through `disputeOutcome`, which folds Stripe's eight statuses into the four
 * things anybody needs to know, rather than printing the enum. This column read
 * `needs_response`, `won`, `lost` verbatim — machine values in a human table,
 * and the same page that shows a buyer's name and a formatted amount beside it.
 *
 * The outcome vocabulary is shared with the seller's own payments page, so a
 * chargeback is described the same way on both sides of the platform.
 */
const OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  needs_evidence: "Needs evidence",
  under_review: "With the bank",
  won: "Won",
  lost: "Lost",
  closed_no_loss: "Closed, no loss",
};

export const metadata: Metadata = { title: "Payments" };

const RAIL_OPTIONS = [
  { value: "all", label: "Any rail" },
  { value: "card", label: "Card (Stripe)" },
  { value: "offline", label: "Offline" },
];

const STATE_OPTIONS = [
  { value: "all", label: "Any state" },
  { value: "paid", label: "Paid, whole" },
  { value: "partial", label: "Partly refunded" },
  { value: "refunded", label: "Fully refunded" },
  { value: "disputed", label: "Disputed" },
  { value: "pending", label: "Pending" },
  { value: "unpaid", label: "Unpaid" },
];

const PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * Every payment on the platform, one row each.
 *
 * ─── WHY THIS IS NOT /orders ─────────────────────────────────────────────────
 * /orders answers "what did somebody buy" — the product, the buyer, whether it
 * shipped. This answers "what happened to the money", and the two only look
 * alike until one of them goes wrong. An order paid by card, partly refunded
 * and then charged back is one row on /orders reading `refunded`; here it is a
 * payment with a rail, a Stripe id, an amount that no longer matches what was
 * charged, and a bank arguing about it.
 *
 * The questions this exists for are the ones the orders table cannot answer:
 * which rail carried this, is it on the platform's Stripe account or the
 * seller's, has any of it come back, and is somebody disputing it.
 *
 * ─── AND WHY THERE IS NO `payments` TABLE BEHIND IT ──────────────────────────
 * Sailo is not merchant of record. A card payment is created on the seller's
 * own connected account and never touches a Sailo balance, so Stripe holds the
 * authoritative record and we hold the reference to it. Mirroring that into a
 * table of our own would buy a synchronisation problem and a second number for
 * "what was actually charged". This page is a projection of `orders` through
 * the money's eyes, and it writes nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function HqPaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    rail: first(params.rail),
    state: first(params.state),
    days: Number(first(params.days)) || undefined,
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages, volume, counts } = await getPayments(filters);

  return (
    <>
      <PageHeader
        title="Payments"
        description="What happened to the money, one row per payment. Orders are the other half of this — a purchase and its payment stop being the same story the moment one of them goes wrong."
        meta={
          <span className="tabular text-sm text-ink-500">
            <Money totals={volume} limit={3} />
          </span>
        }
      />

      <MetricRow>
        <Metric
          icon={<Wallet className="size-4" />}
          label="Payments"
          value={total.toLocaleString()}
          hint="Matching the filters below"
        />
        <Metric
          icon={<CreditCard className="size-4" />}
          label="On card"
          value={counts.card.toLocaleString()}
          hint="Everything else settled off Stripe"
        />
        <Metric
          icon={<Undo2 className="size-4" />}
          label="With a refund"
          value={counts.refunded.toLocaleString()}
          href="/payments?state=partial"
        />
        <Metric
          icon={<Gavel className="size-4" />}
          label="Disputed"
          value={counts.disputed.toLocaleString()}
          href={counts.disputed > 0 ? "/disputes" : undefined}
        />
      </MetricRow>

      <div className="mt-6">
        <HqFilters
          values={{
            q: filters.q,
            rail: filters.rail,
            state: filters.state,
            days: filters.days ? String(filters.days) : undefined,
          }}
          placeholder="Buyer, shop, or paste a pi_… / cs_… id"
          fields={[
            { name: "rail", label: "Rail", options: RAIL_OPTIONS },
            { name: "state", label: "State", options: STATE_OPTIONS },
            { name: "days", label: "Period", options: PERIOD_OPTIONS },
          ]}
        />
      </div>

      <Table
        minWidth="66rem"
        head={
          <>
            <Th>When</Th>
            <Th>Shop</Th>
            <Th>Buyer</Th>
            <Th>Rail</Th>
            <Th align="end">Charged</Th>
            <Th align="end">Refunded</Th>
            <Th>State</Th>
            <Th>Stripe</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>No payments match those filters.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.orderId}>
              <Td className="text-ink-500">
                <When value={row.createdAt} withTime />
              </Td>

              <Td label="Shop">
                <ShopCell
                  ownerId={row.ownerId}
                  name={row.shopName}
                  handle={row.handle}
                />
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
                {/*
                  Decided by whether Stripe processed it, not by the
                  `payment_method` column — that records what the buyer chose,
                  and a seller can name an offline method anything they like.
                */}
                {row.stripePaymentIntentId ? (
                  <Badge tone="blue">Card</Badge>
                ) : (
                  <span className="text-xs text-ink-500">{row.paymentMethod}</span>
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
                {/*
                  One chip, not two.

                  This rendered the payment status *and* the dispute status
                  stacked — "disputed" above "needs_response" — which is the
                  same fact twice and doubled the visual weight of the column on
                  every disputed row. Where there is a dispute it is the louder
                  and more specific of the two, so it replaces the payment
                  status rather than sitting under it; the payment status is
                  still `disputed` and saying so adds nothing.
                */}
                {row.disputeId ? (
                  <Link
                    href={`/disputes/${row.disputeId}`}
                    className="focus-ring rounded"
                  >
                    <Badge
                      tone={
                        DISPUTE_OUTCOME_TONES[
                          disputeOutcome(row.disputeStatus ?? "")
                        ]
                      }
                      dot
                    >
                      {OUTCOME_LABELS[disputeOutcome(row.disputeStatus ?? "")]}
                    </Badge>
                  </Link>
                ) : (
                  /*
                    Narrowed rather than indexed with a cast. The column is
                    `text`, so a status written by an older build is a string
                    this map has never heard of — and the honest rendering of
                    one is the raw value in a neutral chip, not a crash and not
                    a colour picked at random.
                  */
                  <Badge
                    tone={
                      isPaymentStatus(row.paymentStatus)
                        ? PAYMENT_STATUS_TONES[row.paymentStatus]
                        : "neutral"
                    }
                  >
                    {/*
                      Capitalised at the edge rather than stored that way. The
                      column is a machine enum and stays one; this is the only
                      place it is read by a person, and "disputed" sitting
                      beside "Needs evidence" reads as two different systems
                      talking.
                    */}
                    {row.paymentStatus.charAt(0).toUpperCase() + row.paymentStatus.slice(1)}
                  </Badge>
                )}
              </Td>

              <Td label="Stripe">
                {/*
                  Linked under the connected account where there is one. A
                  payment intent on a seller's account does not resolve on the
                  platform's dashboard URL, and a link that 404s is worse than
                  no link — somebody will conclude the payment does not exist.

                  Width-bounded so the id truncates inside its column instead of
                  running under the table's edge. `StripeLink` puts the full id
                  in `title`, and clicking it is the way anybody actually gets
                  to the object — reading 27 characters off a screen is not.
                */}
                <span className="block max-w-[11rem]">
                  <StripeLink
                    id={row.stripePaymentIntentId}
                    kind="payments"
                    account={row.stripeAccountId}
                  />
                </span>
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="payments"
        basePath="/payments"
        params={{
          q: filters.q,
          rail: filters.rail,
          state: filters.state,
          days: filters.days ? String(filters.days) : undefined,
        }}
      />
    </>
  );
}
