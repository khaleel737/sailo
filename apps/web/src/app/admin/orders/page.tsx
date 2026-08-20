import { LearnMore } from "@/app/admin/_components/learn-more";
import { docsUrl } from "@sailo/core/origin";
import type { Metadata } from "next";
import { interpolate } from "@sailo/i18n";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { orderNumber, orderSummaryTitle } from "@/lib/order-lines";
import {
  getInvoiceMap,
  getShopOrders,
  getShopOrderStatusCounts,
  hasOrderFilters,
  usedCouponCodes,
  type OrderFilters as Filters,
} from "@/lib/queries";
import {
  ORDER_STATUSES,
  isOrderStatus,
  orderStatusLabel,
  orderStatusTone,
} from "@sailo/core/order-status";
import {
  PAYMENT_STATUS_TONES,
  isPaymentStatus,
  type PaymentStatus,
} from "@sailo/core/payment-status";
import {
  PAYMENT_METHOD_DEFS,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATUSES,
  isPaymentMethodType,
} from "@/lib/payments";
import { PageHeader, ParcelArt } from "@sailo/design-system/web";
import { LottieArt } from "@/components/shared/lottie-art";
import parcelScene from "@/components/shared/lottie/parcel.json";
import { ExportButton } from "@/app/admin/_components/export-button";
import { OrderTabs } from "./_components/order-tabs";
import {
  BulkOrdersProvider,
  PageSelect,
  RowSelect,
  SelectionArea,
} from "./_components/bulk-select";
import { OrderFilters } from "./_components/order-filters";
import { Badge, EmptyState } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Orders" };

/** One search param, whatever shape the URL gave it. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The list, rebuilt as a table.
 *
 * Every order used to render its whole story here — lines, address, tracking,
 * downloads, refunds, the money breakdown — as a stack of small print, and a
 * seller with forty orders scrolled a wall of it to find the one that needed
 * them. A list page's job is comparing rows; a row's job is to say what the
 * order is, where its money stands and where it is in the lifecycle, and to
 * open. The story moved to `/admin/orders/[id]`, which is where a single
 * order's questions actually get asked and answered.
 */
export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const { shop } = await requireShop("orders:read");
  const { a, locale } = await getAdminT();

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
    search: one(params.q).slice(0, 120) || null,
  };
  const filtered = hasOrderFilters(filters);

  const [orders, counts, coupons] = await Promise.all([
    getShopOrders(shop.id, 100, filters),
    /*
     * Counted under the other filters but never under the selected tab —
     * the tabs are the status dimension, and each needs its own number
     * whichever one is open.
     */
    getShopOrderStatusCounts(shop.id, filters),
    usedCouponCodes(shop.id),
  ]);
  /* One indexed read for the page's numbers — the list names orders the way
     the detail header and the palette do. */
  const invoices = await getInvoiceMap(orders.map((o) => o.id));
  const awaiting = orders.filter((o) => o.paymentStatus === "pending").length;

  const payTone = (status: string) =>
    isPaymentStatus(status) ? PAYMENT_STATUS_TONES[status] : "neutral";
  const payLabel = (status: string) =>
    isPaymentStatus(status) ? a.paymentStatus[status as PaymentStatus] : status;

  const anyOrders = Object.values(counts).some((n) => n > 0);

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

      {anyOrders || filtered ? (
        <BulkOrdersProvider>
          {/* Tabs or the selection bar — never both; see bulk-select.tsx. */}
          <SelectionArea
            tabs={
              <>
          <OrderTabs
            statuses={ORDER_STATUSES.map((value) => ({
              value,
              label: a.orderStatus[value],
            }))}
            counts={counts}
          />

          <OrderFilters
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
              </>
            }
          />

          <Table
            minWidth="56rem"
            head={
              <>
                <Th className="w-10">
                  <PageSelect pageIds={orders.map((o) => o.id)} />
                </Th>
                <Th>{a.columns.order}</Th>
                <Th>{a.columns.client}</Th>
                <Th>{a.columns.date}</Th>
                <Th>{a.columns.payment}</Th>
                <Th>{a.columns.status}</Th>
                <Th align="end">{a.columns.total}</Th>
                <Th className="w-12">
                  <span className="sr-only">{a.columns.actions}</span>
                </Th>
              </>
            }
          >
            {orders.length === 0 ? (
              <EmptyRow colSpan={8}>
                {a.orders.noMatches} — {a.orders.noMatchesBody}
              </EmptyRow>
            ) : (
              orders.map((order) => {
                const href = `/admin/orders/${order.id}`;
                const methodName = isPaymentMethodType(order.paymentMethod)
                  ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
                  : order.paymentMethod;

                return (
                  <Tr key={order.id}>
                    <Td className="w-10">
                      <RowSelect id={order.id} />
                    </Td>
                    {/*
                      The number is the identity — bold, like Linear's issue
                      ids — and what was bought is the supporting line. The
                      rail it was paid on keeps riding along in small print.
                    */}
                    <Td className="max-w-72">
                      <Link
                        href={href}
                        className="focus-ring block min-w-0 rounded pointer-coarse:min-h-11"
                      >
                        <span className="block truncate text-sm font-semibold tabular-nums text-ink-900">
                          {orderNumber(order.id, invoices.get(order.id)?.number)}
                        </span>
                        <span className="block truncate text-xs text-ink-500">
                          {orderSummaryTitle(order)}
                          {order.deliveryLabel ? ` · ${order.deliveryLabel}` : ` · ${methodName}`}
                        </span>
                      </Link>
                    </Td>
                    <Td label={a.columns.client}>
                      <span className="block max-w-44 truncate">
                        {order.customerName ?? "—"}
                      </span>
                    </Td>
                    <Td label={a.columns.date}>
                      <span className="whitespace-nowrap text-ink-500">
                        {order.createdAt.toLocaleDateString(locale, {
                          month: "short",
                          day: "numeric",
                        })}
                        {", "}
                        {order.createdAt.toLocaleTimeString(locale, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </Td>
                    <Td label={a.columns.payment}>
                      <Badge tone={payTone(order.paymentStatus)}>
                        {payLabel(order.paymentStatus)}
                      </Badge>
                    </Td>
                    <Td label={a.columns.status}>
                      <Badge tone={orderStatusTone(order.status)} dot>
                        {orderStatusLabel(order.status, a.orderStatus)}
                      </Badge>
                    </Td>
                    <Td label={a.columns.total} align="end">
                      <span className="font-semibold tabular-nums text-ink-900">
                        {formatMoney(order.totalCents, order.currency, locale)}
                      </span>
                      {order.refundedCents > 0 ? (
                        <span className="block text-xs tabular-nums text-red-600">
                          −{formatMoney(order.refundedCents, order.currency, locale)}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="end">
                      <Link
                        href={href}
                        aria-label={a.orderList.viewOrder}
                        className="focus-ring press hidden size-8 items-center justify-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-900 md:inline-flex"
                      >
                        <ChevronRight className="size-4 rtl:rotate-180" />
                      </Link>
                      <Link
                        href={href}
                        className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 md:hidden pointer-coarse:min-h-11"
                      >
                        {a.orderList.viewOrder}
                        <ChevronRight className="size-3.5 rtl:rotate-180" />
                      </Link>
                    </Td>
                  </Tr>
                );
              })
            )}
          </Table>
        </BulkOrdersProvider>
      ) : (
        <EmptyState
          art={<LottieArt animation={parcelScene} fallback={<ParcelArt />} />}
          title={a.orders.empty}
          description={a.orders.emptyBody}
        />
      )}

      <LearnMore topic={a.orders.title} href={`${docsUrl()}/guides/orders`} />
    </>
  );
}
