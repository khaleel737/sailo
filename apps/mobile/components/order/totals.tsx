/**
 * What the order came to, itemised.
 *
 * Every figure here is rendered from stored minor units through the shared formatter — the
 * phone never divides by a hundred itself.
 */

import { formatMoney } from "@sailo/core/currency";
import { GroupedList, ListRow } from "@sailo/design-system/native";
import type { OrderDetail } from "../../lib/models";
import { useT } from "../../lib/i18n";

export function Totals({ order, locale }: { order: OrderDetail; locale: string }) {
  const { t, a } = useT();
  const money = (minor: number) => formatMoney(minor, order.currency, locale);

  return (
    <GroupedList header={t.checkout.total}>
      <ListRow title={t.checkout.subtotal} valueTone="strong" value={money(order.subtotalCents)} />
      {order.discountCents > 0 ? (
        <ListRow
          title={order.couponCode ?? t.checkout.discount}
          valueTone="strong"
          value={`− ${money(order.discountCents)}`}
        />
      ) : null}
      {order.deliveryFeeCents > 0 ? (
        <ListRow title={a.orders.delivery} valueTone="strong" value={money(order.deliveryFeeCents)} />
      ) : null}
      {order.taxCents > 0 ? (
        <ListRow
          /*
           * The shop's own word for it — "VAT", "GST", "Sales tax" —
           * snapshotted on the order, because that is what the buyer's invoice
           * says. An inclusive rate is named rather than marked: the money was
           * already inside the total above, and a bare "VAT" line under it
           * reads as an amount added on top.
           */
          title={
            order.taxInclusive
              ? `${t.invoice.includes} ${order.taxName ?? t.invoice.tax}`
              : (order.taxName ?? t.invoice.tax)
          }
          valueTone="strong"
          value={money(order.taxCents)}
        />
      ) : null}
      <ListRow title={t.checkout.total} valueTone="strong" value={money(order.totalCents)} />
      {order.refundedCents > 0 ? (
        <ListRow title={a.orders.refunded} valueTone="strong" value={`− ${money(order.refundedCents)}`} />
      ) : null}
    </GroupedList>
  );
}
