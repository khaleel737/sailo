import type { Metadata } from "next";
import { interpolate } from "@sailo/i18n";
import { ShoppingBag } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import {
  getInvoiceMap,
  getOrderItemsMap,
  getShopOrders,
  hasOrderFilters,
  usedCouponCodes,
  type OrderFilters as Filters,
} from "@/lib/queries";
import { ORDER_STATUSES, isOrderStatus } from "@sailo/core/order-status";
import {
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATUSES,
  isPaymentMethodType,
  isPaymentStatus,
} from "@/lib/payments";
import { PageHeader } from "@sailo/design-system/web";
import { ExportButton } from "@/app/admin/_components/export-button";
import { OrderRow } from "@/app/admin/_components/order-row";
import { OrderFilters } from "./_components/order-filters";
import { Card, EmptyState } from "@sailo/design-system/web";

export const metadata: Metadata = { title: "Orders" };

/** One search param, whatever shape the URL gave it. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const { shop } = await requireShop();
  const { a } = await getAdminT();

  /*
   * Validated against the lists this build knows, not passed through.
   *
   * These become WHERE clauses, so an unrecognised value must narrow to
   * nothing rather than reach the query — and answering an unknown status
   * with "no filter" would be worse than either: the seller asks for
   * `?status=shippped` and is shown every order as though that were the
   * answer.
   */
  const params = await searchParams;
  const statusParam = one(params.status);
  const paymentParam = one(params.payment);
  const methodParam = one(params.method);
  const couponParam = one(params.coupon).toUpperCase();

  const filters: Filters = {
    status: isOrderStatus(statusParam) ? statusParam : null,
    paymentStatus: isPaymentStatus(paymentParam) ? paymentParam : null,
    paymentMethod: isPaymentMethodType(methodParam) ? methodParam : null,
    // Free text, so it is bounded rather than checked against a list — the
    // codes are the seller's own and a new one must be filterable at once.
    couponCode: couponParam.slice(0, 64) || null,
  };
  const filtered = hasOrderFilters(filters);

  const [orders, coupons] = await Promise.all([
    getShopOrders(shop.id, 100, filters),
    usedCouponCodes(shop.id),
  ]);
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
          filtered
            ? interpolate(a.orders.filtered, { count: orders.length })
            : awaiting > 0
              ? awaiting === 1
                ? a.orders.awaitingOne
                : interpolate(a.orders.awaiting, { count: awaiting })
              : a.orders.description
        }
        action={<ExportButton shop={shop} type="orders" />}
      />

      <OrderFilters
        statuses={ORDER_STATUSES.map((value) => ({
          value,
          label: a.orderStatus[value],
        }))}
        paymentStatuses={PAYMENT_STATUSES.map((value) => ({
          value,
          label: a.paymentStatus[value],
        }))}
        methods={PAYMENT_METHOD_TYPES.map((value) => ({
          value,
          label: PAYMENT_METHOD_DEFS[value].name,
        }))}
        coupons={coupons}
      />

      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="size-8" />}
          title={filtered ? a.orders.noMatches : a.orders.empty}
          description={filtered ? a.orders.noMatchesBody : a.orders.emptyBody}
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
