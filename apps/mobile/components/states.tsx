import { View } from "react-native";
import {
  EmptyState as DesignEmptyState,
  ErrorState as DesignErrorState,
  Skeleton,
  Text,
  useTheme,
} from "@sailo/design-native";
import type { IconName } from "@sailo/design-native";

/**
 * The three things a screen shows when it has no data to show.
 *
 * WHAT THIS FILE USED TO BE, AND WHY IT MATTERED MORE THAN IT LOOKS
 *
 * A `StyleSheet` of eight hardcoded colours:
 *
 *     "#4f46e5"  the spinner and the retry label — indigo
 *     "#6b7280"  every muted line — a violet-tinted grey
 *     "#111827"  the empty-state title — the same grey, darker
 *     "#e5e7eb"  the retry button's border
 *     "#dc2626"  the error line
 *
 * Two separate problems, and the second is the worse one.
 *
 * The first is that none of those colours is Sailo's. The indigo is the
 * framework default; the greys are the *violet-tinted* neutral that
 * `globals.css` documents at length as the thing the brand work removed —
 * "walking from the landing page into /admin read as walking into a different
 * product". They were reintroduced here, on the phone.
 *
 * The second is that **none of them has a dark variant**. `#111827` is a
 * near-black title, and this component draws it on whatever is behind it —
 * which in dark mode is `#0d0d0c`. So on every list screen in the app, the
 * empty state's own heading was black on black: invisible. And this is not one
 * screen's problem. It is the loading, empty and error state of Orders, Store,
 * Insights, Home and the check-in list — the first thing a new seller sees on
 * five of the six screens they have.
 *
 * Everything below now goes through `@sailo/design-native`, which has both
 * modes and one ramp. The exported names are unchanged so no screen has to be
 * edited to get the fix.
 */

/**
 * Waiting.
 *
 * A skeleton of the shape that is coming, rather than the spinner this used to
 * be. A spinner says "something is happening"; a skeleton says "a list is
 * coming and it will be about this tall", and the difference is that the second
 * one does not make the layout jump when the data lands.
 *
 * `label` is what a screen reader says while it waits. The English fallback is
 * kept — every caller today relies on it — but it is a fallback and not the
 * design: this app ships thirty-five languages, and a screen that knows what it
 * is loading should say so in the seller's own.
 */
export function Loading({ label, shape = "row" }: { label?: string; shape?: "row" | "card" | "text" }) {
  const { space } = useTheme();

  return (
    <View
      style={{ flex: 1, padding: space.lg, gap: space.md }}
      /*
       * One announcement, on the container — not one per placeholder.
       *
       * `Skeleton` is silent by design (it draws nothing worth reading), so the
       * screen is where the "still loading" has to be said. Without it a screen
       * reader lands on a view with no text and no role, which is
       * indistinguishable from the app having hung.
       */
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? "Loading"}
      testID="loading"
    >
      <Skeleton shape={shape} count={5} />
    </View>
  );
}

/**
 * A failure the seller can act on.
 *
 * `onRetry` is not optional. An error with no way out is a dead screen — the
 * seller's only remaining move is to force-quit the app, and on a phone that
 * is indistinguishable from the product being broken.
 *
 * The retry label is a prop now rather than the literal `"Try again"` that used
 * to be baked in, for the same reason `Loading`'s is: this is the one string on
 * the screen and it was in English in every locale.
 */
export function ErrorState({
  message,
  detail,
  onRetry,
  retryLabel,
  retrying,
}: {
  message: string;
  detail?: string;
  onRetry: () => void;
  retryLabel?: string;
  retrying?: boolean;
}) {
  return (
    <DesignErrorState
      message={message}
      detail={detail}
      onRetry={onRetry}
      retryLabel={retryLabel}
      retrying={retrying}
      testID="error-state"
    />
  );
}

/**
 * Title and hint are one thought, so they are one stop. Two separate elements
 * make a seller swipe twice to learn one fact — and the hint on its own
 * ("Orders from your shop will appear here") is meaningless without the title
 * it explains.
 */
export function Empty({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  /** The glyph in the tinted disc above the title. */
  icon?: IconName;
  /** The way out, when there is one. An empty state without one is a dead end. */
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <DesignEmptyState
        title={title}
        message={hint}
        icon={icon}
        action={action}
        testID="empty-state"
      />
    </View>
  );
}

/**
 * A line of supporting text, themed.
 *
 * Kept because four screens import it for a caption that is not part of any of
 * the three states above. It used to be `{ fontSize: 14, color: "#6b7280" }`.
 */
export function Muted({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="muted" align="center">
      {children}
    </Text>
  );
}

/**
 * What to put in front of the seller when a request fails.
 *
 * The server's own message is used when there is one — `NOT_FOUND` from a
 * procedure says "No such order", which is more use than anything this file
 * could invent. The fallback is for the case with no message at all, which is
 * overwhelmingly the phone being on a train.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}
