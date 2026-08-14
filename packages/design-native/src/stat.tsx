import { Text as RNText, View } from "react-native";

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
  return (
    <View testID={testID}>
      <RNText>{loading ? "" : value}</RNText>
      <RNText>{label}</RNText>
      {delta ? <RNText>{delta.label}</RNText> : null}
      {caption ? <RNText>{caption}</RNText> : null}
    </View>
  );
}
