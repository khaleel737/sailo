import { Animated, View } from "react-native";
import { useShimmer } from "./motion";
import { MIN_TAP, useTheme } from "./theme";

/**
 * The shape of something that has not arrived yet.
 *
 * `shape` rather than width and height, so a loading list looks like the list
 * it is about to become instead of like a set of grey rectangles somebody
 * measured by eye. A skeleton whose proportions are wrong is worse than a
 * spinner — the layout jumps the moment the data lands.
 *
 * IT IS SILENT, AND IT SAYS SO NOW
 *
 * The doc comment used to claim it was `accessibilityElementsHidden` while the
 * code set `accessible`, `accessibilityRole="progressbar"` and the *English
 * string* `"Loading"` — inside an app that ships thirty-five languages. So a
 * screen-reader user on a loading list heard "Loading" in English, eight times,
 * one per placeholder row. A skeleton is a drawing of content that is not there
 * yet; there is nothing in it to read, and the announcement belongs once, on
 * the screen, in the seller's language. This is now what the comment always
 * said it was.
 */
export type SkeletonProps = {
  /** @default "text" */
  shape?: "text" | "title" | "row" | "card" | "circle";
  /** How many, stacked. @default 1 */
  count?: number;
  testID?: string;
};

export function Skeleton({ shape = "text", count = 1, testID }: SkeletonProps) {
  const { colors, radius, space } = useTheme();
  const { progress, running } = useShimmer();

  const box = {
    text: { height: 14, width: "80%" as const, radius: radius.lg },
    title: { height: 22, width: "60%" as const, radius: radius.lg },
    row: { height: MIN_TAP, width: "100%" as const, radius: radius.lg },
    card: { height: 96, width: "100%" as const, radius: radius["2xl"] },
    circle: { height: 40, width: 40, radius: 999 },
  }[shape];

  return (
    <View
      style={{ gap: space.sm }}
      testID={testID}
      /* Nothing to read. Both platforms, because neither honours the other's. */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            height: box.height,
            width: box.width,
            borderRadius: box.radius,
            borderCurve: "continuous",
            backgroundColor: colors.skeleton,
            /* The sheen is a child wider than its parent; without this it
               paints over whatever is beside the placeholder. */
            overflow: "hidden",
          }}
        >
          {running ? <Sheen index={index} progress={progress} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The highlight travelling across a placeholder.
 *
 * A sweep rather than the pulse this used to be, and the difference carries
 * meaning rather than decoration: a block fading in and out says "this is a
 * grey box that is fading", while a highlight moving left to right says
 * "something is on its way". It is the one motion in the interface that is a
 * *statement*, which is what justifies spending an infinite loop on it.
 *
 * `translateX` on the native driver, so the loop never touches the JS thread —
 * which matters precisely because a skeleton is on screen exactly when the JS
 * thread is busy parsing the response that will replace it.
 */
function Sheen({ index, progress }: { index: number; progress: Animated.Value }) {
  const { colors } = useTheme();

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        /* Wider than the box and started off its leading edge, so the sweep
           enters and leaves rather than appearing in the middle. */
        width: "60%",
        backgroundColor: colors.skeletonSheen,
        opacity: 0.5,
        transform: [
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              /* Points rather than percentages: `translateX` accepts a string
                 percentage on iOS and silently ignores it on Android, which
                 is the sort of divergence that ships. 420 clears the widest
                 placeholder on any phone. */
              outputRange: [-260, 420],
            }),
          },
          /* A slight lean, so the sweep reads as a light source passing over
             rather than as a bar sliding across. */
          { skewX: "-20deg" },
        ],
        /*
         * Each row in a stack starts a beat behind the one above it.
         *
         * They share one driver — a loop per placeholder would be eight timers
         * for one effect — so the offset is baked into the geometry instead:
         * shifting the start position by row is indistinguishable from
         * delaying it, and costs nothing.
         */
        marginStart: -((index % 3) * 40),
      }}
    />
  );
}
