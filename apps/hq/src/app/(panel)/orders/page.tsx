import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/_components/hq-export";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Money, RowLink, ShopCell, When } from "@/app/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import { first, getPlatformOrders, pageNumber } from "@/lib/platform";
import { PAYMENT_STATUS_TONES } from "@sailo/core/payment-status";
import { orderSummaryTitle } from "@sailo/core/order-lines";
import { orderStatusTone } from "@sailo/core/order-status";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Orders" };

export default async function HqOrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    status: first(params.status),
    payment: first(params.payment),
    days: Number(first(params.days)) || undefined,
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages, volume } = await getPlatformOrders(filters);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order placed on Sailo, across every shop."
        action={
          <ExportCsv type="orders" />
        }
        meta={
          <span className="tabular text-sm text-ink-500">
            <Money totals={volume} limit={3} />
          </span>
        }
      />

      <HqFilters
        values={{
          q: filters.q,
          status: filters.status,
          payment: filters.payment,
          days: filters.days ? String(filters.days) : undefined,
        }}
        placeholder="Search buyer, product or shop…"
        fields={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "all", label: "Any status" },
              { value: "new", label: "New" },
              { value: "confirmed", label: "Confirmed" },
              { value: "shipped", label: "Shipped" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
              { value: "refunded", label: "Refunded" },
            ],
          },
          {
            name: "payment",
            label: "Payment",
            options: [
              { value: "all", label: "Any payment" },
              { value: "paid", label: "Paid" },
              { value: "pending", label: "Pending" },
              { value: "unpaid", label: "Unpaid" },
            ],
          },
          {
            name: "days",
            label: "Period",
            options: [
              { value: "all", label: "All time" },
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ],
          },
        ]}
      />

      <Table
        minWidth="62rem"
        head={
          <>
            <Th>Placed</Th>
            <Th>Shop</Th>
            <Th>Order</Th>
            <Th>Buyer</Th>
            <Th align="end">Total</Th>
            <Th>Payment</Th>
            <Th>Status</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>No orders match those filters.</EmptyRow>
        ) : (
          rows.map(({ order, shopName, shopHandle, ownerId }) => (
            <Tr key={order.id} className="relative cursor-pointer">
              <Td className="whitespace-nowrap text-ink-500" label="Placed">
                {/*
                  The row opens the order. It hangs off this cell rather than
                  the title one because "Placed" is the first thing in the row
                  and in the phone's card, so the link's own focus ring lands
                  where a keyboard reader is already looking.
                */}
                <RowLink
                  href={`/orders/${order.id}`}
                  label={`Order — ${orderSummaryTitle(order)}`}
                >
                  <When value={order.createdAt} withTime />
                </RowLink>
              </Td>
              <Td className="max-w-48" label="Shop">
                <ShopCell ownerId={ownerId} name={shopName} handle={shopHandle} />
              </Td>
              <Td className="max-w-56">
                <span className="block truncate text-ink-900">
                  {orderSummaryTitle(order)}
                </span>
                <span className="text-xs text-ink-400">
                  {order.paymentMethod}
                  {order.affiliateCode ? ` · ref ${order.affiliateCode}` : ""}
                  {order.couponCode ? ` · ${order.couponCode}` : ""}
                </span>
              </Td>
              <Td className="max-w-40" label="Buyer">
                <span className="block truncate">
                  {order.customerName ?? "Anonymous"}
                </span>
                {order.customerEmail ? (
                  <span className="block truncate text-xs text-ink-400">
                    {order.customerEmail}
                  </span>
                ) : null}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Total">
                {formatMoney(order.totalCents, order.currency)}
                {order.refundedCents > 0 ? (
                  <span className="block text-xs text-red-600">
                    −{formatMoney(order.refundedCents, order.currency)}
                  </span>
                ) : null}
              </Td>
              <Td label="Payment">
                <Badge
                  tone={
                    PAYMENT_STATUS_TONES[
                      order.paymentStatus as keyof typeof PAYMENT_STATUS_TONES
                    ] ?? "neutral"
                  }
                >
                  {order.paymentStatus}
                </Badge>
              </Td>
              <Td label="Status">
                <Badge tone={orderStatusTone(order.status)}>
                  {order.status}
                </Badge>
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="orders"
        basePath="/orders"
        params={{
          q: filters.q,
          status: filters.status,
          payment: filters.payment,
          days: filters.days ? String(filters.days) : undefined,
        }}
      />
    </>
  );
}
