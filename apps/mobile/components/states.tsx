import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * The three things a screen shows when it has no data to show.
 *
 * Shared rather than copied. Every list screen has a first paint with nothing
 * in it, a failure, and a genuinely empty result, and those are the states that
 * get written last and differently each time — one screen spins forever on an
 * error, another shows "0 orders" when it actually means "we couldn't ask".
 * Importing them is what keeps the answer the same on every screen.
 *
 * Deliberately unopinionated about layout: each fills its parent and centres,
 * so a screen drops one in wherever its list would have gone.
 */

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#4f46e5" />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

/**
 * A failure the seller can act on.
 *
 * `onRetry` is not optional. An error with no way out is a dead screen — the
 * seller's only remaining move is to force-quit the app, and on a phone that
 * is indistinguishable from the product being broken.
 */
export function ErrorState({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>{message}</Text>
      <Pressable
        style={[styles.retry, retrying && styles.retryBusy]}
        disabled={retrying}
        onPress={onRetry}
      >
        <Text style={styles.retryText}>{retrying ? "Trying…" : "Try again"}</Text>
      </Pressable>
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  muted: { fontSize: 14, color: "#6b7280", textAlign: "center" },
  error: { color: "#dc2626", fontSize: 14, textAlign: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#111827", textAlign: "center" },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  retryBusy: { opacity: 0.6 },
  retryText: { color: "#4f46e5", fontWeight: "700", fontSize: 14 },
});
