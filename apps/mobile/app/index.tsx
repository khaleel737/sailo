import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import type { Order } from "../lib/models";
import { authClient } from "../lib/auth";
import { forgetDevice } from "../lib/push";
import { useTRPC } from "../lib/query";
import { Empty, ErrorState, Loading, errorMessage } from "../components/states";

/**
 * The first real screen, and the reference the spec-built ones follow.
 *
 * It proves the whole native stack end to end: `@sailo/auth` signs the seller
 * in against the same server the web runs on (bearer token in the keychain),
 * and `@sailo/api` reads their shop back over tRPC — the same shop-scoped
 * queries, reached by a token instead of a cookie. Everything below the auth
 * gate is data the server already owns; nothing here re-implements it.
 *
 * The data layer is the part worth copying. `useTRPC()` hands back a typed
 * builder, `queryOptions()` turns a procedure into a cache entry with a key
 * derived from the procedure path and its input — so nothing here invents a
 * cache key, and two screens reading the same procedure share one fetch. The
 * four states below (loading, error, empty, refreshing) are the whole reason
 * this file exists rather than another `useState`/`useEffect` pair.
 *
 * Until the monorepo is the production deploy, point `EXPO_PUBLIC_API_URL` at a
 * dev server running apps/api — production won't answer `/api/trpc` until the
 * cutover.
 */

export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }
  return session?.user ? <Dashboard email={session.user.email} /> : <SignIn />;
}

/* -------------------------------------------------------------------------- */
/*  Signed out                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Signed in                                                                  */
/* -------------------------------------------------------------------------- */

function Dashboard({ email }: { email: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  /*
   * Both reads as one unit, because the screen is one unit: a header that has
   * arrived above a list that hasn't is a layout that jumps under the seller's
   * thumb. `useQueries` gives a single place to ask "is any of this still
   * loading" without either query knowing about the other.
   */
  const [shop, orders, products] = useQueries({
    queries: [
      trpc.shop.get.queryOptions(),
      trpc.orders.list.queryOptions({ limit: 20 }),
      trpc.products.list.queryOptions({ limit: 100 }),
    ],
  });

  const queries = [shop, orders, products];
  const failed = queries.find((q) => q.error);
  const loading = queries.some((q) => q.isPending);
  // `isFetching` rather than `isRefetching`, so the spinner is honest about a
  // background refresh the seller did not ask for as well as one they did.
  const refreshing = queries.some((q) => q.isFetching) && !loading;

  const refresh = useCallback(() => {
    void shop.refetch();
    void orders.refetch();
    void products.refetch();
  }, [shop.refetch, orders.refetch, products.refetch]);

  const signOut = useCallback(async () => {
    /*
     * Before `signOut`, because removing the row needs the session it is about
     * to destroy. A push token left registered keeps delivering this shop's
     * orders to the lock screen of a phone that has deliberately been signed
     * out of — the one place the seller cannot dismiss them from.
     */
    await forgetDevice();
    await authClient.signOut();
    /*
     * The cache is the previous seller's shop, and it outlives their session.
     * Without this, signing out and signing in as somebody else on the same
     * device paints their orders — from cache, before the first request even
     * goes out — which looks exactly like a cross-tenant leak and is one, on
     * the client side of the boundary the router defends on the server side.
     */
    queryClient.clear();
  }, [queryClient]);

  if (failed?.error) {
    captureError(failed.error, { scope: "mobile:dashboard" });
    return (
      <SafeAreaView style={styles.safe}>
        <ErrorState
          message={errorMessage(failed.error, "Couldn't reach your shop.")}
          onRetry={refresh}
          retrying={refreshing}
        />
        <SignOut onPress={signOut} />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Loading />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <FlatList
        data={orders.data ?? []}
        keyExtractor={(order) => order.id}
        renderItem={({ item }) => <OrderRow order={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#4f46e5" />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.brand}>{shop.data?.name ?? "Sailo"}</Text>
            <Text style={styles.sub}>{email}</Text>
            <View style={styles.stats}>
              <Stat label="Products" value={products.data?.length ?? 0} />
              <Stat label="Orders" value={orders.data?.length ?? 0} />
            </View>
            <Text style={styles.section}>Recent orders</Text>
          </View>
        }
        /*
         * Empty is a state, not an absence. `ListEmptyComponent` renders only
         * once the query has actually answered — the loading branch above
         * returns before this — so a seller never reads "No orders yet" about
         * a request that is still in flight.
         */
        ListEmptyComponent={
          <Empty title="No orders yet" hint="Orders from your shop will appear here." />
        }
        ListFooterComponent={<SignOut onPress={signOut} />}
      />
    </SafeAreaView>
  );
}

function OrderRow({ order }: { order: Order }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {order.productTitle}
        </Text>
        <Text style={styles.rowSub}>
          {order.customerName ?? "Someone"} · {order.status}
        </Text>
      </View>
      <Text style={styles.rowAmount}>
        {(order.totalCents / 100).toFixed(2)} {order.currency}
      </Text>
    </View>
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

function SignOut({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={[styles.button, styles.buttonGhost]} onPress={onPress}>
      <Text style={styles.buttonGhostText}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  list: { flexGrow: 1, padding: 20 },
  header: { alignItems: "center", gap: 6, paddingBottom: 8 },
  brand: { fontSize: 34, fontWeight: "800", color: "#4f46e5" },
  sub: { fontSize: 15, color: "#6b7280" },
  section: {
    alignSelf: "stretch",
    marginTop: 24,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowSub: { fontSize: 13, color: "#6b7280" },
  rowAmount: { fontSize: 15, fontWeight: "700", color: "#111827" },
});
