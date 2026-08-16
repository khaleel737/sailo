import { View } from "react-native";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";
import { useTheme } from "./theme";
import type { IconName } from "./types";

/**
 * Nothing here, and what to do about it.
 *
 * Empty is a state, not an absence — a screen that renders nothing when a query
 * comes back with no rows looks broken. The `action` slot is what separates
 * this from a shrug: "No products yet" with an "Add your first product" button
 * is an empty state, without one it is a dead end.
 */
export type EmptyStateProps = {
  title: string;
  /** One line on why it is empty, or what would fill it. */
  message?: string;
  icon?: IconName;
  /** The way out. Omit it only when there genuinely isn't one. */
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function EmptyState({ title, message, icon, action, testID }: EmptyStateProps) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space["2xl"],
        paddingHorizontal: space.lg,
      }}
      testID={testID}
    >
      {icon ? (
        /*
         * The glyph in a tinted disc, not floating on the page.
         *
         * A bare 24pt outline icon centred above two lines of text is the
         * default every empty state arrives at and the one that reads as
         * unfinished — it is the same optical weight as the body copy under
         * it, so the block has no focal point and no top. A filled disc gives
         * it mass, which is what makes the whole state read as a composed thing
         * rather than as three centred elements.
         *
         * Silent: the words below say everything the glyph does.
         */
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accentSurface,
            marginBottom: space.xs,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name={icon} size="lg" tone="brand" />
        </View>
      ) : null}

      {/*
        The title and its explanation are one stop, and the action is not.

        They are one thought — "Orders from your shop will appear here" is
        meaningless without the title it explains, and a seller who lifts their
        finger between the two has read half a sentence. The button stays
        outside the group because anything inside an `accessible` container
        stops being reachable as a control of its own, and an empty state whose
        only way out cannot be focused is worse than one with no way out at all.
      */}
      <View style={{ alignItems: "center", gap: space.xs }} accessible accessibilityRole="text">
        <Text variant="heading" align="center">
          {title}
        </Text>
        {message ? (
          <Text variant="callout" tone="muted" align="center">
            {message}
          </Text>
        ) : null}
      </View>

      {action ? (
        <View style={{ marginTop: space.sm }}>
          <Button label={action.label} onPress={action.onPress} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}
