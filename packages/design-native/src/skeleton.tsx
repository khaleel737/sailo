import { View } from "react-native";

/**
 * The shape of something that has not arrived yet.
 *
 * `shape` rather than width and height, so a loading list looks like the list
 * it is about to become instead of like a set of grey rectangles somebody
 * measured by eye. A skeleton whose proportions are wrong is worse than a
 * spinner — the layout jumps the moment the data lands.
 *
 * It is `accessibilityElementsHidden`, and that is deliberate: there is nothing
 * here to read out, and a screen reader announcing eight empty rows is noise
 * over the top of whatever the seller was actually doing.
 */
export type SkeletonProps = {
  /** @default "text" */
  shape?: "text" | "title" | "row" | "card" | "circle";
  /** How many, stacked. @default 1 */
  count?: number;
  testID?: string;
};

export function Skeleton({ count = 1, testID }: SkeletonProps) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} />
      ))}
    </View>
  );
}
