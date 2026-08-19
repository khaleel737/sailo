import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarClock,
  Download,
  FileText,
  MapPin,
  Truck,
} from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getInvoiceMap, getOrderItems, getShopOrder } from "@/lib/queries";
import { orderSummaryTitle, type OrderLine } from "@/lib/order-lines";
import { shipmentsForOrder } from "@sailo/commerce/orders/server";
import { can } from "@sailo/core/plans";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { OrderStatusSelect } from "../_components/order-status-select";
import { PaymentStatusSelect } from "../_components/payment-status-select";
import { OrderActions } from "../_components/order-actions";
import { ShipmentsPanel } from "../_components/shipments-panel";
import { DeleteOrderButton } from "./_components/delete-order";
import { Badge, Card, PageHeader } from "@sailo/design-system/web";
import { orderStatusLabel, orderStatusTone } from "@sailo/core/order-status";
import {
  PAYMENT_STATUS_TONES,
  isPaymentStatus,
} from "@sailo/core/payment-status";
import { taxName } from "@sailo/core/tax-label";
import { formatAddress } from "@sailo/core/address";
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

  const [items, invoices, boxes] = await Promise.all([
    getOrderItems(order),
    getInvoiceMap([order.id]),
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
      <PageHeader
        back={{ href: "/admin/orders", label: a.orders.title }}
        title={orderSummaryTitle(order)}
        description={`${a.orderDetail.placed} ${order.createdAt.toLocaleString(
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
          </>
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
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {line.title}
                      {line.variantLabel ? (
                        <span className="text-ink-500"> — {line.variantLabel}</span>
                      ) : null}
                      {line.quantity > 1 ? (
                        <span className="text-ink-400"> ×{line.quantity}</span>
                      ) : null}
                    </p>
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

              {address ? (
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
                  {address}
                </p>
              ) : null}

              {order.pickupLocation ? (
                <p className="text-ink-600">
                  {a.orders.collectFrom}: {order.pickupLocation}
                </p>
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

            <OrderActions order={order} />

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
            </dl>

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
          </Card>

          <DeleteOrderButton orderId={order.id} />
        </div>
      </div>
    </>
  );
}
