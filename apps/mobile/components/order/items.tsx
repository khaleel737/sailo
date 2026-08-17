/**
 * The lines of an order, as the seller reads them back.
 */

import { formatMoney } from "@sailo/core/currency";
import { GroupedList, ListRow } from "@sailo/design-system/native";
import type { OrderItem } from "../../lib/models";

/* -------------------------------------------------------------------------- */
/*  Lines                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What was actually bought.
 *
 * Read from `items`, never from the header. The order row carries
 * `productTitle`, `unitPriceCents` and `quantity` as a summary of the *first*
 * line so a list can render without a join — on a two-line order those columns
 * describe one of them, and a detail screen that trusted them would quietly
 * show the wrong basket.
 */
export function Items({
  items,
  currency,
  locale,
  header,
}: {
  items: OrderItem[];
  currency: string;
  locale: string;
  header: string;
}) {
  return (
    <GroupedList header={header}>
      {items.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          subtitle={[
            item.variantLabel,
            `${item.quantity} × ${formatMoney(item.unitPriceCents, currency, locale)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          // The line's own subtotal — unit price × quantity, as stored.
          valueTone="strong"
          value={formatMoney(item.subtotalCents, currency, locale)}
        />
      ))}
    </GroupedList>
  );
}
