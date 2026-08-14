import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { IconName } from "./types";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";

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
  return (
    <View style={styles.container} testID={testID}>
      {/*
       * The icon is decoration and stays silent. The title underneath already
       * says what is missing, and an icon that announced "inbox" first would
       * make a screen reader read the picture before the point.
       */}
      {icon ? (
        <View style={styles.glyph}>
          <Icon name={icon} size="lg" tone="muted" />
        </View>
      ) : null}

      <Text variant="heading" align="center" heading>
        {title}
      </Text>

      {message ? (
        <Text variant="callout" tone="muted" align="center">
          {message}
        </Text>
      ) : null}

      {action ? (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} variant="primary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  /*
   * Centred, and padded generously on the inline axis. An empty state is the
   * only thing on screen when it shows, and a full-width line of centred text
   * is harder to read than a narrow one.
   */
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space["3xl"],
  },
  /* A tinted disc, so the glyph reads as an illustration rather than a control. */
  glyph: {
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken,
    marginBottom: theme.space.xs,
  },
  action: {
    marginTop: theme.space.md,
  },
}));
