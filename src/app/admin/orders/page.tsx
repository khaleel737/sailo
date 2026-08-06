import type { Metadata } from "next";
import { interpolate } from "@/i18n";
import { ShoppingBag } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getInvoiceMap, getOrderItemsMap, getShopOrders } from "@/lib/queries";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/app/admin/_components/export-button";
import { OrderRow } from "@/app/admin/_components/order-row";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  const orders = await getShopOrders(shop.id);
  const [invoices, itemsByOrder] = await Promise.all([
    getInvoiceMap(orders.map((o) => o.id)),
    getOrderItemsMap(orders),
  ]);
  const awaiting = orders.filter((o) => o.paymentStatus === "pending").length;

  return (
    <>
      <PageHeader
        title={a.orders.title}
        description={
          awaiting > 0
            ? awaiting === 1
              ? a.orders.awaitingOne
              : interpolate(a.orders.awaiting, { count: awaiting })
            : a.orders.description
        }
        action={<ExportButton shop={shop} type="orders" />}
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="size-8" />}
          title={a.orders.empty}
          description={a.orders.emptyBody}
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
