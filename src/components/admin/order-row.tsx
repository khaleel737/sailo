import Link from "next/link";
import {
  CalendarClock,
  Download,
  FileText,
  MapPin,
  Trash2,
  Truck,
} from "lucide-react";
import { deleteOrder } from "@/lib/actions/orders";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { OrderStatusSelect } from "./order-status-select";
import { PaymentStatusSelect } from "./payment-status-select";
import { OrderActions } from "./order-actions";
import { Badge, Button } from "@/components/ui";
import { formatAddress, formatMoney } from "@/lib/utils";
import type { Order, OrderItem } from "@/db/schema";

const STATUS_TONE = {
  new: "blue",
  confirmed: "amber",
  shipped: "blue",
  completed: "green",
  cancelled: "neutral",
  refunded: "red",
} as const;

export function OrderRow({
  order,
  items,
  invoice,
  showCustomer = true,
}: {
  order: Order;
  /** Every line. Falls back to the header for orders written before carts. */
  items?: OrderItem[];
  invoice?: { number: string; token: string };
  showCustomer?: boolean;
}) {
  const lines: OrderItem[] = items?.length ? items : [];
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
                  + {lines.length - 1} more
                </span>
              ) : null}
            </p>
            <Badge
              tone={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? "neutral"}
            >
              {order.status}
            </Badge>
            <Badge>{methodName}</Badge>
            {order.deliveryLabel ? (
              <Badge tone="blue">{order.deliveryLabel}</Badge>
            ) : null}
            {order.paymentStatus === "paid" ? (
              <Badge tone="green">Paid</Badge>
            ) : order.paymentStatus === "pending" ? (
              <Badge tone="amber">Confirm payment</Badge>
            ) : (
              <Badge tone="red">Unpaid</Badge>
            )}
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
                    {formatMoney(item.subtotalCents, order.currency)}
                  </span>
                  {item.scheduledFor ? (
                    <span className="text-ink-500">
                      {" · "}
                      {item.scheduledFor.toLocaleString("en-US", {
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
              Collect from: {order.pickupLocation}
            </p>
          ) : null}

          {order.scheduledFor ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-ink-700">
              <CalendarClock className="size-3 shrink-0" />
              {order.scheduledFor.toLocaleString("en-US", {
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
                  Files released
                  {order.downloadLimit
                    ? ` · ${order.downloadCount}/${order.downloadLimit} downloaded`
                    : order.downloadCount > 0
                      ? ` · downloaded ${order.downloadCount}×`
                      : ""}
                </>
              ) : (
                <span className="text-amber-600">
                  Files held until you mark this paid
                </span>
              )}
              <Link
                href={`/download/${order.downloadToken}`}
                target="_blank"
                className="underline underline-offset-2 hover:text-ink-900"
              >
                View
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
                  className="underline underline-offset-2 hover:text-ink-900"
                >
                  Track
                </a>
              ) : null}
            </p>
          ) : null}

          {order.refundedCents > 0 ? (
            <p className="mt-1 text-xs font-medium text-red-600">
              Refunded {formatMoney(order.refundedCents, order.currency)}
              {order.refundReason ? ` — ${order.refundReason}` : ""}
            </p>
          ) : null}

          {order.paymentReference ? (
            <p className="mt-1.5 text-xs text-ink-500">
              Transfer ref:{" "}
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
                Items {formatMoney(order.subtotalCents, order.currency)}
              </span>
              {order.discountCents > 0 ? (
                <span className="text-emerald-600">
                  {order.couponCode ? `${order.couponCode} ` : ""}−
                  {formatMoney(order.discountCents, order.currency)}
                </span>
              ) : null}
              {order.deliveryFeeCents > 0 ? (
                <span>
                  Delivery {formatMoney(order.deliveryFeeCents, order.currency)}
                </span>
              ) : null}
              {order.taxCents > 0 ? (
                <span>
                  {order.taxName ?? "Tax"}{" "}
                  {formatMoney(order.taxCents, order.currency)}
                  {order.taxInclusive ? " (incl.)" : ""}
                </span>
              ) : null}
              {order.commissionCents > 0 ? (
                <span className="text-amber-600">
                  {order.affiliateCode} commission{" "}
                  {formatMoney(order.commissionCents, order.currency)}
                  {order.commissionPaid ? " (paid)" : ""}
                </span>
              ) : null}
            </p>
          ) : null}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
            <span>
              {order.createdAt.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {invoice ? (
              <>
                <Link
                  href={`/invoice/${invoice.token}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-ink-500 transition hover:text-ink-900"
                >
                  <FileText className="size-3" />
                  {invoice.number}
                </Link>
                <a
                  href={`/invoice/${invoice.token}/pdf`}
                  className="inline-flex items-center gap-1 text-ink-500 underline underline-offset-2 transition hover:text-ink-900"
                >
                  PDF
                </a>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {formatMoney(order.totalCents, order.currency)}
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
              aria-label="Delete order"
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
