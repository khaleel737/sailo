/**
 * One order, in a list of them.
 *
 * The subtitle is assembled from what the order actually has rather than padded out with a
 * stand-in: an order placed without a name renders the remaining parts instead of the word
 * "Someone", which was an English literal this app had no dictionary key for and no reason to
 * invent.
 */

import { formatMoney } from "@sailo/core/currency";
import { orderStatusLabel } from "@sailo/core/order-status";
import { interpolate } from "@sailo/i18n/native";
import { ListRow, StatusPill } from "@sailo/design-system/native";
import type { Order } from "../../lib/models";
import { orderTone } from "./tone";

/**
 * One order, as a row.
 *
 * `productTitle` and `itemCount` are the order header's own summary of its
 * first line, which is exactly what a list wants and exactly what a detail
 * screen must not trust — `orderItems` is the authoritative list of what was
 * bought, and `[id].tsx` reads that.
 *
 * The subtitle is assembled from what the order actually has rather than padded
 * out with a stand-in: an order placed without a name renders the remaining
 * parts instead of the word "Someone", which was an English literal this app
 * had no dictionary key for and no reason to invent.
 */
export function OrderRow({
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
  const status = orderStatusLabel(order.status, statusLabels);
  const amount = formatMoney(order.totalCents, order.currency, locale);
  const subtitle = [
    order.customerName,
    /*
     * The header's `itemCount` counts the order's lines, so this says "and 2
     * more" without a second request. The lines themselves are only fetched on
     * the detail screen, which is where they are rendered.
     */
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
      value={amount}
      accessory={<StatusPill label={status} tone={orderTone(order.status)} size="sm" />}
      trailing="chevron"
      onPress={() => onPress(order.id)}
      /*
       * The row's parts read as one sentence rather than four stops, which is
       * what `ListRow`'s own note asks for: a screen reader announcing "240 AED"
       * on its own has told the seller nothing about which order it belongs to.
       */
      accessibilityLabel={[order.productTitle, subtitle, status, amount].filter(Boolean).join(", ")}
      testID={`order-${order.id}`}
    />
  );
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-system`; what is left is where the boxes sit relative to each
 * other, which is the one thing no component can decide on a screen's behalf.
 */
/**
 * No safe-area edges, and the empty array is the decision rather than an
 * oversight.
 *
 * The stack header above this screen already consumes the top inset and the
 * native tab bar below it consumes the bottom, so claiming either here inserts
 * a second gap. The list handles its own bottom breathing room through
 * `styles.list`, which is also what lets rows scroll *under* the translucent
 * tab bar instead of stopping short of it.
 */
