import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopOrders } from "@/lib/queries";
import { PageHeader } from "@/components/admin/page-header";
import { OrderRow } from "@/components/admin/order-row";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage() {
  const { shop } = await requireShop();
  const orders = await getShopOrders(shop.id);
  const awaiting = orders.filter((o) => o.paymentStatus === "pending").length;

  return (
    <>
      <PageHeader
        title="Orders"
        description={
          awaiting > 0
            ? `${awaiting} ${awaiting === 1 ? "buyer says they've" : "buyers say they've"} paid — confirm to mark as paid.`
            : "Captured the moment someone taps Order — before they even send the message."
        }
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
            <OrderRow key={order.id} order={order} />
          ))}
        </Card>
      )}
    </>
  );
}
