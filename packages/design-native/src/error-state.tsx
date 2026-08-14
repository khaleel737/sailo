import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";

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
  /**
   * What the retry button says. **Pass this.**
   *
   * Added by A01 rather than published by A00, which is why it is optional and
   * has a fallback: making it required would break every screen already
   * compiled against the frozen contract. It is the one string in this package
   * a screen has to supply, because it is the one this package would otherwise
   * have to write in English — see the note on `RETRY_FALLBACK` below.
   *
   * @default "Try again", untranslated
   */
  retryLabel?: string;
  testID?: string;
};

export function ErrorState({
  message,
  detail,
  onRetry,
  retrying = false,
  retryLabel,
  testID,
}: ErrorStateProps) {
  return (
    /*
     * A polite live region: the message is announced when it appears, after
     * whatever the reader was in the middle of. Assertive would cut them off
     * mid-word to say a list failed to load, which is not that urgent.
     */
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      accessible
      testID={testID}
    >
      <View style={styles.glyph}>
        <Icon name="warning" size="lg" tone="danger" />
      </View>

      <Text variant="heading" align="center" heading>
        {message}
      </Text>

      {detail ? (
        <Text variant="caption" tone="muted" align="center" selectable>
          {detail}
        </Text>
      ) : null}

      {onRetry ? (
        <View style={styles.action}>
          <Button
            label={retryLabel ?? RETRY_FALLBACK}
            onPress={onRetry}
            variant="secondary"
            icon="refresh"
            loading={retrying}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The only English literal in this package, and it is a stopgap rather than a
 * default worth keeping.
 *
 * Every other word a seller reads arrives as a prop, translated by the screen
 * against `@sailo/i18n/native`. This one cannot yet: the contract A00 froze
 * gives `ErrorState` an `onRetry` and no way to label it, and this package
 * cannot reach the dictionary itself — `@sailo/i18n/native` is A05's work and
 * is not merged, so depending on it would make this branch build only on a
 * machine that happens to have their files in it.
 *
 * So `retryLabel` is added as an optional prop, which the frozen contract
 * allows, and this is what shows if a screen forgets. It reads "Try again" in
 * all thirty-five languages, which is wrong in thirty-four of them. It is one
 * word, it is visible, and it is deliberately not hidden behind a helper that
 * would make the gap look solved. Listed in the handoff for exactly that
 * reason.
 */
const RETRY_FALLBACK = "Try again";

const styles = StyleSheet.create((theme) => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.xl,
    paddingVertical: theme.space["3xl"],
  },
  /*
   * Tinted with the danger colour rather than filled with it. A solid red disc
   * the size of a thumb turns "we could not load your orders" into an alarm,
   * and the seller has to see this every time their train goes into a tunnel.
   */
  glyph: {
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: theme.colors.statusTone.danger.background,
    marginBottom: theme.space.xs,
  },
  action: {
    marginTop: theme.space.md,
  },
}));
