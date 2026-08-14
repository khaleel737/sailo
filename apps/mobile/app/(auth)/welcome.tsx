import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import { Button, Text } from "@sailo/design-native";
import { authClient, useAuthCopy } from "../../lib/auth";
import { Loading } from "../../components/states";

/**
 * The first screen of the product.
 *
 * Two doors and nothing else. It exists because the alternative — dropping
 * somebody who has just installed the app onto a password form — asks the one
 * question a new seller cannot answer, and every app that does it loses the
 * people who do not yet have an account to answer it with.
 *
 * "Create an account" is the primary action, above sign-in, and that ordering
 * is the decision. An install is overwhelmingly somebody's first time; a
 * returning seller knows what they are looking for and finds the second button
 * in a second, while a new one presented with sign-in first concludes they need
 * something they do not have.
 */
export default function Welcome() {
  const router = useRouter();
  const copy = useAuthCopy();
  const { data: session, isPending } = authClient.useSession();

  /*
   * The session is read from the keychain, so there is a real moment on a cold
   * start where the answer is "not yet". Painting the brand screen during it
   * would flash a sign-up prompt at a seller who has been signed in for months.
   */
  if (isPending) {
    return (
      <SafeAreaView style={styles.fill}>
        <Loading />
      </SafeAreaView>
    );
  }

  /*
   * The same gate the other signed-out screens carry. Without it a seller who
   * signs in on another screen and swipes back lands here, signed in, being
   * offered an account.
   */
  if (session?.user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.fill}>
      <View>
        {/*
          The wordmark as text, not artwork. `apps/web/public/brand/` has the
          real mark as SVG and `apps/mobile/assets/` has it only as an app icon
          — the largest raster in the repo is 512px, which is an icon rather
          than a logo. Rendering it properly needs `react-native-svg`, which
          A01 is adding; this is the placeholder until then and the only reason
          the brand is a `display` string.
        */}
        <Text variant="display" tone="brand" align="center">
          Sailo
        </Text>
        <Text variant="title" align="center">
          {copy.welcome.tagline}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {copy.welcome.body}
        </Text>
      </View>

      <View>
        <Button
          label={copy.welcome.create}
          variant="primary"
          fullWidth
          onPress={() => router.push("/sign-up")}
        />
        <Button
          label={copy.welcome.signIn}
          variant="ghost"
          fullWidth
          onPress={() => router.push("/sign-in")}
        />
      </View>
    </SafeAreaView>
  );
}

/** See the note at the foot of `_layout.tsx`. Fill only; no look. */
const styles = StyleSheet.create({ fill: { flex: 1 } });
