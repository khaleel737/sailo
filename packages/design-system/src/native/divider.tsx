import { StyleSheet, View } from "react-native";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * A line between two things, or a line with a word in it.
 *
 * `StyleSheet.hairlineWidth` rather than 1, and the difference is visible. On a
 * 3× screen a 1pt rule is three physical pixels; the system draws its own
 * separators at one, and a rule that is three times heavier than the one in the
 * navigation bar directly above it is the sort of thing that reads as "not
 * quite right" without anybody being able to say why.
 */
export type DividerProps = {
  /**
   * A word set into the line — "or", "then". The line breaks around it.
   *
   * The alternative every auth screen writes by hand is a centred caption with
   * a rule above and below it, which is three elements and a different amount
   * of vertical space in each of the four files that do it.
   */
  label?: string;
  /** Vertical breathing room above and below. @default "md" */
  spacing?: "none" | "sm" | "md" | "lg";
  testID?: string;
};

export function Divider({ label, spacing = "md", testID }: DividerProps) {
  const { colors, space } = useTheme();
  const margin = spacing === "none" ? 0 : space[spacing];

  const rule = (
    <View
      style={{
        flex: 1,
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
      }}
    />
  );

  if (!label) {
    return (
      <View style={{ marginVertical: margin }} testID={testID}>
        {rule}
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        marginVertical: margin,
      }}
      testID={testID}
    >
      {rule}
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {/*
        A second element rather than the same one twice: React Native has no
        `:before`/`:after`, and a rule that only ran down one side would put the
        label off-centre in every language whose word for "or" is a different
        length — which is thirty-five of them.
      */}
      <View
        style={{
          flex: 1,
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
        }}
      />
    </View>
  );
}
