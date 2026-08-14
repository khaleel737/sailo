import { Text as RNText, View } from "react-native";

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
  return (
    <View testID={testID}>
      {header ? <RNText accessibilityRole="header">{header}</RNText> : null}
      <View>{children}</View>
      {footer ? <RNText>{footer}</RNText> : null}
    </View>
  );
}
