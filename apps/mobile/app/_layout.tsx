import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { init } from "@sailo/observability";

// One call, at the app's entry: today it logs; a Sentry DSN swaps the sink in
// without touching a single captureError elsewhere.
init();

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
