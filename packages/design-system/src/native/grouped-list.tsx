import { View } from "react-native";
import { Text } from "./text";
import { useTheme } from "./theme";

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
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      {header ? (
        <Text variant="label" tone="muted" heading>
          {header}
        </Text>
      ) : null}
      {/*
        The separators are drawn by the rows, not here: a group cannot know
        which of its children is last without cloning them, and a hairline under
        the final row is the one that reads as a mistake. `ListRow` owns its own
        bottom border and `:last-child` is expressed by the group's overflow
        clipping it away.
      */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius["2xl"],
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {footer ? (
        <Text variant="caption" tone="muted">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
