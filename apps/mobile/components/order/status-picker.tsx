/**
 * Choosing a status, and naming a payment state.
 *
 * Generic over the status union so the order picker and the payment picker are one component:
 * two would be two lists of labels to keep in step.
 */

import { GroupedList, Icon, ListRow, Sheet } from "@sailo/design-system/native";

/* -------------------------------------------------------------------------- */
/*  Status picker                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The six statuses, offered exactly as the web dropdown offers them.
 *
 * All of `ORDER_STATUSES`, with no transition rules layered on top — because
 * the web has none either. Inventing "you may only go forward" here would make
 * the phone refuse a correction the same seller can make on their laptop.
 *
 * A `Sheet` rather than a hand-rolled `Modal`: the scrim tap, the swipe-down
 * and the back gesture are all its business, and so is what any of that looks
 * like when the seller has Reduce Motion on.
 */
/**
 * One picker for both status kinds.
 *
 * It used to iterate `ORDER_STATUSES` itself, which was right while there was
 * one list to pick from. There are two now — an order's own state and whether
 * its money has arrived — and they are picked the same way, told apart only by
 * which options they offer. A second near-identical sheet is a second place to
 * forget the tick, the close label and the grouping.
 *
 * `options` rather than a list name: the payment set a seller may choose from
 * is narrower than the set that exists — `disputed` is a fact a bank reported,
 * not an opinion they hold — and the caller is what knows which.
 */
export function StatusPicker<T extends string>({
  visible,
  current,
  title,
  options,
  label,
  onPick,
  onClose,
  closeLabel,
}: {
  visible: boolean;
  current: string;
  title: string;
  options: readonly T[];
  /** How each option is written in the seller's language. */
  label: (value: T) => string;
  onPick: (status: T) => void;
  onClose: () => void;
  /** The sheet's close button, in the seller's language — the design system
   *  holds no dictionary, so the word comes from here. */
  closeLabel: string;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={closeLabel}>
      <GroupedList>
        {options.map((status) => {
          const active = status === current;
          return (
            <ListRow
              key={status}
              title={label(status)}
              /*
               * The tick is the only thing marking the current status, so it is
               * the one icon on this screen that gets a label of its own —
               * `Icon`'s note is that a glyph beside text should be silent, and
               * this one is not beside text that repeats it.
               */
              accessory={active ? <Icon name="check" accessibilityLabel={title} /> : undefined}
              onPress={() => onPick(status)}
            />
          );
        })}
      </GroupedList>
    </Sheet>
  );
}
