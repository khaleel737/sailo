import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { SectionTitle, When } from "@/app/hq/_components/hq-ui";
import { Badge } from "@/components/ui";
import { PAYMENT_STATUS_TONES } from "@/lib/payments";
import { orderSummaryTitle } from "@/lib/order-lines";
import { formatMoney } from "@/lib/utils";
import { orderStatusTone } from "@/lib/order-status";
import type { AccountDetail } from "./account.types";

/** Every order this shop has taken, newest first. */

/*
 * No `shop` prop: each row formats with `order.currency`, not the shop's
 * current one. An order stays priced in the currency it was taken in, so a
 * seller who switches currency doesn't silently restate their history.
 */
export function OrdersTable({ detail }: { detail: AccountDetail }) {
  return (
    <>
    <SectionTitle>Recent orders</SectionTitle>
    <Table
      minWidth="38rem"
      head={
        <>
          <Th>Order</Th>
          <Th>Buyer</Th>
          <Th align="end">Total</Th>
          <Th>Payment</Th>
          <Th>Status</Th>
          <Th align="end">Placed</Th>
        </>
      }
    >
      {detail.recentOrders.length === 0 ? (
        <EmptyRow colSpan={6}>No orders yet.</EmptyRow>
      ) : (
        detail.recentOrders.map((order) => (
          <Tr key={order.id}>
            <Td className="max-w-56">
              <span className="block truncate text-ink-900">
                {orderSummaryTitle(order)}
              </span>
              <span className="text-xs text-ink-400">
                {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                {order.affiliateCode ? ` · ref ${order.affiliateCode}` : ""}
                {order.couponCode ? ` · ${order.couponCode}` : ""}
              </span>
            </Td>
            <Td className="max-w-40" label="Buyer">
              <span className="block truncate">
                {order.customerName ?? "Anonymous"}
              </span>
            </Td>
            <Td align="end" className="tabular whitespace-nowrap" label="Total">
              {formatMoney(order.totalCents, order.currency)}
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
              <Badge
                tone={orderStatusTone(order.status)}
              >
                {order.status}
              </Badge>
            </Td>
            <Td align="end" className="text-ink-500" label="Placed">
              <When value={order.createdAt} />
            </Td>
          </Tr>
        ))
      )}
    </Table>

    </>
  );
}
