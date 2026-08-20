import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import {
  CalendarClock,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Truck,
} from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import {
  adjacentOrderIds,
  getInvoiceMap,
  getOrderItems,
  getShopOrder,
} from "@/lib/queries";
import { orderNumber, orderSummaryTitle, shipsAsParcel, type OrderLine } from "@/lib/order-lines";
import { shipmentsForOrder } from "@sailo/commerce/orders/server";
import { can } from "@sailo/core/plans";
import { PAYMENT_METHOD_DEFS, awaitsTransfer, isPaymentMethodType } from "@/lib/payments";
import { OrderStatusSelect } from "../_components/order-status-select";
import { PaymentStatusSelect } from "../_components/payment-status-select";
import { OrderActions } from "../_components/order-actions";
import { ShipmentsPanel } from "../_components/shipments-panel";
import { ConfirmPaymentButton } from "./_components/confirm-payment";
import { CopyAddress } from "./_components/copy-address";
import { OrderMenu } from "./_components/order-menu";
import { RecordNav } from "@/app/admin/_components/record-nav";
import { Badge, Card, PageHeader } from "@sailo/design-system/web";
import { orderStatusLabel, orderStatusTone } from "@sailo/core/order-status";
import {
  PAYMENT_STATUS_TONES,
  isPaymentStatus,
} from "@sailo/core/payment-status";
import { taxName } from "@sailo/core/tax-label";
import { formatAddress } from "@sailo/core/address";
import { normalizePhone } from "@sailo/core/phone";
import { formatMoney } from "@sailo/core/currency";
import { interpolate } from "@sailo/i18n";

export async function generateMetadata({
  params,
}: PageProps<"/admin/orders/[id]">): Promise<Metadata> {
  const { shop } = await requireShop("orders:read");
  const { id } = await params;
  const order = await getShopOrder(shop.id, id);
  return { title: order ? `Order · ${orderSummaryTitle(order)}` : "Order" };
}

/**
 * One order, in full — the page the list's rows open onto.
 *
 * Everything here used to be inlined into the orders list, every order at
 * once, as a stack of small print nobody could scan. It is laid out now the
 * way a seller's questions arrive:
 *
 *   1. What was bought, and where the money in it went — lines, then the
 *      arithmetic from items to total, refunds included.
 *   2. Has it gone out — the delivery method, the address, tracking, the
 *      ship/deliver/refund controls, and box-by-box shipping where the plan
 *      allows it.
 *   3. Where the money stands — the rail it came in on, the one control that
 *      decides whether it counts as paid, and the invoice.
 *   4. Who bought it, with the note they left and the way to reach them.
 *
 * Deleting lives at the very bottom, behind a confirm — it used to be a bare
 * icon on every row of the list, one mis-tap from removing an order.
 */
export default async function AdminOrderPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const { shop } = await requireShop("orders:read");
  const { a, locale } = await getAdminT();
  const { id } = await params;

  const order = await getShopOrder(shop.id, id);
  if (!order) notFound();

  const [items, invoices, adjacent, boxes] = await Promise.all([
    getOrderItems(order),
    getInvoiceMap([order.id]),
    /* The header's ↑↓ arrows — neighbours under the list's own ordering. */
    adjacentOrderIds(shop.id, order.id),
    /*
     * Box-by-box shipping — spec 51. Same gate the list used to apply: only a
     * plan that ships in more than one box, on an order with more than one
     * line that actually ships, has anything to read.
     */
    can(shop, "weightBands") &&
    order.itemCount > 1 &&
    order.deliveryMethod === "shipping"
      ? shipmentsForOrder(order.id)
      : Promise.resolve(null),
  ]);
  const invoice = invoices.get(order.id);

  /* Orders written before carts carry their one line in the header columns. */
  const lines: OrderLine[] = items.length
    ? items
    : [
        {
          id: order.id,
          orderId: order.id,
          position: 0,
          productId: order.productId,
          variantId: null,
          title: order.productTitle,
          variantLabel: order.variantLabel,
          sku: null,
          kind: "product",
          imageUrl: null,
          unitPriceCents: order.subtotalCents,
          quantity: order.quantity,
          subtotalCents: order.subtotalCents,
          scheduledFor: order.scheduledFor,
          serviceMode: order.serviceMode,
          serviceLocation: null,
        },
      ];

  const address = formatAddress(order);
  const methodName = isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;
  const money = (cents: number) => formatMoney(cents, order.currency, locale);

  const summaryRow = (label: string, value: string, tone?: "credit" | "debit") => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={
          tone === "credit"
            ? "tabular-nums text-emerald-600"
            : tone === "debit"
              ? "tabular-nums text-red-600"
              : "tabular-nums text-ink-700"
        }
      >
        {value}
      </dd>
    </div>
  );

  return (
    <>
      {/*
        The number is the order's name now — spec 04's scanability fix — and
        what was bought becomes the supporting line beside the placed date.
        On the end: the ↑↓ walk through the list and the ⋯ menu that took in
        the evidence pack and delete.
      */}
      <PageHeader
        back={{ href: "/admin/orders", label: a.orders.title }}
        title={orderNumber(order.id, invoice?.number)}
        description={`${orderSummaryTitle(order)} · ${a.orderDetail.placed} ${order.createdAt.toLocaleString(
          locale,
          {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          },
        )}`}
        meta={
          <>
            <Badge tone={orderStatusTone(order.status)} dot>
              {orderStatusLabel(order.status, a.orderStatus)}
            </Badge>
            <Badge
              tone={
                isPaymentStatus(order.paymentStatus)
                  ? PAYMENT_STATUS_TONES[order.paymentStatus]
                  : "neutral"
              }
            >
              {isPaymentStatus(order.paymentStatus)
                ? a.paymentStatus[order.paymentStatus]
                : order.paymentStatus}
            </Badge>
            {order.isPreorder ? (
              <Badge tone="amber">{a.orderDetail.preorderChip}</Badge>
            ) : null}
            {order.subscriptionId ? (
              <Badge tone="blue">{a.orderDetail.renewal}</Badge>
            ) : null}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <RecordNav
              prevHref={adjacent.prev ? `/admin/orders/${adjacent.prev}` : null}
              nextHref={adjacent.next ? `/admin/orders/${adjacent.next}` : null}
              prevLabel={a.orderList.viewOrder}
              nextLabel={a.orderList.viewOrder}
            />
            <OrderMenu orderId={order.id} />
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* ---- 1. What was bought, and the arithmetic ---- */}
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink-900">
              {a.orders.items}
            </h2>

            <ul className="divide-y divide-ink-100">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-start justify-between gap-4 py-2.5 first:pt-0"
                >
                  {/* The picture of the thing, when the line kept one. */}
                  <span className="relative mt-0.5 size-9 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                    {line.imageUrl ? (
                      <Image
                        src={line.imageUrl}
                        alt=""
                        fill
                        sizes="36px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-ink-300">
                        {line.kind === "digital" ? (
                          <Download className="size-4" />
                        ) : line.kind === "service" ? (
                          <CalendarClock className="size-4" />
                        ) : (
                          <Package className="size-4" />
                        )}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">
                      {line.title}
                      {line.variantLabel ? (
                        <span className="text-ink-500"> — {line.variantLabel}</span>
                      ) : null}
                      {line.quantity > 1 ? (
                        <span className="text-ink-400"> ×{line.quantity}</span>
                      ) : null}
                    </p>
                    {/* The arithmetic and the seller's own code, small print. */}
                    {line.quantity > 1 || line.sku ? (
                      <p className="mt-0.5 text-xs tabular-nums text-ink-500">
                        {[
                          line.quantity > 1
                            ? `${money(line.unitPriceCents)} × ${line.quantity}`
                            : null,
                          line.sku,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {line.scheduledFor ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                        <CalendarClock className="size-3 shrink-0" />
                        {line.scheduledFor.toLocaleString(locale, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {line.serviceMode ? (
                          <span>
                            · {line.serviceMode === "online" ? "Online" : "In person"}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-ink-700">
                    {money(line.subtotalCents)}
                  </span>
                </li>
              ))}
            </ul>

            {order.isPreorder ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {order.preorderExpectedAt
                  ? interpolate(a.orderDetail.preorderPromised, {
                      date: order.preorderExpectedAt.toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }),
                    })
                  : a.orderDetail.preorderChip}
              </p>
            ) : null}

            <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-4">
              {summaryRow(a.orders.items, money(order.subtotalCents))}
              {order.discountCents > 0
                ? summaryRow(
                    order.couponCode ?? a.columns.discount,
                    `−${money(order.discountCents)}`,
                    "credit",
                  )
                : null}
              {order.deliveryFeeCents > 0
                ? summaryRow(a.orders.delivery, money(order.deliveryFeeCents))
                : null}
              {order.taxCents > 0
                ? summaryRow(
                    `${taxName(order, a.settings.tax)}${order.taxInclusive ? " (incl.)" : ""}`,
                    money(order.taxCents),
                  )
                : null}
              <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2 text-sm">
                <dt className="font-semibold text-ink-900">{a.columns.total}</dt>
                <dd className="font-semibold tabular-nums text-ink-900">
                  {money(order.totalCents)}
                </dd>
              </div>
              {order.refundedCents > 0
                ? summaryRow(
                    `${a.orders.refunded}${order.refundReason ? ` — ${order.refundReason}` : ""}`,
                    `−${money(order.refundedCents)}`,
                    "debit",
                  )
                : null}
              {/* What happened to the units — a different fact from the money. */}
              {order.refundedCents > 0 && (order.restockedAt || order.restockDeclined) ? (
                <p className="text-end text-xs text-ink-400">
                  {order.restockedAt
                    ? a.orderDetail.tlRestocked
                    : a.orderDetail.tlNotRestocked}
                </p>
              ) : null}
              {order.presentmentCurrency && order.presentmentAmountCents !== null
                ? summaryRow(
                    a.orders.paidAs,
                    formatMoney(
                      order.presentmentAmountCents,
                      order.presentmentCurrency,
                      locale,
                    ),
                  )
                : null}
              {order.commissionCents > 0
                ? summaryRow(
                    `${a.orderDetail.commission} · ${order.affiliateCode}${order.commissionPaid ? ` (${a.common.paid.toLowerCase()})` : ""}`,
                    `−${money(order.commissionCents)}`,
                    "debit",
                  )
                : null}
            </dl>
          </Card>

          {/* ---- 2. Has it gone out ---- */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.orderDetail.fulfilment}
              </h2>
              <OrderStatusSelect orderId={order.id} status={order.status} />
            </div>

            <div className="space-y-2 text-sm text-ink-700">
              {order.deliveryLabel ? (
                <p className="flex items-center gap-1.5">
                  <Truck className="size-3.5 shrink-0 text-ink-400" />
                  {order.deliveryLabel}
                </p>
              ) : null}

              {/*
                The address as a block, the way it goes on a label — with the
                copy button beside it. `formatAddress` still decides *whether*
                there is one; the lines are printed raw because a label wants
                the seller's punctuation, not a sentence's.
              */}
              {address ? (
                <div className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
                  <p className="min-w-0 flex-1">
                    {[
                      order.addressLine1,
                      order.addressLine2,
                      [order.city, order.region, order.postalCode]
                        .filter(Boolean)
                        .join(", "),
                      order.country,
                    ]
                      .filter(Boolean)
                      .map((part) => (
                        <span key={part} className="block">
                          {part}
                        </span>
                      ))}
                  </p>
                  <CopyAddress
                    text={[
                      order.customerName,
                      order.addressLine1,
                      order.addressLine2,
                      [order.city, order.region, order.postalCode]
                        .filter(Boolean)
                        .join(", "),
                      order.country,
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  />
                </div>
              ) : null}

              {order.pickupLocation ? (
                <p className="text-ink-600">
                  {a.orders.collectFrom}: {order.pickupLocation}
                </p>
              ) : null}

              {/* When it moved, said with dates — the timeline repeats these
                  in order, but the card is where the seller looks first. */}
              {order.shippedAt ? (
                <p className="flex items-center gap-1.5 text-ink-600">
                  <Truck className="size-3.5 shrink-0 text-ink-400" />
                  {a.orderDetail.tlShipped}{" "}
                  {order.shippedAt.toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : null}
              {order.deliveredAt ? (
                <p className="flex items-center gap-1.5 text-ink-600">
                  <MapPin className="size-3.5 shrink-0 text-ink-400" />
                  {a.orderDetail.tlDelivered}{" "}
                  {order.deliveredAt.toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {order.deliverySignedBy ? (
                    <span className="text-xs text-ink-500">
                      · {interpolate(a.orderDetail.signedBy, { name: order.deliverySignedBy })}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {order.serviceLocation ? (
                <p className="text-ink-600">{order.serviceLocation}</p>
              ) : null}

              {order.scheduledFor ? (
                <p className="flex items-center gap-1.5 font-medium text-ink-800">
                  <CalendarClock className="size-3.5 shrink-0 text-ink-400" />
                  {a.orders.booking}:{" "}
                  {order.scheduledFor.toLocaleString(locale, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {order.serviceMode ? (
                    <span className="font-normal text-ink-500">
                      · {order.serviceMode === "online" ? "Online" : "In person"}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {order.trackingNumber || order.trackingCarrier ? (
                <p className="flex items-center gap-1.5">
                  <Truck className="size-3.5 shrink-0 text-ink-400" />
                  {[order.trackingCarrier, order.trackingNumber]
                    .filter(Boolean)
                    .join(" · ")}
                  {order.trackingUrl ? (
                    <a
                      href={order.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-ink-900"
                    >
                      {a.orders.track}
                    </a>
                  ) : null}
                </p>
              ) : null}

              {order.downloadToken ? (
                <p className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Download className="size-3.5 shrink-0" />
                  {order.downloadReleasedAt ? (
                    <>
                      {a.orders.filesReleased}
                      {order.downloadLimit
                        ? ` · ${interpolate(a.orders.downloadedOf, { count: order.downloadCount, limit: order.downloadLimit })}`
                        : order.downloadCount > 0
                          ? ` · ${interpolate(a.orders.downloadedTimes, { count: order.downloadCount })}`
                          : ""}
                      {order.downloadExpiresAt
                        ? ` · ${interpolate(a.orderDetail.downloadExpires, {
                            date: order.downloadExpiresAt.toLocaleDateString(locale, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }),
                          })}`
                        : ""}
                    </>
                  ) : (
                    <span className="text-amber-600">{a.orders.filesHeld}</span>
                  )}
                  <Link
                    href={`/download/${order.downloadToken}`}
                    target="_blank"
                    className="underline underline-offset-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 hover:text-ink-900"
                  >
                    {a.common.view}
                  </Link>
                </p>
              ) : null}
            </div>

            <OrderActions order={order} shipsAsParcel={shipsAsParcel(order, items)} />

            {/* Only where there is genuinely more than one thing to send. An
                order whose second line is a download has one box, and offering
                a box-by-box form for it is a screen of controls with one
                answer. */}
            {boxes && boxes.coverage.length > 1 ? (
              <div className="mt-3">
                <ShipmentsPanel
                  orderId={order.id}
                  coverage={boxes.coverage}
                  shipments={boxes.shipments}
                  complete={boxes.complete}
                />
              </div>
            ) : null}
          </Card>

          {/* ---- What happened, when — real timestamps only ---------------- */}
          {/*
            Assembled from the columns that carry a clock, never synthesised:
            there is no `paidAt` column, so "paid" appears nowhere here rather
            than with an invented date (spec 04 records the gap). Sorted by
            when things happened, which is not always the order the cards
            above tell the story in.
          */}
          {(() => {
            const events = [
              { at: order.createdAt, label: a.orderDetail.tlPlaced },
              order.termsAcceptedAt
                ? { at: order.termsAcceptedAt, label: a.orderDetail.tlTermsAccepted }
                : null,
              order.confirmationSentAt
                ? {
                    at: order.confirmationSentAt,
                    label: a.orderDetail.tlConfirmationSent,
                  }
                : null,
              order.downloadReleasedAt
                ? {
                    at: order.downloadReleasedAt,
                    label: a.orderDetail.tlFilesReleased,
                  }
                : null,
              order.shippedAt
                ? { at: order.shippedAt, label: a.orderDetail.tlShipped }
                : null,
              order.deliveredAt
                ? {
                    at: order.deliveredAt,
                    label: a.orderDetail.tlDelivered,
                    extra:
                      order.deliveredSource === "buyer_confirmed"
                        ? a.orders.deliveredByBuyer
                        : order.deliveredSource === "carrier"
                          ? a.orders.deliveredByCarrier
                          : a.orders.deliveredBySeller,
                  }
                : null,
              order.refundedAt
                ? {
                    at: order.refundedAt,
                    label: a.orderDetail.tlRefunded,
                    extra: order.refundReason ?? undefined,
                  }
                : null,
              order.restockedAt
                ? { at: order.restockedAt, label: a.orderDetail.tlRestocked }
                : null,
              order.membershipPeriodEnd
                ? {
                    at: order.membershipPeriodEnd,
                    label: a.orderDetail.tlCoversUntil,
                  }
                : null,
            ]
              .filter((e): e is NonNullable<typeof e> => e !== null)
              .sort((x, y) => x.at.getTime() - y.at.getTime());

            if (events.length < 2) return null;
            return (
              <Card className="p-5">
                <h2 className="mb-4 text-sm font-semibold text-ink-900">
                  {a.orderDetail.timeline}
                </h2>
                <ol className="space-y-0">
                  {events.map((event, i) => (
                    <li
                      key={`${event.label}-${event.at.getTime()}`}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      {/* The thread: a dot per fact, a line to the next. */}
                      <span className="flex flex-col items-center">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-ink-300" />
                        {i < events.length - 1 ? (
                          <span className="mt-1 w-px flex-1 bg-ink-100" />
                        ) : null}
                      </span>
                      <div className="min-w-0 pb-0.5">
                        <p className="text-sm text-ink-800">
                          {event.label}
                          {"extra" in event && event.extra ? (
                            <span className="text-ink-500"> — {event.extra}</span>
                          ) : null}
                        </p>
                        <p className="text-xs tabular-nums text-ink-400">
                          {event.at.toLocaleString(locale, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })()}
        </div>

        <div className="min-w-0 space-y-4">
          {/* ---- 3. Where the money stands ---- */}
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.orderDetail.payment}
              </h2>
              <PaymentStatusSelect
                orderId={order.id}
                paymentStatus={order.paymentStatus}
              />
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">{a.orders.paymentMethodLabel}</dt>
                <dd className="text-end text-ink-700">{methodName}</dd>
              </div>
              {order.paymentReference ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">{a.orders.transferRef}</dt>
                  <dd className="text-end font-medium text-ink-700">
                    {order.paymentReference}
                  </dd>
                </div>
              ) : null}
              {/* The "unrecognized charge" answer — what the buyer's bank
                  actually printed, as sent. */}
              {order.statementDescriptor ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">
                    {a.orderDetail.statementDescriptor}
                  </dt>
                  <dd className="text-end font-mono text-xs text-ink-700">
                    {order.statementDescriptor}
                  </dd>
                </div>
              ) : null}
              {order.buyerTaxId ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">{a.orderDetail.buyerTaxId}</dt>
                  <dd className="text-end font-medium text-ink-700">
                    {order.buyerTaxId}
                  </dd>
                </div>
              ) : null}
              {order.subscriptionId && order.membershipPeriodEnd ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">{a.orderDetail.tlCoversUntil}</dt>
                  <dd className="text-end tabular-nums text-ink-700">
                    {order.membershipPeriodEnd.toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* A legal fact, not a detail row: the invoice must print it, so
                the seller should not first learn it from the invoice. */}
            {order.taxReverseCharge ? (
              <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">
                {a.orderDetail.reverseCharge}
              </p>
            ) : null}

            {order.paymentMethod === "card" && order.stripePaymentIntentId ? (
              <a
                href={`https://dashboard.stripe.com/payments/${order.stripePaymentIntentId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
              >
                {a.orderDetail.viewInStripe}
                <ExternalLink className="size-3" />
              </a>
            ) : null}

            {/*
              A manual rail waiting on its money — the WhatsApp sale, the bank
              transfer. The platform only learns it settled when the seller
              says so, so saying so is the card's primary act; the chase links
              underneath reach the buyer where the sale actually happened.
            */}
            {awaitsTransfer(order.paymentStatus) && order.paymentMethod !== "card" ? (
              <div className="space-y-2.5 border-t border-ink-100 pt-3">
                <ConfirmPaymentButton orderId={order.id} />
                <p className="text-xs leading-relaxed text-ink-500">
                  {a.orderDetail.chaseHint}
                </p>
                <div className="flex flex-wrap gap-2">
                  {order.customerPhone ? (
                    <a
                      href={`https://wa.me/${normalizePhone(order.customerPhone)}?text=${encodeURIComponent(
                        interpolate(a.orderDetail.chaseMessage, {
                          item: orderSummaryTitle(order),
                          amount: money(order.totalCents),
                        }),
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 pointer-coarse:h-11"
                    >
                      <MessageCircle className="size-3.5" />
                      {a.products.waitingMessageThem}
                    </a>
                  ) : null}
                  {order.customerEmail ? (
                    <a
                      href={`mailto:${order.customerEmail}?subject=${encodeURIComponent(orderSummaryTitle(order))}&body=${encodeURIComponent(
                        interpolate(a.orderDetail.chaseMessage, {
                          item: orderSummaryTitle(order),
                          amount: money(order.totalCents),
                        }),
                      )}`}
                      className="focus-ring press inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 transition hover:bg-ink-50 pointer-coarse:h-11"
                    >
                      <Mail className="size-3.5" />
                      {a.common.email}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {invoice ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-3 text-xs">
                <Link
                  href={`/invoice/${invoice.token}`}
                  target="_blank"
                  className="focus-ring inline-flex items-center gap-1 rounded text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
                >
                  <FileText className="size-3.5" />
                  {invoice.number}
                </Link>
                <a
                  href={`/invoice/${invoice.token}/pdf`}
                  className="focus-ring inline-flex items-center gap-1 rounded text-ink-500 underline underline-offset-2 transition hover:text-ink-900 pointer-coarse:min-h-11"
                >
                  PDF
                </a>
              </p>
            ) : null}
          </Card>

          {/* ---- 4. Who bought it ---- */}
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.orderDetail.customer}
              </h2>
              {order.clientId ? (
                <Link
                  href={`/admin/clients/${order.clientId}`}
                  className="focus-ring rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center"
                >
                  {a.orderDetail.viewClient}
                </Link>
              ) : null}
            </div>

            {order.customerName || order.customerEmail || order.customerPhone ? (
              <div className="space-y-1 text-sm">
                {order.customerName ? (
                  <p className="font-medium text-ink-900">{order.customerName}</p>
                ) : null}
                {order.customerEmail ? (
                  <p>
                    <a
                      href={`mailto:${order.customerEmail}`}
                      className="text-ink-600 underline-offset-2 hover:underline"
                    >
                      {order.customerEmail}
                    </a>
                  </p>
                ) : null}
                {order.customerPhone ? (
                  <p dir="ltr" className="text-start text-ink-600">
                    {order.customerPhone}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink-500">{a.orderDetail.noContact}</p>
            )}

            {order.note ? (
              <div className="rounded-xl bg-ink-50 px-3 py-2.5">
                <p className="text-xs font-medium text-ink-500">
                  {a.orderDetail.note}
                </p>
                <p className="mt-0.5 text-sm text-ink-700">{order.note}</p>
              </div>
            ) : null}

            {/*
              The seller's own checkout questions, answered — recorded on
              every order since the column existed and, until now, readable
              only by the invoice renderer. Labels are the snapshot's, so a
              renamed question still shows what was actually asked.
            */}
            {order.customFields && order.customFields.length > 0 ? (
              <div className="border-t border-ink-100 pt-3">
                <p className="mb-1.5 text-xs font-medium text-ink-500">
                  {a.orderDetail.checkoutAnswers}
                </p>
                <dl className="space-y-1 text-sm">
                  {order.customFields.map((field) => (
                    <div key={field.key} className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-500">{field.label}</dt>
                      <dd className="text-end text-ink-700">
                        {field.value === true
                          ? a.common.yes
                          : field.value === false
                            ? a.common.no
                            : field.value === null || field.value === ""
                              ? "—"
                              : String(field.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {order.termsAcceptedAt ? (
              <p className="border-t border-ink-100 pt-3 text-xs text-ink-400">
                {interpolate(a.orderDetail.termsAgreed, {
                  date: order.termsAcceptedAt.toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
                })}
              </p>
            ) : null}
          </Card>

        </div>
      </div>
    </>
  );
}
