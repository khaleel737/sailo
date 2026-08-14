import { View } from "react-native";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";
import { useTheme } from "./theme";

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
  /**
   * The retry button's words, localised by the caller.
   *
   * Added rather than hardcoded: this package has no dictionary — it cannot,
   * without every screen's locale being threaded into it — so a default of
   * "Try again" here would be English inside thirty-five translated apps. The
   * fallback exists only so a test or a scratch screen can render without one.
   */
  retryLabel?: string;
  retrying?: boolean;
  testID?: string;
};

export function ErrorState({ message, detail, onRetry, retryLabel, retrying, testID }: ErrorStateProps) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        padding: space.lg,
      }}
      testID={testID}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.dangerSurface,
          marginBottom: space.xs,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="error" size="lg" tone="danger" />
      </View>

      {/*
        The failure announces itself, and the retry stays reachable.

        A failure that replaces the screen moves nobody's focus, so without the
        announcement a seller is sitting on a screen that silently changed under
        them and reading a list that is no longer there. `alert` is what iOS
        acts on; `accessibilityLiveRegion` is Android's half of the same
        instruction, and neither platform honours the other's.

        The button is outside the group on purpose: anything inside an
        `accessible` container stops being reachable as a control, and an error
        state whose only way out cannot be focused is a dead screen for exactly
        the people least able to work around it.
      */}
      <View
        style={{ alignItems: "center", gap: space.xs }}
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Text variant="heading" align="center">
          {message}
        </Text>
        {detail ? (
          <Text variant="caption" tone="muted" align="center" selectable>
            {detail}
          </Text>
        ) : null}
      </View>

      {/*
        A failure with no way out is a dead screen — the seller's only remaining
        move is to force-quit, which on a phone is indistinguishable from the
        product being broken.
      */}
      {onRetry ? (
        <View style={{ marginTop: space.sm }}>
          <Button
            label={retryLabel ?? "Try again"}
            onPress={onRetry}
            loading={retrying}
            icon="refresh"
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}
