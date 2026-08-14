import { Children, Fragment, isValidElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "./text";

/**
 * A section of rows, with the separators and the corner radius handled once.
 *
 * One section per `GroupedList`; a screen with three groups renders three of
 * them. That is deliberately not a `sections` array prop — an array forces
 * every row into one shape, and the settings screen has switches next to
 * chevrons next to destructive rows.
 *
 * The rows go in as children, and the component owns what falls between them:
 * hairlines, insets, and the fact that the first and last rows are the ones
 * that get rounded.
 */
export type GroupedListProps = {
  /** `ListRow`s, in the order they should appear. */
  children: React.ReactNode;
  /** The group label above the section. Sentence case; the theme shouts it. */
  header?: string;
  /** The explanatory line below it — what this group of settings does. */
  footer?: string;
  testID?: string;
};

export function GroupedList({ children, header, footer, testID }: GroupedListProps) {
  /*
   * `toArray` rather than mapping children directly: it drops the nulls a
   * screen produces when it writes `{canRefund ? <ListRow …/> : null}`, and a
   * null left in would draw a hairline with nothing under it — the row that
   * conditionally disappears leaving its separator behind.
   */
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={styles.group} testID={testID}>
      {header ? (
        <Text variant="label" tone="muted" heading>
          {header}
        </Text>
      ) : null}

      {/*
       * `overflow: hidden` is what rounds the first and last rows: each row
       * paints its own opaque background, so a radius on this container alone
       * would be painted straight over by the row inside it.
       */}
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 ? <View style={styles.separator} /> : null}
            {row}
          </Fragment>
        ))}
      </View>

      {footer ? (
        <Text variant="caption" tone="muted">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.space.sm,
  },
  rows: {
    borderRadius: theme.components.card.radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  /*
   * Inset from the leading edge only, so the hairlines line up under the text
   * rather than running the full width. That inset is what makes a stack of
   * rows read as one list of one kind of thing; `marginStart` and not
   * `marginLeft`, so it stays on the leading edge in Arabic.
   */
  separator: {
    height: StyleSheet.hairlineWidth,
    marginStart: theme.components.listRow.separatorInset,
    backgroundColor: theme.colors.border,
  },
}));
