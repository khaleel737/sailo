import { Text as RNText, View } from "react-native";

/**
 * Something failed, and whether it is worth trying again.
 *
 * Separate from `EmptyState` because they are opposite messages. Empty means
 * "this worked, there is nothing here"; this means "we do not know what is
 * here". A screen that showed "No orders yet" after a failed request has told
 * the seller their shop is quiet when it may not be.
 *
 * `retrying` rather than a second boolean for the button's own state: the retry
 * *is* the thing in flight, and two flags would let a screen show a spinning
 * button next to a message saying the request had finished.
 */
export type ErrorStateProps = {
  /**
   * What could not be done, in the seller's terms — "Couldn't load your
   * orders." Server text goes in `detail`, not here.
   */
  message: string;
  /**
   * The underlying reason, when there is one worth showing. Rendered smaller
   * and never in place of `message`, because a raw error is not an explanation.
   */
  detail?: string;
  /** Omit when retrying cannot help — a 403 does not get better on a second tap. */
  onRetry?: () => void;
  retrying?: boolean;
  testID?: string;
};

export function ErrorState({ message, detail, testID }: ErrorStateProps) {
  return (
    <View accessibilityLiveRegion="polite" testID={testID}>
      <RNText accessibilityRole="header">{message}</RNText>
      {detail ? <RNText>{detail}</RNText> : null}
    </View>
  );
}
