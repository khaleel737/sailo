import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { captureMessage } from "@sailo/observability";

/**
 * The starter screen — a placeholder the real mobile pages replace.
 *
 * It exists to prove two things the whole monorepo hinges on: that a shared
 * `@sailo/*` package resolves inside the React Native bundle (the observability
 * seam here), and that the app knows where its backend is. The real screens —
 * store, checkout, orders — get their own spec files.
 */
export default function Home() {
  const apiUrl =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
    "https://sailo.store";
  const [pinged, setPinged] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.brand}>Sailo</Text>
        <Text style={styles.sub}>Mobile — scaffold</Text>
        <Text style={styles.meta}>API: {apiUrl}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            captureMessage("mobile scaffold ping", "info", { scope: "mobile:home" });
            setPinged(true);
          }}
        >
          <Text style={styles.buttonText}>
            {pinged ? "Observability wired ✓" : "Test the shared package"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  brand: { fontSize: 40, fontWeight: "800", color: "#4f46e5" },
  sub: { fontSize: 16, color: "#6b7280" },
  meta: { fontSize: 13, color: "#9ca3af", marginTop: 8 },
  button: {
    marginTop: 24,
    backgroundColor: "#4f46e5",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
});
