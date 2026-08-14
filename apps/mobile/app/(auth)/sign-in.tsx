import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { authClient } from "../../lib/auth";
import { Loading } from "../../components/states";

/**
 * Sign in — a placeholder, and the only route outside the tab shell.
 *
 * This is the signed-out half of what used to be `app/index.tsx`, moved out
 * whole. It works, and that is all it is meant to do: it proves the auth
 * transport end to end so the shell can be smoke-tested against a real shop.
 *
 * **A06 replaces this**, and has the harder half of the job — there is no
 * sign-up on the phone at all today, and no password reset. Both are net new,
 * and an app that only lets an existing seller in is an app the App Store
 * reviewer cannot get past.
 *
 * It sits in `app/(auth)/` rather than in the tabs because it must render
 * *without* the tab bar: showing five tabs to somebody who cannot use any of
 * them is an invitation to tap them and be bounced back here.
 */
export default function SignIn() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) setError(error.message ?? "Could not sign in.");
    setBusy(false);
  }, [email, password]);

  if (isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  /*
   * The other half of the gate in `(tabs)/_layout.tsx`. Without it, a
   * successful sign-in leaves the seller sitting on this screen — the session
   * changes but nothing navigates, because nothing was watching.
   */
  if (session?.user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.brand}>Sailo</Text>
        <Text style={styles.sub}>Sign in to your shop</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[styles.button, busy && styles.buttonBusy]}
          disabled={busy}
          onPress={submit}
        >
          <Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  brand: { fontSize: 34, fontWeight: "800", color: "#037740" },
  sub: { fontSize: 15, color: "#6f6b64" },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e0ddd5",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 6,
  },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center" },
  button: {
    marginTop: 18,
    width: "100%",
    backgroundColor: "#037740",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
});
