import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../../../lib/auth";
import { forgetDevice, openSystemSettings, usePushSettings } from "../../../lib/push";
import { useTRPC } from "../../../lib/query";
import { Loading } from "../../../components/states";

/**
 * Who the seller is signed in as, whether their phone will buzz, and the way
 * out.
 *
 * The whole screen is three answers to "what is true about this device", which
 * is why there is no save button: a settings screen that batches changes behind
 * one is a screen that can be left in a state the seller believes they set and
 * did not. Each control commits on the spot and shows what it actually achieved
 * — notably the notification toggle, which can fail to turn on for a reason
 * that has nothing to do with this app.
 */
export default function Settings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const shop = useQuery(trpc.shop.get.queryOptions());
  const push = usePushSettings();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    /*
     * Order matters and it is not cosmetic. Unregistering needs the session
     * that `signOut` is about to destroy, and a token left behind on the server
     * keeps this shop's orders arriving on the lock screen of a phone that has
     * been deliberately signed out of.
     *
     * Not remembered as an opt-out: signing out is not "stop notifying me", and
     * treating it as one would leave the next seller to sign in on this handset
     * silently un-notified with a toggle that says otherwise.
     */
    await forgetDevice();
    await authClient.signOut();
    /*
     * The same reason the dashboard clears it: the cache still holds the
     * previous seller's shop, and on a shared handset it would paint their
     * orders from cache before the first request even goes out.
     */
    queryClient.clear();
    setSigningOut(false);
  }, [queryClient]);

  if (isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <Section title="Account">
          <Row label="Name" value={session?.user?.name || "—"} />
          <Row label="Email" value={session?.user?.email ?? "—"} />
          {/*
            The shop is a separate read and can still be in flight, or can fail
            on its own. It says so rather than rendering an em dash, which would
            claim the seller has no shop name.
          */}
          <Row
            label="Shop"
            value={
              shop.isPending
                ? "Loading…"
                : shop.isError
                  ? "Couldn't load"
                  : (shop.data?.name ?? "—")
            }
            last
          />
        </Section>

        <Section title="Notifications">
          <View style={styles.toggleRow}>
            <View style={styles.toggleMain}>
              <Text style={styles.rowLabel}>Order alerts</Text>
              <Text style={styles.hint}>{explain(push)}</Text>
            </View>
            <Switch
              value={push.enabled}
              /*
               * Disabled while a decision is in flight, and when the OS will
               * not let the app ask. A switch that flips back a second later is
               * how a seller concludes the feature is broken — better that it
               * does not move and the line underneath says why.
               */
              disabled={push.busy || push.blocked}
              onValueChange={(next) => void push.setEnabled(next)}
              trackColor={{ true: "#4f46e5", false: "#e5e7eb" }}
            />
          </View>

          {push.permission === "blocked" ? (
            <Pressable style={styles.link} onPress={() => void openSystemSettings()}>
              <Text style={styles.linkText}>Open iOS settings</Text>
            </Pressable>
          ) : null}
        </Section>

        <Pressable
          style={[styles.signOut, signingOut && styles.busy]}
          disabled={signingOut}
          onPress={() => void signOut()}
        >
          <Text style={styles.signOutText}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The line under the toggle. It carries the whole difference between "off" and
 * "off, and tapping this will not help" — the case where the seller said no
 * once and the OS will not let the app ask again.
 */
function explain(push: ReturnType<typeof usePushSettings>): string {
  if (push.busy) return "Checking…";
  switch (push.permission) {
    case "unsupported":
      return "This device can't receive push notifications.";
    case "blocked":
      return "Notifications are off for Sailo in your device settings.";
    default:
      return push.enabled
        ? "You'll get an alert the moment an order comes in."
        : "Turn on to hear about orders without opening the app.";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 30, fontWeight: "800", color: "#111827", marginBottom: 20 },
  section: { marginBottom: 26 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 15, color: "#111827", fontWeight: "600" },
  rowValue: { fontSize: 15, color: "#6b7280", flexShrink: 1, textAlign: "right" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 13,
  },
  toggleMain: { flex: 1, gap: 3 },
  hint: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
  link: { paddingVertical: 12 },
  linkText: { color: "#4f46e5", fontWeight: "700", fontSize: 14 },
  signOut: {
    marginTop: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
  },
  busy: { opacity: 0.6 },
  signOutText: { color: "#dc2626", fontWeight: "700", fontSize: 15 },
});
