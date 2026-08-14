import { Animated, View } from "react-native";
import { useAnimatedNumber } from "./motion";
import { useTheme } from "./theme";

/**
 * Where the seller is in a flow that has an end.
 *
 * Sign-up is four screens — account, email, two-factor, payouts — and until now
 * none of them said so. A form with no visible end is a form people abandon at
 * the second screen, because the only honest answer to "how much more of this
 * is there" is that they cannot tell. Three dots and a bar is the whole
 * intervention, and it is worth more than anything else on those screens.
 *
 * The current step is a *bar* rather than a larger dot, and that is the
 * decision worth defending. Scaling the active dot says "this one is
 * important"; stretching it says "this one is where you are, and it is one of
 * five" — the shape itself carries the progress, which is why it still reads
 * at a glance and in a screenshot.
 */
export type StepDotsProps = {
  /** How many screens the flow has. */
  count: number;
  /** Which one this is, counting from zero. */
  index: number;
  /**
   * What a screen reader says — "Step 2 of 4".
   *
   * Required, because the dots are geometry and there is no text in them to
   * read. Interpolated by the caller so the sentence is in the seller's
   * language, and its grammar is theirs too: "2 of 4" is not the word order
   * every locale uses.
   */
  accessibilityLabel: string;
  testID?: string;
};

export function StepDots({ count, index, accessibilityLabel, testID }: StepDotsProps) {
  const { space } = useTheme();

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
      /* One element with one sentence. Five separate dots would be five stops
         on the way to the field the seller came here to fill in. */
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 1, max: count, now: index + 1 }}
      testID={testID}
    >
      {Array.from({ length: count }, (_, position) => (
        <Dot
          key={position}
          active={position === index}
          /* Behind is filled, ahead is empty. A seller who swipes back should
             see the step they are returning to become the bar again, and the
             one they left stay filled — the flow has not been undone. */
          done={position < index}
        />
      ))}
    </View>
  );
}

function Dot({ active, done }: { active: boolean; done: boolean }) {
  const { colors, motion } = useTheme();
  /*
   * Width, animated. Not native-driven: `width` is a layout property and the
   * native driver only carries `opacity` and `transform`. It is six pixels of
   * layout on a screen with nothing else moving, which is the one place that
   * cost is affordable — and the alternative, animating `scaleX` on a fixed
   * dot, stretches the *rounded ends* along with it and turns a capsule into
   * a lozenge.
   */
  const width = useAnimatedNumber(active ? 24 : 6, { duration: motion.base });

  return (
    <Animated.View
      style={{
        width,
        height: 6,
        borderRadius: 999,
        backgroundColor: active || done ? colors.accent : colors.border,
      }}
    />
  );
}
