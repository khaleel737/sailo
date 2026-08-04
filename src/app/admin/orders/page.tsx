import type { Metadata } from "next";
import { ShoppingBag, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopOrders } from "@/lib/queries";
import { deleteOrder } from "@/lib/actions/orders";
import { PageHeader } from "@/components/admin/page-header";
import { OrderStatusSelect } from "@/components/admin/order-status-select";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders" };

const TONE = {
  new: "blue",
  contacted: "amber",
  fulfilled: "green",
  cancelled: "neutral",
} as const;

export default async function AdminOrdersPage() {
  const { shop } = await requireShop();
  const orders = await getShopOrders(shop.id);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Captured the moment someone taps Order — before they even send the message."
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="size-8" />}
          title="No orders yet"
          description="Share your shop link and orders will show up here."
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {orders.map((order) => (
            <div key={order.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {order.productTitle}
                      {order.quantity > 1 ? (
                        <span className="text-ink-400"> ×{order.quantity}</span>
                      ) : null}
                    </p>
                    <Badge tone={TONE[order.status as keyof typeof TONE] ?? "neutral"}>
                      {order.status}
                    </Badge>
                  </div>

                  <p className="mt-1 text-sm text-ink-600">
                    {order.customerName ?? "Anonymous"}
                    {order.customerContact ? (
                      <span className="text-ink-400"> · {order.customerContact}</span>
                    ) : null}
                  </p>

                  {order.note ? (
                    <p className="mt-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">
                      {order.note}
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

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(
                      order.unitPriceCents * order.quantity,
                      order.currency,
                    )}
                  </span>

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
          ))}
        </Card>
      )}
    </>
  );
}
