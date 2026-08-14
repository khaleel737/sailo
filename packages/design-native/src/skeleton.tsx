import { View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useShimmer } from "./theme/motion";

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

export function Skeleton({ shape = "text", count = 1, testID }: SkeletonProps) {
  const { theme } = useUnistyles();
  const shimmer = useShimmer(theme.colors.skeleton, theme.colors.skeletonSheen);

  styles.useVariants({ shape });

  return (
    <View
      style={styles.stack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {Array.from({ length: Math.max(1, count) }, (_, index) => (
        /*
         * Every bar breathes on the same shared value rather than one each, so
         * a list of eight is one animation and not eight slightly out of step
         * with each other — the stagger reads as jank, not as life.
         */
        <Animated.View key={index} style={[styles.bar, shimmer]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.components.skeleton.gap,

    variants: {
      /*
       * A row skeleton is one bar per row and a text skeleton is one per line,
       * so only the shapes that stand in for a *list* stretch. The rest hug,
       * or a single 13pt bar would span the screen and read as a divider.
       */
      shape: {
        text: { alignSelf: "stretch" },
        title: { alignSelf: "stretch" },
        row: { alignSelf: "stretch" },
        card: { alignSelf: "stretch" },
        circle: { alignSelf: "flex-start" },
      },
    },
  },
  bar: {
    backgroundColor: theme.colors.skeleton,
    borderRadius: theme.components.skeleton.radius,

    variants: {
      shape: {
        /*
         * Not 100%. A paragraph of real text does not reach the margin on
         * every line, and a stack of full-width bars reads as a table.
         */
        text: {
          height: theme.components.skeleton.text.height,
          width: theme.components.skeleton.text.width,
        },
        title: {
          height: theme.components.skeleton.title.height,
          width: theme.components.skeleton.title.width,
        },
        row: {
          height: theme.components.skeleton.row.height,
          alignSelf: "stretch",
        },
        card: {
          height: theme.components.skeleton.card.height,
          alignSelf: "stretch",
          borderRadius: theme.components.card.radius,
        },
        circle: {
          height: theme.components.skeleton.circle.size,
          width: theme.components.skeleton.circle.size,
          borderRadius: 999,
        },
      },
    },
  },
}));
