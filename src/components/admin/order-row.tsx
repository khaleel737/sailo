import Link from "next/link";
import { MapPin, Trash2 } from "lucide-react";
import { deleteOrder } from "@/lib/actions/orders";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { OrderStatusSelect } from "./order-status-select";
import { PaymentStatusSelect } from "./payment-status-select";
import { Badge, Button } from "@/components/ui";
import { formatAddress, formatMoney } from "@/lib/utils";
import type { Order } from "@/db/schema";

const STATUS_TONE = {
  new: "blue",
  confirmed: "amber",
  fulfilled: "green",
  cancelled: "neutral",
} as const;

export function OrderRow({
  order,
  showCustomer = true,
}: {
  order: Order;
  showCustomer?: boolean;
}) {
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
              {order.quantity > 1 ? (
                <span className="text-ink-400"> ×{order.quantity}</span>
              ) : null}
            </p>
            <Badge
              tone={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? "neutral"}
            >
              {order.status}
            </Badge>
            <Badge>{methodName}</Badge>
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

          {order.note ? (
            <p className="mt-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">
              {order.note}
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

          <p className="mt-1.5 text-xs text-ink-400">
            {order.createdAt.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {formatMoney(order.unitPriceCents * order.quantity, order.currency)}
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
    </div>
  );
}
