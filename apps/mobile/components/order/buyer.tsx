/**
 * Who bought it, and how to reach them.
 */

import { GroupedList, ListRow } from "@sailo/design-system/native";
import type { OrderDetail } from "../../lib/models";
import { useT } from "../../lib/i18n";

/* -------------------------------------------------------------------------- */
/*  Buyer                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who bought it — the snapshot taken at checkout, not the client record.
 * A buyer who later edits their profile must not silently rewrite an order
 * that was already placed and possibly already invoiced.
 */
export function Buyer({ order }: { order: OrderDetail }) {
  const { t, a } = useT();

  const address = [
    order.addressLine1,
    order.addressLine2,
    order.city,
    order.region,
    order.postalCode,
    order.country,
  ]
    .filter(Boolean)
    .join(", ");

  const rows = [
    order.customerName ? { label: a.common.name, value: order.customerName } : null,
    order.customerEmail ? { label: a.common.email, value: order.customerEmail } : null,
    order.customerPhone ? { label: a.clients.phone, value: order.customerPhone } : null,
    address ? { label: t.checkout.deliveryAddress, value: address } : null,
    order.paymentMethod
      ? { label: a.orders.paymentMethodLabel, value: order.paymentMethod }
      : null,
    order.paymentReference ? { label: a.orders.transferRef, value: order.paymentReference } : null,
    order.note ? { label: a.clients.note, value: order.note } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <GroupedList header={a.columns.client}>
      {rows.map((row) => (
        <ListRow key={row.label} title={row.label} value={row.value} subtitleLines={2} />
      ))}
    </GroupedList>
  );
}
