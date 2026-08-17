/**
 * One recent order, on the home screen.
 */

import { formatMoney } from "@sailo/core/currency";
import { orderStatusLabel } from "@sailo/core/order-status";
import { interpolate } from "@sailo/i18n/native";
import { ListRow } from "@sailo/design-system/native";
import type { Order } from "../../lib/models";

/**
 * One of the five most recent orders.
 *
 * No status pill, unlike the Orders tab's rows: this list is five lines under a
 * block of numbers, and the status reads better as the middle of a sentence
 * than as a third column competing with the amount. The word itself is the same
 * one — `orderStatusLabel` over the same dictionary — so the two surfaces
 * cannot disagree about what an order's state is called.
 */
export function RecentRow({
  order,
  locale,
  statusLabels,
  andMore,
  ago,
  now,
  onPress,
}: {
  order: Order;
  locale: string;
  statusLabels: Record<string, string>;
  /** `a.orders.andMore` — "+ {count} more", still holding its placeholder. */
  andMore: string;
  ago: (iso: string, now: number) => string;
  now: number;
  onPress: (id: string) => void;
}) {
  const subtitle = [
    order.customerName,
    orderStatusLabel(order.status, statusLabels),
    order.itemCount > 1 ? interpolate(andMore, { count: order.itemCount - 1 }) : null,
    ago(order.createdAt, now),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      title={order.productTitle}
      subtitle={subtitle}
      valueTone="strong"
      value={formatMoney(order.totalCents, order.currency, locale)}
      trailing="chevron"
      onPress={() => onPress(order.id)}
      accessibilityLabel={[
        order.productTitle,
        subtitle,
        formatMoney(order.totalCents, order.currency, locale),
      ]
        .filter(Boolean)
        .join(", ")}
      testID={`recent-${order.id}`}
    />
  );
}
