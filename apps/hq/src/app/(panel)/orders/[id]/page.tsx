import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CreditCard,
  Fingerprint,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Alert, Badge, Card, PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import {
  Detail,
  Mono,
  RowLink,
  SectionTitle,
  StripeLink,
  When,
} from "@/app/_components/hq-ui";
import { getPlatformOrder, type PlatformOrder } from "@/lib/platform";
import { formatMoment } from "@/lib/format";
import { formatMoney } from "@sailo/core/currency";
import { orderSummaryTitle, lineTitle, type OrderLine } from "@sailo/core/order-lines";
import { orderStatusTone } from "@sailo/core/order-status";
import { PAYMENT_STATUS_TONES } from "@sailo/core/payment-status";
import { taxLabel } from "@sailo/core/tax-label";
import { formatPercent } from "@sailo/core/pricing";
import { countryFlag, countryName } from "@sailo/core/countries";
import { playbookFor } from "@sailo/core/disputes";

export async function generateMetadata({
  params,
}: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getPlatformOrder(id);
  return {
    title: detail ? `Order · ${orderSummaryTitle(detail.order)}` : "Order",
  };
}

/**
 * One order, read cold.
 *
 * The row in the list says what happened. This says whether it should have,
 * and it is written to be opened by somebody holding a support email, a
 * chargeback notice or a fraud report — none of whom know anything about this
 * sale except the number at the top of the message they are holding.
 *
 * Laid out in the order those questions get asked:
 *
 *   1. Anything wrong with it *now* — a chargeback, a fraud warning, money
 *      taken for goods nobody sent. Above everything else, because each one
 *      changes what the rest of the page means.
 *   2. What was actually bought, from the lines rather than the header.
 *   3. Where the money went, including the tax snapshot an invoice is bound by.
 *   4. Who the buyer is, and what else they have done here and elsewhere.
 *   5. Whether it was delivered, by whichever of the four mechanisms applies.
 *   6. The forensics a bank will ask for, and the leads they open.
 *
 * Read-only, and every id is shown rather than acted on: refunding, cancelling
 * and re-sending live on the seller's own screens, where the person doing it
 * is the person answerable for it.
 */
export default async function HqOrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const detail = await getPlatformOrder(id);
  if (!detail) notFound();

  const {
    order,
    lines,
    itemRowCount,
    shop,
    owner,
    invoice,
    client,
    disputes,
    warnings,
    downloads,
    tickets,
    affiliate,
    coupon,
    subscription,
    device,
    buyer,
    sameIp,
  } = detail;

  const money = (cents: number) => formatMoney(cents, order.currency);
  const netCents = order.totalCents - order.refundedCents;

  const openDispute = disputes.find((d) => !d.evidenceSubmittedAt);
  const unrefundedWarning = warnings.find((w) => !w.refundedAt);
  /* Paid, and nobody has delivered it — the shape `openObligations` refuses a
     closure on, and the one thing on this page a buyer is owed money over. */
  const owedGoods =
    order.paymentStatus === "paid" &&
    (order.status === "new" || order.status === "confirmed");
  /* A multi-line order with no rows. `linesFor` refuses to invent one. */
  const missingLines = lines.length === 0;

  return (
    <>
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={orderSummaryTitle(order)}
        description={
          shop
            ? `${shop.name} · /${shop.handle} · placed ${formatMoment(order.createdAt)}`
            : `Placed ${formatMoment(order.createdAt)}`
        }
        meta={
          <>
            <Badge tone={orderStatusTone(order.status)} dot>
              {order.status}
            </Badge>
            <Badge
              tone={
                PAYMENT_STATUS_TONES[
                  order.paymentStatus as keyof typeof PAYMENT_STATUS_TONES
                ] ?? "neutral"
              }
            >
              {order.paymentStatus}
            </Badge>
            {order.subscriptionId ? (
              <Badge tone="blue">Membership renewal</Badge>
            ) : null}
          </>
        }
      />

      {/* ---------------------------------------------------------------- */}
      {/*  What is wrong with this order, if anything.                      */}
      {/* ---------------------------------------------------------------- */}

      <div className="mb-6 space-y-3">
        {missingLines ? (
          <Alert
            tone="error"
            title="This order's lines are missing"
            icon={<AlertTriangle className="size-5" />}
          >
            The header claims {order.itemCount} lines and no <Mono>order_items</Mono>{" "}
            rows exist. Nothing is shown below rather than a plausible single line
            invented from the header — that invention is what previously charged a
            buyer the wrong money. Treat every figure on this page as unverified.
          </Alert>
        ) : null}

        {openDispute ? (
          <Alert
            tone="error"
            title="A chargeback on this order is still unanswered"
            icon={<ShieldAlert className="size-5" />}
          >
            {playbookFor(openDispute.reason).label} —{" "}
            {money(openDispute.deductedCents)} has already left the balance.{" "}
            <Link
              href={`/disputes/${openDispute.id}`}
              className="underline underline-offset-4"
            >
              Answer it
            </Link>
            {openDispute.dueBy
              ? ` before ${openDispute.dueBy.toISOString().slice(0, 10)}.`
              : "."}
          </Alert>
        ) : null}

        {unrefundedWarning ? (
          <Alert
            tone="warning"
            title="Stripe warned this charge was fraudulent, and it has not been refunded"
            icon={<AlertTriangle className="size-5" />}
          >
            <Mono>{unrefundedWarning.fraudType}</Mono>, reported{" "}
            {formatMoment(unrefundedWarning.stripeCreatedAt)}. Refunding now avoids
            the chargeback and its fee; it does not clear the fraud report itself,
            which counts towards the network programmes either way.
          </Alert>
        ) : null}

        {owedGoods ? (
          <Alert
            tone="warning"
            title="Paid, and not yet delivered"
            icon={<PackageCheck className="size-5" />}
          >
            The buyer has paid {money(order.totalCents)} and the order is still{" "}
            <Mono>{order.status}</Mono>. This is an obligation the shop owes —
            account deletion is refused while one stands, and a closure record
            counts it.
          </Alert>
        ) : null}

        {order.status === "cancelled" ? (
          <Alert tone="info" title="Cancelled" icon={<Ban className="size-5" />}>
            Cancelled orders are excluded from every revenue figure on the platform.{" "}
            {order.restockedAt
              ? `Stock went back on the shelf ${formatMoment(order.restockedAt)}.`
              : "Nothing has been restocked against it."}
          </Alert>
        ) : null}

        {order.refundedCents > 0 ? (
          <Alert
            tone="info"
            title={`${money(order.refundedCents)} refunded`}
            icon={<RotateCcw className="size-5" />}
          >
            {order.refundedAt ? formatMoment(order.refundedAt) : "Date not recorded"}
            {order.refundReason ? ` — ${order.refundReason}` : ""}.{" "}
            {order.refundedCents >= order.totalCents
              ? "Refunded in full."
              : `${money(netCents)} of it stands.`}
          </Alert>
        ) : null}
      </div>

      {/* ---------------------------------------------------------------- */}

      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Placed">
          <When value={order.createdAt} withTime />
        </Detail>
        <Detail label="Total">
          <span className="tabular">{money(order.totalCents)}</span>
          {order.refundedCents > 0 ? (
            <span className="tabular block text-xs text-red-600">
              −{money(order.refundedCents)} refunded
            </span>
          ) : null}
        </Detail>
        <Detail label="Shop">
          {shop && owner ? (
            <>
              <Link
                href={`/accounts/${owner.id}`}
                className="underline underline-offset-4"
              >
                {shop.name}
              </Link>
              <span className="block truncate text-xs text-ink-400">
                {owner.email}
              </span>
            </>
          ) : (
            <span className="text-ink-400">Shop no longer exists</span>
          )}
        </Detail>
        <Detail label="Buyer">
          {order.customerName ?? "Anonymous"}
          {order.customerEmail ? (
            <span className="block truncate text-xs text-ink-400">
              {order.customerEmail}
            </span>
          ) : null}
        </Detail>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>What was bought</SectionTitle>
      <Table
        minWidth="44rem"
        head={
          <>
            <Th>Item</Th>
            <Th>Kind</Th>
            <Th align="end">Unit</Th>
            <Th align="end">Qty</Th>
            <Th align="end">Subtotal</Th>
          </>
        }
      >
        {lines.length === 0 ? (
          <EmptyRow colSpan={5}>
            No lines could be read for this order.
          </EmptyRow>
        ) : (
          lines.map((line) => (
            <Tr key={line.id}>
              <Td className="max-w-80">
                <span className="block truncate text-ink-900">{lineTitle(line)}</span>
                <LineHint line={line} />
              </Td>
              <Td label="Kind">
                <Badge tone="neutral">{line.kind}</Badge>
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Unit">
                {money(line.unitPriceCents)}
              </Td>
              <Td align="end" className="tabular" label="Qty">
                {line.quantity}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Subtotal">
                {money(line.subtotalCents)}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      {itemRowCount === 0 && lines.length > 0 ? (
        <p className="mt-2 text-xs text-ink-500">
          Read from the order&rsquo;s own columns rather than from{" "}
          <Mono>order_items</Mono> — a single-line order, or one written before
          carts existed.
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>The money</SectionTitle>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="p-4">
          <dl className="space-y-2 text-sm">
            <MoneyRow label="Subtotal">{money(order.subtotalCents)}</MoneyRow>
            {order.discountCents > 0 ? (
              <MoneyRow label={order.couponCode ? `Discount · ${order.couponCode}` : "Discount"} tone="down">
                −{money(order.discountCents)}
              </MoneyRow>
            ) : null}
            {order.deliveryFeeCents > 0 ? (
              <MoneyRow label={order.deliveryLabel ?? "Delivery"}>
                {money(order.deliveryFeeCents)}
              </MoneyRow>
            ) : null}
            {order.taxCents > 0 || order.taxRateBp > 0 ? (
              <MoneyRow
                label={`${taxLabel(order)}${order.taxInclusive ? " · included" : ""}`}
              >
                {money(order.taxCents)}
              </MoneyRow>
            ) : null}
            <MoneyRow label="Total" strong>
              {money(order.totalCents)}
            </MoneyRow>
            {order.refundedCents > 0 ? (
              <>
                <MoneyRow label="Refunded" tone="down">
                  −{money(order.refundedCents)}
                </MoneyRow>
                <MoneyRow label="Net" strong>
                  {money(netCents)}
                </MoneyRow>
              </>
            ) : null}
          </dl>

          {order.presentmentCurrency &&
          order.presentmentAmountCents !== null ? (
            <p className="mt-3 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500">
              The buyer&rsquo;s card was charged{" "}
              <span className="tabular">
                {formatMoney(
                  order.presentmentAmountCents,
                  order.presentmentCurrency,
                )}
              </span>{" "}
              — Stripe converted it. Every figure above is the shop&rsquo;s own
              currency, which is what the seller is paid and what the invoice
              states.
            </p>
          ) : null}
        </Card>

        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Detail label="Tax treatment">
            {order.taxCents > 0 || order.taxRateBp > 0
              ? `${taxLabel(order)} — ${order.taxInclusive ? "included in the total" : "added to the total"}`
              : "No tax charged"}
          </Detail>
          <Detail label="Reverse charge">
            {order.taxReverseCharge
              ? "Yes — the buyer accounts for the tax"
              : "No"}
          </Detail>
          <Detail label="Buyer tax id">
            {order.buyerTaxId ? (
              <>
                <Mono>{order.buyerTaxId}</Mono>
                {order.buyerTaxIdType ? (
                  <span className="block text-xs text-ink-400">
                    {order.buyerTaxIdType}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-400">—</span>
            )}
          </Detail>
          <Detail label="Invoice">
            {invoice ? (
              <>
                <Mono>{invoice.number}</Mono>
                <span className="block text-xs text-ink-400">
                  Issued {formatMoment(invoice.issuedAt)}
                  {invoice.sentAt ? ` · sent to ${invoice.sentTo ?? "the buyer"}` : " · never sent"}
                </span>
              </>
            ) : (
              <span className="text-ink-400">None issued</span>
            )}
          </Detail>
          {order.commissionCents > 0 ? (
            <Detail label="Affiliate commission">
              {money(order.commissionCents)}
              <span className="block text-xs text-ink-400">
                {order.commissionPaid ? "Paid out" : "Not yet paid"}
              </span>
            </Detail>
          ) : null}
          <Detail label="Counts towards revenue">
            {order.status === "cancelled"
              ? "No — cancelled"
              : order.refundedCents >= order.totalCents
                ? "No — fully refunded"
                : "Yes"}
          </Detail>
        </Card>
      </div>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Payment</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Method">
          <span className="inline-flex items-center gap-1.5">
            <CreditCard className="size-3.5 text-ink-400" />
            {order.paymentMethod}
          </span>
        </Detail>
        <Detail label="Status">
          <Badge
            tone={
              PAYMENT_STATUS_TONES[
                order.paymentStatus as keyof typeof PAYMENT_STATUS_TONES
              ] ?? "neutral"
            }
          >
            {order.paymentStatus}
          </Badge>
        </Detail>
        <Detail label="Transfer reference">
          {order.paymentReference ? (
            <Mono>{order.paymentReference}</Mono>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Proof of payment">
          {order.paymentProofUrl ? (
            <a
              href={order.paymentProofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              What the buyer uploaded
            </a>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Checkout session">
          <StripeLink
            id={order.stripeSessionId}
            kind="payments"
            account={order.stripeAccountId}
          />
        </Detail>
        <Detail label="Payment intent">
          <StripeLink
            id={order.stripePaymentIntentId}
            kind="payments"
            account={order.stripeAccountId}
          />
        </Detail>
        <Detail label="Connected account">
          <StripeLink id={order.stripeAccountId} kind="connect/accounts" />
        </Detail>
        <Detail label="Confirmation email">
          {order.confirmationSentAt ? (
            formatMoment(order.confirmationSentAt)
          ) : (
            <span className="text-ink-400">Never sent</span>
          )}
        </Detail>
        {subscription || order.stripeInvoiceId || order.membershipPeriodEnd ? (
          <Detail label="Membership">
            {subscription ? (
              <>
                <Mono>{subscription.status}</Mono>
                <span className="block text-xs text-ink-400">
                  {subscription.billingMode} · paid to{" "}
                  {subscription.currentPeriodEnd
                    ? formatMoment(subscription.currentPeriodEnd)
                    : "—"}
                </span>
              </>
            ) : (
              <span className="text-ink-400">
                Subscription row no longer exists
              </span>
            )}
            {order.stripeInvoiceId ? (
              <span className="block text-xs text-ink-400">
                <Mono>{order.stripeInvoiceId}</Mono>
              </span>
            ) : null}
          </Detail>
        ) : null}
      </Card>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>The buyer</SectionTitle>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Detail label="Name">{order.customerName ?? "Anonymous"}</Detail>
          <Detail label="Email">
            {order.customerEmail ?? <span className="text-ink-400">—</span>}
          </Detail>
          <Detail label="Phone">
            {order.customerPhone ?? <span className="text-ink-400">—</span>}
          </Detail>
          <Detail label="Country">
            {order.country ? (
              <>
                {countryFlag(order.country)} {countryName(order.country)}
              </>
            ) : (
              <span className="text-ink-400">—</span>
            )}
          </Detail>
          <Detail label="Address" className="sm:col-span-2">
            <Address order={order} />
          </Detail>
          {order.note ? (
            <Detail label="Buyer's note" className="sm:col-span-2">
              <span className="block whitespace-pre-wrap break-words text-ink-700">
                {order.note}
              </span>
            </Detail>
          ) : null}
          <Detail label="Accepted the shop's terms">
            {order.termsAcceptedAt ? (
              formatMoment(order.termsAcceptedAt)
            ) : (
              <span className="text-ink-400">Not asked, or not recorded</span>
            )}
          </Detail>
          <Detail label="Shop's record of them">
            {client ? (
              <>
                {client.name}
                <span className="block text-xs text-ink-400">
                  {client.tags.length > 0 ? client.tags.join(", ") : "no tags"} ·{" "}
                  {client.marketingConsentAt
                    ? `marketing consent ${client.marketingConsentAt.toISOString().slice(0, 10)}`
                    : "no marketing consent"}
                </span>
              </>
            ) : (
              <span className="text-ink-400">
                Guest checkout — no client row
              </span>
            )}
          </Detail>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-900">
            What else they have bought
          </h3>
          {buyer.onThisShop ? (
            <div className="space-y-1.5 text-sm text-ink-700">
              <p>
                <span className="tabular font-medium">
                  {buyer.onThisShop.orders}
                </span>{" "}
                order{buyer.onThisShop.orders === 1 ? "" : "s"} from this shop,{" "}
                <span className="tabular">
                  {money(buyer.onThisShop.spentCents)}
                </span>{" "}
                net.
              </p>
              <p className="text-xs text-ink-500">
                First {formatMoment(buyer.onThisShop.firstAt)}, last{" "}
                {formatMoment(buyer.onThisShop.lastAt)}. Matched on{" "}
                {buyer.onThisShop.matchedBy === "client"
                  ? "the shop's client record"
                  : "their email address"}
                .
              </p>
              {buyer.onThisShop.disputed > 0 || buyer.onThisShop.refunded > 0 ? (
                <p className="text-xs text-amber-700">
                  {buyer.onThisShop.disputed} disputed ·{" "}
                  {buyer.onThisShop.refunded} refunded
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              Nothing identifies this buyer across orders — no client record and
              no email address.
            </p>
          )}

          {buyer.acrossSailo ? (
            <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-3 text-sm text-ink-700">
              <p>
                <span className="tabular font-medium">
                  {buyer.acrossSailo.orders}
                </span>{" "}
                order{buyer.acrossSailo.orders === 1 ? "" : "s"} across{" "}
                <span className="tabular">{buyer.acrossSailo.shops}</span> shop
                {buyer.acrossSailo.shops === 1 ? "" : "s"} on Sailo.
              </p>
              {buyer.acrossSailo.disputed > 0 ? (
                <p className="text-xs font-medium text-red-600">
                  {buyer.acrossSailo.disputed} of them disputed — a pattern no
                  single seller can see.
                </p>
              ) : (
                <p className="text-xs text-ink-500">
                  None of them disputed. Matched on the email address alone.
                </p>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Where this came from</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Affiliate">
          {order.affiliateCode ? (
            <>
              <Mono>{order.affiliateCode}</Mono>
              <span className="block text-xs text-ink-400">
                {affiliate
                  ? `${affiliate.name} · ${affiliate.status}`
                  : "affiliate record deleted"}
              </span>
            </>
          ) : (
            <span className="text-ink-400">Not referred</span>
          )}
        </Detail>
        <Detail label="Coupon">
          {order.couponCode ? (
            <>
              <Mono>{order.couponCode}</Mono>
              <span className="block text-xs text-ink-400">
                {coupon
                  ? coupon.discountType === "percent"
                    ? `${formatPercent(coupon.discountValue)}% off · used ${coupon.timesRedeemed} time${coupon.timesRedeemed === 1 ? "" : "s"}`
                    : `${money(coupon.discountValue)} off · used ${coupon.timesRedeemed} time${coupon.timesRedeemed === 1 ? "" : "s"}`
                  : "coupon deleted"}
              </span>
            </>
          ) : (
            <span className="text-ink-400">None</span>
          )}
        </Detail>
        <Detail label="Closed on">{order.paymentMethod}</Detail>
        <Detail label="Device">
          {order.buyerUserAgent ? (
            <>
              {device.device}
              <span className="block text-xs text-ink-400">
                {[device.browser, device.os].filter(Boolean).join(" · ") ||
                  "unrecognised"}
              </span>
            </>
          ) : (
            <span className="text-ink-400">Not recorded</span>
          )}
        </Detail>
      </Card>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-500">
        <strong>The traffic source is not recorded per order.</strong> Visits carry
        the referrer, the campaign and the country, but the identifier joining them
        is derived per request and never stored — so nothing links this sale back to
        the visit that produced it. The referral and coupon codes above are the only
        attribution an order carries. Absence here means <em>unrecorded</em>, never
        &ldquo;direct&rdquo;.
      </p>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Fulfilment</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="How it goes out">
          {order.deliveryMethod ?? (
            <span className="text-ink-400">Nothing to ship</span>
          )}
          {order.deliveryLabel ? (
            <span className="block text-xs text-ink-400">
              {order.deliveryLabel}
            </span>
          ) : null}
        </Detail>
        <Detail label="Pickup location">
          {order.pickupLocation ?? <span className="text-ink-400">—</span>}
        </Detail>
        <Detail label="Shipped">
          {order.shippedAt ? (
            formatMoment(order.shippedAt)
          ) : (
            <span className="text-ink-400">Not yet</span>
          )}
        </Detail>
        <Detail label="Carrier">
          {order.trackingCarrier ?? <span className="text-ink-400">—</span>}
        </Detail>
        <Detail label="Tracking number">
          {order.trackingNumber ? (
            order.trackingUrl ? (
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                <Mono>{order.trackingNumber}</Mono>
              </a>
            ) : (
              <Mono>{order.trackingNumber}</Mono>
            )
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Restocked">
          {order.restockedAt ? (
            formatMoment(order.restockedAt)
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>

        {order.scheduledFor ? (
          <>
            <Detail label="Appointment">
              {formatMoment(order.scheduledFor)}
            </Detail>
            <Detail label="Held">
              {order.serviceMode ?? "—"}
              {order.serviceLocation ? (
                <span className="block text-xs text-ink-400">
                  {order.serviceLocation}
                </span>
              ) : null}
            </Detail>
          </>
        ) : null}

        {order.downloadToken ? (
          <>
            <Detail label="Files released">
              {order.downloadReleasedAt ? (
                formatMoment(order.downloadReleasedAt)
              ) : (
                <span className="text-ink-400">Still locked</span>
              )}
            </Detail>
            <Detail label="Downloads">
              <span className="tabular">
                {order.downloadCount}
                {order.downloadLimit ? ` of ${order.downloadLimit}` : ""}
              </span>
              {order.downloadExpiresAt ? (
                <span className="block text-xs text-ink-400">
                  expires {formatMoment(order.downloadExpiresAt)}
                </span>
              ) : null}
            </Detail>
          </>
        ) : null}
      </Card>

      {downloads.length > 0 ? (
        <>
          <SectionTitle>Every file this buyer took</SectionTitle>
          <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
            Stripe&rsquo;s <Mono>access_activity_log</Mono>, and the whole of the
            evidence on a digital sale. A download from the same address the
            purchase was made from is very hard for an issuer to argue with.
          </p>
          <Table
            minWidth="38rem"
            head={
              <>
                <Th>When</Th>
                <Th>File</Th>
                <Th>From</Th>
                <Th>Browser</Th>
              </>
            }
          >
            {downloads.map((event) => (
              <Tr key={event.id}>
                <Td className="whitespace-nowrap text-ink-500" label="When">
                  <When value={event.at} withTime />
                </Td>
                <Td className="max-w-64" label="File">
                  <span className="block truncate">{event.fileName ?? "—"}</span>
                </Td>
                <Td label="From">
                  <Mono>{event.ip ?? "—"}</Mono>
                  {event.ip && event.ip === order.buyerIp ? (
                    <span className="ms-1.5 text-xs text-emerald-600">
                      same as purchase
                    </span>
                  ) : null}
                </Td>
                <Td className="max-w-56" label="Browser">
                  <span className="block truncate text-xs text-ink-500">
                    {parsedBrowser(event.userAgent)}
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      {tickets.length > 0 ? (
        <>
          <SectionTitle>Admissions</SectionTitle>
          <Table
            minWidth="38rem"
            head={
              <>
                <Th>Code</Th>
                <Th>Attendee</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
                <Th align="end">Used</Th>
              </>
            }
          >
            {tickets.map((ticket) => (
              <Tr key={ticket.id}>
                <Td>
                  <Mono>{ticket.code}</Mono>
                </Td>
                <Td className="max-w-48" label="Attendee">
                  <span className="block truncate">
                    {ticket.attendeeName ?? order.customerName ?? "—"}
                  </span>
                </Td>
                <Td label="Tier">{ticket.tier ?? "—"}</Td>
                <Td label="Status">
                  <Badge
                    tone={
                      ticket.status === "used"
                        ? "green"
                        : ticket.status === "void"
                          ? "red"
                          : "neutral"
                    }
                  >
                    {ticket.status}
                  </Badge>
                </Td>
                <Td align="end" className="text-ink-500" label="Used">
                  <When value={ticket.usedAt} withTime />
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Trust &amp; safety</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Address it came from">
          {order.buyerIp ? (
            <Mono>{order.buyerIp}</Mono>
          ) : (
            <span className="text-ink-400">Not recorded</span>
          )}
        </Detail>
        <Detail label="Device fingerprint">
          {order.buyerDeviceFingerprint ? (
            <Mono>{order.buyerDeviceFingerprint.slice(0, 24)}…</Mono>
          ) : (
            <span className="text-ink-400">None offered</span>
          )}
        </Detail>
        <Detail label="Terms accepted">
          {order.termsAcceptedAt ? (
            <span className="text-emerald-700">
              {order.termsAcceptedAt.toISOString().slice(0, 10)}
            </span>
          ) : (
            <span className="text-ink-400">No</span>
          )}
        </Detail>
        <Detail label="Evidence held">
          <CompellingEvidence order={order} />
        </Detail>
        <Detail label="Browser string" className="sm:col-span-2 lg:col-span-4">
          {order.buyerUserAgent ? (
            <span className="block break-words font-mono text-xs text-ink-600">
              {order.buyerUserAgent}
            </span>
          ) : (
            <span className="text-ink-400">Not recorded</span>
          )}
        </Detail>
      </Card>

      {sameIp.rows.length > 0 ? (
        <>
          <SectionTitle>
            Other orders from this address, across every shop
          </SectionTitle>
          <p className="-mt-2 mb-3 max-w-prose text-sm leading-relaxed text-ink-500">
            The last {sameIp.window} days. An address is never identity — a
            campus, an office or a mobile carrier puts hundreds of honest buyers
            behind one — so this is a lead to follow rather than a finding. It is
            also the only place a ring spread across several shops becomes
            visible.
          </p>
          <Table
            minWidth="52rem"
            head={
              <>
                <Th>Placed</Th>
                <Th>Shop</Th>
                <Th>Buyer</Th>
                <Th align="end">Total</Th>
                <Th>Payment</Th>
              </>
            }
          >
            {sameIp.rows.map((row) => (
              <Tr key={row.id} className="relative cursor-pointer">
                <Td className="whitespace-nowrap text-ink-500" label="Placed">
                  <RowLink
                    href={`/orders/${row.id}`}
                    label={`Order on ${row.shopName}`}
                  >
                    <When value={row.createdAt} withTime />
                  </RowLink>
                </Td>
                <Td className="max-w-48 relative z-10" label="Shop">
                  <Link
                    href={`/accounts/${row.ownerId}`}
                    className="focus-ring block truncate rounded underline-offset-4 hover:underline"
                  >
                    {row.shopName}
                  </Link>
                  <span className="block truncate text-xs text-ink-400">
                    /{row.shopHandle}
                  </span>
                </Td>
                <Td className="max-w-48" label="Buyer">
                  <span className="block truncate">
                    {row.customerName ?? "Anonymous"}
                  </span>
                  <span
                    className={
                      row.customerEmail &&
                      row.customerEmail.toLowerCase() !==
                        order.customerEmail?.toLowerCase()
                        ? "block truncate text-xs font-medium text-amber-700"
                        : "block truncate text-xs text-ink-400"
                    }
                  >
                    {row.customerEmail ?? "—"}
                  </span>
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Total">
                  {formatMoney(row.totalCents, row.currency)}
                </Td>
                <Td label="Payment">
                  <Badge
                    tone={
                      PAYMENT_STATUS_TONES[
                        row.paymentStatus as keyof typeof PAYMENT_STATUS_TONES
                      ] ?? "neutral"
                    }
                  >
                    {row.paymentStatus}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Table>
          {sameIp.more ? (
            <p className="mt-2 text-xs text-ink-500">
              Only the most recent {sameIp.rows.length} are shown — there are more.
            </p>
          ) : null}
        </>
      ) : null}

      {disputes.length > 0 ? (
        <>
          <SectionTitle>Chargebacks</SectionTitle>
          <Table
            minWidth="46rem"
            head={
              <>
                <Th>Raised</Th>
                <Th>Reason</Th>
                <Th align="end">Taken</Th>
                <Th>Status</Th>
                <Th>Answered</Th>
              </>
            }
          >
            {disputes.map((row) => (
              <Tr key={row.id} className="relative cursor-pointer">
                <Td className="whitespace-nowrap text-ink-500" label="Raised">
                  <RowLink
                    href={`/disputes/${row.id}`}
                    label={`Chargeback ${row.stripeDisputeId}`}
                  >
                    <When value={row.stripeCreatedAt} />
                  </RowLink>
                </Td>
                <Td className="max-w-64">
                  <span className="block truncate text-ink-900">
                    {playbookFor(row.reason).label}
                  </span>
                  <span className="text-xs text-ink-400">
                    {row.reason}
                    {row.networkReasonCode ? ` · ${row.networkReasonCode}` : ""}
                  </span>
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Taken">
                  {formatMoney(row.deductedCents, row.currency)}
                </Td>
                <Td label="Status">
                  <Badge tone={row.evidenceSubmittedAt ? "neutral" : "red"} dot>
                    {row.status}
                  </Badge>
                </Td>
                <Td className="text-ink-500" label="Answered">
                  <When value={row.evidenceSubmittedAt} />
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      {warnings.length > 0 ? (
        <>
          <SectionTitle>Early fraud warnings</SectionTitle>
          <Table
            minWidth="40rem"
            head={
              <>
                <Th>Reported</Th>
                <Th>Type</Th>
                <Th>Refunded</Th>
                <Th>Seller told</Th>
              </>
            }
          >
            {warnings.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap text-ink-500" label="Reported">
                  <When value={row.stripeCreatedAt} withTime />
                </Td>
                <Td label="Type">
                  <Mono>{row.fraudType}</Mono>
                </Td>
                <Td label="Refunded">
                  {row.refundedAt ? (
                    <When value={row.refundedAt} />
                  ) : (
                    <Badge tone="amber">Not refunded</Badge>
                  )}
                </Td>
                <Td className="text-ink-500" label="Seller told">
                  <When value={row.sellerNotifiedAt} withTime />
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Everything that happened, in order</SectionTitle>
      <Card className="p-0">
        <ol className="divide-y divide-ink-100">
          {timelineFor(detail).map((entry) => (
            <li
              key={entry.label}
              className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <span className="text-ink-700">{entry.label}</span>
              <span className="tabular text-xs text-ink-500">
                {formatMoment(entry.at)}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <SectionTitle>Identifiers</SectionTitle>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Order">
          <Mono>{order.id}</Mono>
        </Detail>
        <Detail label="Shop">
          <Mono>{order.shopId}</Mono>
        </Detail>
        <Detail label="Client">
          {order.clientId ? (
            <Mono>{order.clientId}</Mono>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Invoice">
          {invoice ? (
            <Mono>{invoice.number}</Mono>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Download token">
          {order.downloadToken ? (
            <Mono>{order.downloadToken.slice(0, 16)}…</Mono>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </Detail>
        <Detail label="Last updated">{formatMoment(order.updatedAt)}</Detail>
      </Card>
    </>
  );
}

/* ========================================================================== */

/** The second line under a sold item: variant, sku, and any slot it booked. */
function LineHint({ line }: { line: OrderLine }) {
  const parts = [
    line.sku ? `SKU ${line.sku}` : null,
    line.scheduledFor ? formatMoment(line.scheduledFor) : null,
    line.serviceLocation,
  ].filter(Boolean);

  if (parts.length === 0) return null;
  return <span className="block truncate text-xs text-ink-400">{parts.join(" · ")}</span>;
}

/** One line of the money breakdown. */
function MoneyRow({
  label,
  children,
  strong = false,
  tone,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
  tone?: "down";
}) {
  return (
    <div
      className={
        strong
          ? "flex items-baseline justify-between gap-4 border-t border-ink-100 pt-2 font-medium text-ink-900"
          : "flex items-baseline justify-between gap-4 text-ink-600"
      }
    >
      <dt className="min-w-0 truncate">{label}</dt>
      <dd
        className={
          tone === "down" ? "tabular whitespace-nowrap text-red-600" : "tabular whitespace-nowrap"
        }
      >
        {children}
      </dd>
    </div>
  );
}

/** The shipping address, as many lines of it as exist. */
function Address({
  order,
}: {
  order: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  };
}) {
  const lines = [
    order.addressLine1,
    order.addressLine2,
    [order.city, order.region].filter(Boolean).join(", ") || null,
    order.postalCode,
    order.country ? countryName(order.country) : null,
  ].filter(Boolean);

  if (lines.length === 0) return <span className="text-ink-400">None given</span>;
  return (
    <span className="block whitespace-pre-line text-ink-700">
      {lines.join("\n")}
    </span>
  );
}

/**
 * Which of Visa CE3.0's three data points this order actually carries.
 *
 * Two of them plus two matching prior orders wins a fraud case by rule rather
 * than by argument, and none of the three can be backfilled — the buyer's
 * connection existed for the length of one request. Stated here because an
 * order missing them is a case that has to be argued, and that is worth
 * knowing before the dispute arrives rather than after.
 */
function CompellingEvidence({
  order,
}: {
  order: {
    buyerIp: string | null;
    buyerDeviceFingerprint: string | null;
    customerEmail: string | null;
  };
}) {
  const held = [
    order.buyerIp ? "IP" : null,
    order.buyerDeviceFingerprint ? "fingerprint" : null,
    order.customerEmail ? "email" : null,
  ].filter(Boolean);

  return (
    <span
      className={
        held.length >= 2 ? "text-emerald-700" : "text-amber-700"
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <Fingerprint className="size-3.5" />
        {held.length} of 3
      </span>
      <span className="block text-xs text-ink-400">
        {held.length > 0 ? held.join(", ") : "nothing recorded"}
      </span>
    </span>
  );
}

/** Just the readable part of a download's user-agent. */
function parsedBrowser(ua: string | null): string {
  if (!ua) return "—";
  return ua.length > 72 ? `${ua.slice(0, 72)}…` : ua;
}

/** Every stamped moment on the order, oldest first. */
function timelineFor({ order, invoice }: PlatformOrder) {
  const entries: { label: string; at: Date }[] = [
    { label: "Placed", at: order.createdAt },
  ];

  const add = (label: string, at: Date | null) => {
    if (at) entries.push({ label, at });
  };

  add("Buyer accepted the shop's terms", order.termsAcceptedAt);
  add("Confirmation email sent", order.confirmationSentAt);
  add("Invoice issued", invoice?.issuedAt ?? null);
  add("Invoice sent", invoice?.sentAt ?? null);
  add("Files released", order.downloadReleasedAt);
  add("Appointment", order.scheduledFor);
  add("Shipped", order.shippedAt);
  add("Refunded", order.refundedAt);
  add("Stock returned to the shelf", order.restockedAt);
  add("Download link expires", order.downloadExpiresAt);
  add("Last updated", order.updatedAt);

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}
