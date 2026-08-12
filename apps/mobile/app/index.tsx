import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { captureError } from "@sailo/observability";
import { authClient } from "../lib/auth";
import { api } from "../lib/api";

/**
 * The first real screen, and the reference the spec-built ones follow.
 *
 * It proves the whole native stack end to end: `@sailo/auth` signs the seller
 * in against the same server the web runs on (bearer token in the keychain),
 * and `@sailo/api` reads their shop back over tRPC — the same shop-scoped
 * queries, reached by a token instead of a cookie. Everything below the auth
 * gate is data the server already owns; nothing here re-implements it.
 *
 * Until the monorepo is the production deploy, point `EXPO_PUBLIC_API_URL` at a
 * dev server running apps/web — production won't answer `/api/trpc` until the
 * cutover.
 */

type Overview = {
  shopName: string | null;
  products: number;
  orders: number;
};

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Splash />;
  return session?.user ? (
    <Dashboard email={session.user.email} />
  ) : (
    <SignIn />
  );
}

function Splash() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator color="#4f46e5" />
      </View>
    </SafeAreaView>
  );
}

function SignIn() {
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

function Dashboard({ email }: { email: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [shop, products, orders] = await Promise.all([
          api.shop.get.query(),
          api.products.list.query(),
          api.orders.list.query(),
        ]);
        if (alive) {
          setOverview({
            shopName: shop?.name ?? null,
            products: products.length,
            orders: orders.length,
          });
        }
      } catch (err) {
        captureError(err, { scope: "mobile:dashboard" });
        if (alive) setError("Couldn't reach your shop. Check the API URL.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.brand}>{overview?.shopName ?? "Sailo"}</Text>
        <Text style={styles.sub}>{email}</Text>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : overview ? (
          <View style={styles.stats}>
            <Stat label="Products" value={overview.products} />
            <Stat label="Orders" value={overview.orders} />
          </View>
        ) : (
          <ActivityIndicator color="#4f46e5" style={{ marginTop: 24 }} />
        )}
        <Pressable
          style={[styles.button, styles.buttonGhost]}
          onPress={() => authClient.signOut()}
        >
          <Text style={styles.buttonGhostText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  brand: { fontSize: 34, fontWeight: "800", color: "#4f46e5" },
  sub: { fontSize: 15, color: "#6b7280" },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 6,
  },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center" },
  button: {
    marginTop: 18,
    width: "100%",
    backgroundColor: "#4f46e5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  buttonGhost: { backgroundColor: "transparent", marginTop: 32 },
  buttonGhostText: { color: "#6b7280", fontWeight: "600", fontSize: 14 },
  stats: { flexDirection: "row", gap: 16, marginTop: 20 },
  stat: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  statValue: { fontSize: 30, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 13, color: "#6b7280", marginTop: 4 },
});
