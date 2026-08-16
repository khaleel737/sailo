import Link from "next/link";
import {
  CalendarClock,
  Download,
  FileText,
  MapPin,
  Trash2,
  Truck,
} from "lucide-react";
import { deleteOrder } from "@/lib/actions/order-admin";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { OrderStatusSelect } from "@/app/admin/orders/_components/order-status-select";
import { PaymentStatusSelect } from "@/app/admin/orders/_components/payment-status-select";
import { OrderActions } from "@/app/admin/orders/_components/order-actions";
import { Badge, Button } from "@sailo/design-system/web";
import { orderStatusLabel, orderStatusTone } from "@sailo/core/order-status";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { taxName } from "@/lib/tax-label";
import { formatAddress, formatMoney } from "@/lib/utils";
import type { Order } from "@sailo/db/schema";
import type { OrderLine } from "@/lib/order-lines";

export async function OrderRow({
  order,
  items,
  invoice,
  showCustomer = true,
}: {
  order: Order;
  /** Every line. Falls back to the header for orders written before carts. */
  items?: OrderLine[];
  invoice?: { number: string; token: string };
  showCustomer?: boolean;
}) {
  const { a, locale } = await getAdminT();
  const lines: OrderLine[] = items?.length ? items : [];
  const address = formatAddress(order);
  const methodName = isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {order.productTitle}
              {order.variantLabel ? (
                <span className="text-ink-500"> — {order.variantLabel}</span>
              ) : null}
              {lines.length <= 1 && order.quantity > 1 ? (
                <span className="text-ink-400"> ×{order.quantity}</span>
              ) : null}
              {lines.length > 1 ? (
                <span className="text-ink-400">
                  {" "}
                  {interpolate(a.orders.andMore, { count: lines.length - 1 })}
                </span>
              ) : null}
            </p>
            <Badge tone={orderStatusTone(order.status)} dot>
              {orderStatusLabel(order.status, a.orderStatus)}
            </Badge>
            {order.paymentStatus === "paid" ? (
              <Badge tone="green">{a.common.paid}</Badge>
            ) : order.paymentStatus === "pending" ? (
              <Badge tone="amber">{a.orders.confirmPayment}</Badge>
            ) : (
              <Badge tone="red">{a.orders.unpaid}</Badge>
            )}
            <span className="text-xs text-ink-400">
              {methodName}
              {order.deliveryLabel ? ` · ${order.deliveryLabel}` : ""}
            </span>
          </div>

          {showCustomer ? (
            <p className="mt-1 text-sm text-ink-600">
              {order.clientId ? (
                <Link
                  href={`/admin/clients/${order.clientId}`}
                  className="font-medium hover:underline"
                >
                  {order.customerName ?? "Anonymous"}
                </Link>
              ) : (
                (order.customerName ?? "Anonymous")
              )}
              {order.customerEmail || order.customerPhone ? (
                <span className="text-ink-400">
                  {" · "}
                  {[order.customerEmail, order.customerPhone]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </p>
          ) : null}

          {address ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-ink-500">
              <MapPin className="mt-0.5 size-3 shrink-0" />
              {address}
            </p>
          ) : null}

          {/* A basket is listed in full — the seller has to pick every line. */}
          {lines.length > 1 ? (
            <ul className="mt-1.5 space-y-0.5 border-s-2 border-ink-100 ps-2.5">
              {lines.map((item) => (
                <li key={item.id} className="text-xs text-ink-600">
                  <span className="font-medium text-ink-800">{item.title}</span>
                  {item.variantLabel ? ` — ${item.variantLabel}` : ""}
                  {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                  <span className="text-ink-400">
                    {" · "}
                    {formatMoney(item.subtotalCents, order.currency, locale)}
                  </span>
                  {item.scheduledFor ? (
                    <span className="text-ink-500">
                      {" · "}
                      {item.scheduledFor.toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {order.note ? (
            <p className="mt-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">
              {order.note}
            </p>
          ) : null}

          {order.pickupLocation ? (
            <p className="mt-1 text-xs text-ink-500">
              {a.orders.collectFrom}: {order.pickupLocation}
            </p>
          ) : null}

          {order.scheduledFor ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-ink-700">
              <CalendarClock className="size-3 shrink-0" />
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

          {order.downloadToken ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
              <Download className="size-3 shrink-0" />
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
                <span className="text-amber-600">
                  {a.orders.filesHeld}
                </span>
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

          {order.trackingNumber || order.trackingCarrier ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-600">
              <Truck className="size-3 shrink-0" />
              {[order.trackingCarrier, order.trackingNumber]
                .filter(Boolean)
                .join(" · ")}
              {order.trackingUrl ? (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 hover:text-ink-900"
                >
                  {a.orders.track}
                </a>
              ) : null}
            </p>
          ) : null}

          {order.refundedCents > 0 ? (
            <p className="mt-1 text-xs font-medium text-red-600">
              {a.orders.refunded} {formatMoney(order.refundedCents, order.currency, locale)}
              {order.refundReason ? ` — ${order.refundReason}` : ""}
            </p>
          ) : null}

          {order.paymentReference ? (
            <p className="mt-1.5 text-xs text-ink-500">
              {a.orders.transferRef}:{" "}
              <span className="font-medium text-ink-700">
                {order.paymentReference}
              </span>
            </p>
          ) : null}

          {order.discountCents > 0 ||
          order.deliveryFeeCents > 0 ||
          order.taxCents > 0 ||
          order.commissionCents > 0 ? (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-500">
              <span>
                {a.orders.items} {formatMoney(order.subtotalCents, order.currency, locale)}
              </span>
              {order.discountCents > 0 ? (
                <span className="text-emerald-600">
                  {order.couponCode ? `${order.couponCode} ` : ""}−
                  {formatMoney(order.discountCents, order.currency, locale)}
                </span>
              ) : null}
              {order.deliveryFeeCents > 0 ? (
                <span>
                  {a.orders.delivery} {formatMoney(order.deliveryFeeCents, order.currency, locale)}
                </span>
              ) : null}
              {order.taxCents > 0 ? (
                <span>
                  {taxName(order, a.settings.tax)}{" "}
                  {formatMoney(order.taxCents, order.currency, locale)}
                  {order.taxInclusive ? " (incl.)" : ""}
                </span>
              ) : null}
              {order.commissionCents > 0 ? (
                <span className="text-amber-600">
                  {order.affiliateCode} commission{" "}
                  {formatMoney(order.commissionCents, order.currency, locale)}
                  {order.commissionPaid ? " (paid)" : ""}
                </span>
              ) : null}
            </p>
          ) : null}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
            <span>
              {order.createdAt.toLocaleString(locale, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {invoice ? (
              <>
                {/*
                  These two are inline in a metadata line, which is the one
                  case WCAG 2.5.8 exempts from a minimum target — the position
                  is set by the flow of the text around them, so growing the
                  box would push the date off its own line. "PDF" is still a
                  23x16 target next to another link.

                  So the *hit area* grows and the *layout* does not: padding
                  out to 44pt on touch, cancelled by an equal negative margin.
                  The margin box is unchanged, so the row is the same height it
                  was, and the thumb gets the whole line rather than the glyphs.
                */}
                <Link
                  href={`/invoice/${invoice.token}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-ink-500 transition pointer-coarse:-my-3.5 pointer-coarse:py-3.5 hover:text-ink-900"
                >
                  <FileText className="size-3" />
                  {invoice.number}
                </Link>
                <a
                  href={`/invoice/${invoice.token}/pdf`}
                  className="inline-flex items-center gap-1 text-ink-500 underline underline-offset-2 transition pointer-coarse:-my-3.5 pointer-coarse:py-3.5 hover:text-ink-900"
                >
                  PDF
                </a>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {formatMoney(order.totalCents, order.currency, locale)}
          </span>
          <PaymentStatusSelect
            orderId={order.id}
            paymentStatus={order.paymentStatus}
          />
          <OrderStatusSelect orderId={order.id} status={order.status} />
          <form action={deleteOrder}>
            <input type="hidden" name="id" value={order.id} />
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              aria-label={a.orders.deleteOrder}
              className="text-ink-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" />
            </Button>
          </form>
        </div>
      </div>

      <OrderActions order={order} />
    </div>
  );
}
