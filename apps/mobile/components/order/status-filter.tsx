/**
 * Choosing which orders to look at.
 */

import { ORDER_STATUSES, orderStatusLabel, type OrderStatus } from "@sailo/core/order-status";
import { GroupedList, Icon, ListRow, Sheet } from "@sailo/design-system/native";

/**
 * The status filter, plus the absence of one.
 *
 * Declared here rather than in the screen because both this sheet and the query that reads its
 * value need it, and a type owned by a route is a type its components have to re-declare.
 */
export type Filter = OrderStatus | "all";

/**
 * The six statuses and "all of them", as a sheet.
 *
 * Every status the database can hold, in the order `ORDER_STATUSES` declares
 * them, so a filter cannot quietly stop offering one the moment a seller starts
 * using it. There is no count beside each: the server would have to run six
 * more queries to produce them, and a stale count next to a filter is worse
 * than no count at all.
 */
export function StatusFilter({
  visible,
  current,
  title,
  allLabel,
  labels,
  onPick,
  onClose,
  closeLabel,
}: {
  visible: boolean;
  current: Filter;
  title: string;
  allLabel: string;
  labels: Record<string, string>;
  onPick: (next: Filter) => void;
  onClose: () => void;
  /** The sheet's close button, in the seller's language. */
  closeLabel: string;
}) {
  const options: { value: Filter; label: string }[] = [
    { value: "all", label: allLabel },
    ...ORDER_STATUSES.map((status) => ({
      value: status as Filter,
      label: orderStatusLabel(status, labels),
    })),
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={closeLabel}>
      <GroupedList>
        {options.map((option) => (
          <ListRow
            key={option.value}
            title={option.label}
            /*
             * The tick is the only thing marking the current filter, so it is
             * the one icon here that gets a label of its own — `Icon`'s note is
             * that a glyph beside text should be silent, and this one is not
             * beside text that repeats it.
             */
            accessory={
              option.value === current ? <Icon name="check" accessibilityLabel={title} /> : undefined
            }
            onPress={() => onPick(option.value)}
            testID={`filter-${option.value}`}
          />
        ))}
      </GroupedList>
    </Sheet>
  );
}
