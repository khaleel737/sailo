import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { Tone } from "./types";
import { Skeleton } from "./skeleton";
import { Text } from "./text";

/** Which way a number moved, and whether that is good news. */
export type StatDelta = {
  /** Already formatted — "+12%", "−3". */
  label: string;
  direction: "up" | "down" | "flat";
  /**
   * Whether `up` is the good direction. Refunds going up is not good news, and
   * a component that assumed otherwise would paint that green.
   */
  upIsGood?: boolean;
};

/**
 * One headline number with its label.
 *
 * `value` arrives formatted. This component does not know whether it is money,
 * a count or a percentage, and giving it that job would mean a second currency
 * formatter living next to `@sailo/core/currency`.
 */
export type StatProps = {
  label: string;
  /** Formatted by the caller. Use `Money` for amounts. */
  value: string;
  /** The comparison, when there is one to make. */
  delta?: StatDelta;
  /**
   * What the number is *of* — "last 30 days". Required when the figure covers a
   * window rather than all time, because a bare number over a windowed query
   * reads as a total.
   */
  caption?: string;
  /** Draws a placeholder of the right size rather than collapsing the layout. */
  loading?: boolean;
  testID?: string;
};

/**
 * Whether a movement is good news, which is not the same as which way it went.
 *
 * `upIsGood` defaults to true because most numbers on a seller's dashboard are
 * things they want more of. Refunds and cancellations are the exceptions and
 * pass `false`, which is the whole reason this is a prop rather than a rule —
 * a component that painted every rise green would congratulate a shop on its
 * refund rate.
 *
 * `flat` is muted rather than either colour. No change is not good news and it
 * is not bad news; colouring it would invent a story about a number that did
 * not move.
 */
function deltaTone(delta: StatDelta): Tone {
  if (delta.direction === "flat") return "muted";
  const good = delta.upIsGood ?? true;
  return delta.direction === "up" ? (good ? "success" : "danger") : good ? "danger" : "success";
}

export function Stat({ label, value, delta, caption, loading = false, testID }: StatProps) {
  return (
    <View style={styles.container} testID={testID}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      {/*
       * The skeleton is a `title` because the value is drawn at the title
       * scale — a placeholder of the wrong height makes the whole card jump
       * when the number lands, which is the thing skeletons exist to prevent.
       */}
      {loading ? (
        <Skeleton shape="title" />
      ) : (
        <Text variant="title" numberOfLines={1}>
          {value}
        </Text>
      )}

      {/*
       * The delta's sign is in its own text — "+12%", "−3" — so the colour is
       * the second signal and never the only one. A seller who cannot tell the
       * green from the red still reads the sign.
       */}
      {delta && !loading ? (
        <Text variant="caption" tone={deltaTone(delta)} weight="semibold">
          {delta.label}
        </Text>
      ) : null}

      {caption ? (
        <Text variant="caption" tone="muted">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.space.xs,
    /*
     * `flexShrink` and no width: a row of these divides the space it is given
     * rather than each one claiming a share, so two stats and four stats both
     * lay out without the caller passing a column count.
     */
    flexShrink: 1,
  },
}));
