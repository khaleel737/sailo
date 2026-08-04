import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getInvoiceMap, getOrderItemsMap, getShopOrders } from "@/lib/queries";
import { PageHeader } from "@/components/admin/page-header";
import { ExportButton } from "@/components/admin/export-button";
import { OrderRow } from "@/components/admin/order-row";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage() {
  const { shop } = await requireShop();
  const orders = await getShopOrders(shop.id);
  const [invoices, itemsByOrder] = await Promise.all([
    getInvoiceMap(orders.map((o) => o.id)),
    getOrderItemsMap(orders),
  ]);
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
        action={<ExportButton shop={shop} type="orders" />}
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
            <OrderRow
              key={order.id}
              order={order}
              items={itemsByOrder.get(order.id)}
              invoice={invoices.get(order.id)}
            />
          ))}
        </Card>
      )}
    </>
  );
}
