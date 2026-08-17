/**
 * Delivery or collection, as it stands.
 */

import { GroupedList, ListRow } from "@sailo/design-system/native";
import type { OrderDetail } from "../../lib/models";
import { useT } from "../../lib/i18n";
import { placedOn } from "./format";

/* -------------------------------------------------------------------------- */
/*  Fulfilment                                                                 */
/* -------------------------------------------------------------------------- */

/** How it gets to the buyer, and how far along that is. */
export function Fulfilment({ order, locale }: { order: OrderDetail; locale: string }) {
  const { a } = useT();

  const rows = [
    order.deliveryLabel ? { label: a.orders.delivery, value: order.deliveryLabel } : null,
    order.pickupLocation ? { label: a.orders.collectFrom, value: order.pickupLocation } : null,
    order.trackingCarrier ? { label: a.orders.carrier, value: order.trackingCarrier } : null,
    order.trackingNumber ? { label: a.orders.trackingNumber, value: order.trackingNumber } : null,
    order.shippedAt ? { label: a.orderStatus.shipped, value: placedOn(order.shippedAt, locale) } : null,
    order.scheduledFor
      ? { label: a.orders.booking, value: placedOn(order.scheduledFor, locale) }
      : null,
    order.serviceLocation ? { label: a.columns.where, value: order.serviceLocation } : null,
  ].filter((row) => row !== null);

  if (rows.length === 0) return null;

  return (
    <GroupedList header={a.orders.delivery}>
      {rows.map((row) => (
        <ListRow key={row.label} title={row.label} value={row.value} subtitleLines={2} />
      ))}
    </GroupedList>
  );
}
