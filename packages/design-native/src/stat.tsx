import { View } from "react-native";
import { Icon } from "./icon";
import { Skeleton } from "./skeleton";
import { Text } from "./text";
import { useTheme } from "./theme";

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

export function Stat({ label, value, delta, caption, loading, testID }: StatProps) {
  const { space } = useTheme();

  /*
   * Which direction is good is the caller's call. Revenue up is good; refunds
   * up is not, and a component that assumed green-for-up would congratulate a
   * seller on the wrong number.
   */
  const deltaTone = !delta
    ? "muted"
    : delta.direction === "flat"
      ? "muted"
      : (delta.direction === "up") === (delta.upIsGood ?? true)
        ? "success"
        : "danger";

  return (
    <View
      style={{ flex: 1, gap: 2 }}
      testID={testID}
      /*
       * The label, the number and its window are one fact.
       *
       * Left as separate nodes they are three stops, and the number on its own
       * — "1,284" — is announced with nothing to say what it counts. Grouping
       * them makes a screen reader read "Orders, 1,284, last 30 days", which is
       * the sentence a seeing seller reads in one glance.
       */
      accessible
      accessibilityRole="text"
    >
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>

      {loading ? (
        <Skeleton shape="title" />
      ) : (
        /*
         * From the ramp, not from a loose `fontSize: 24`.
         *
         * The hardcoded pair (24/30, weight 700, tabular figures) predated
         * `display` and `numeric` and sat between them, so a row of stat tiles
         * was set at a size that appeared nowhere else in the product — and it
         * did not scale with Dynamic Type in step with the caption above it,
         * which is what made the tiles look crowded at the larger settings.
         */
        <Text variant="display" numberOfLines={1}>
          {value}
        </Text>
      )}

      {delta ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {/*
            An arrow as well as a colour.

            Green-versus-red is the whole signal otherwise, and it is the one
            pair of colours roughly 8% of men cannot separate. The arrow says
            the same thing in a form that survives that, a greyscale
            screenshot, and a printed report.
          */}
          {delta.direction !== "flat" ? (
            <Icon name={delta.direction === "up" ? "arrowUp" : "arrowDown"} size="sm" tone={deltaTone} />
          ) : null}
          <Text variant="caption" tone={deltaTone}>
            {delta.label}
          </Text>
        </View>
      ) : null}

      {caption ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
