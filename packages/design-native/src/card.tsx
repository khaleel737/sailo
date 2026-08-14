import { Pressable, View } from "react-native";

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

export function Card({ children, onPress, accessibilityLabel, testID }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} testID={testID}>
      {children}
    </View>
  );
}
