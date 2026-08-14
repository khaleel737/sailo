import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { usePressMotion } from "./theme/motion";

/**
 * A surface that groups things.
 *
 * `onPress` is what turns it into a control: passing one makes the whole card
 * tappable and gives it a button role, so a screen never has to wrap a card in
 * its own `Pressable` and lose the press feedback the theme provides.
 */
export type CardProps = {
  children: React.ReactNode;
  /**
   * `elevated` is for something floating above the page — reserve it. Two
   * elevations on one screen is one too many.
   * @default "outlined"
   */
  variant?: "plain" | "outlined" | "elevated";
  /** @default "md" */
  padding?: "none" | "sm" | "md" | "lg";
  /** Makes the whole card a control. */
  onPress?: () => void;
  /** Required when `onPress` is set and the card's content is not a sentence. */
  accessibilityLabel?: string;
  testID?: string;
};

export function Card({
  children,
  variant = "outlined",
  padding = "md",
  onPress,
  accessibilityLabel,
  testID,
}: CardProps) {
  const [pressed, setPressed] = useState(false);
  /*
   * A card is a big target, and a big thing that scales as much as a button
   * looks like it is being squashed rather than pressed. Half the travel.
   */
  const motion = usePressMotion(0.985);

  styles.useVariants({ variant, padding, pressed });

  if (!onPress) {
    return (
      <View style={styles.card} accessibilityLabel={accessibilityLabel} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Animated.View style={motion.style}>
      <Pressable
        style={styles.card}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          motion.onPressIn();
        }}
        onPressOut={() => {
          setPressed(false);
          motion.onPressOut();
        }}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.components.card.radius,
    borderWidth: 1,
    borderColor: "transparent",

    variants: {
      variant: {
        plain: {
          backgroundColor: theme.colors.surface,
        },
        outlined: {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        /*
         * iOS reads `shadow*`, Android reads `elevation`, and setting one gives
         * a card that floats on exactly one platform. On dark the shadow does
         * almost nothing — black on near-black — so the elevated surface is a
         * lighter grey as well, which is the part that actually reads.
         */
        elevated: {
          backgroundColor: theme.colors.surfaceElevated,
          shadowColor: "#000000",
          shadowOpacity: theme.components.card.elevation.shadowOpacity,
          shadowRadius: theme.components.card.elevation.shadowRadius,
          shadowOffset: theme.components.card.elevation.shadowOffset,
          elevation: theme.components.card.elevation.androidElevation,
        },
      },
      padding: {
        none: { padding: theme.components.card.padding.none },
        sm: { padding: theme.components.card.padding.sm },
        md: { padding: theme.components.card.padding.md },
        lg: { padding: theme.components.card.padding.lg },
      },
      pressed: {
        true: { backgroundColor: theme.colors.surfaceSunken },
        false: {},
      },
    },
  },
}));
