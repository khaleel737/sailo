import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import type { Order } from "../../lib/models";
import { authClient } from "../../lib/auth";
import { forgetDevice } from "../../lib/push";
import { useTRPC } from "../../lib/query";
import { Empty, ErrorState, Loading, errorMessage } from "../../components/states";

/**
 * Home — a placeholder, and the shell's proof that the data layer still works.
 *
 * This is the dashboard half of what used to be `app/index.tsx`, moved into the
 * first tab unchanged. Its sign-in half went to `app/(auth)/sign-in.tsx`, and
 * the gate that chose between them is now `(tabs)/_layout.tsx` — a screen is no
 * longer the thing deciding whether anybody is signed in.
 *
 * **A07 replaces this.** What lands here is the onboarding checklist over the
 * orders surface, built from `@sailo/design-native`. What is worth keeping from
 * this file is not the layout — it is the data layer underneath it. `useTRPC()`
 * hands back a typed builder, `queryOptions()` derives the cache key from the
 * procedure path and its input, and the four states below (loading, error,
 * empty, refreshing) are the reason it exists rather than another
 * `useState`/`useEffect` pair. Copy that; the styles are placeholders.
 */
export default function Home() {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  /*
   * All three reads as one unit, because the screen is one unit: a header that
   * has arrived above a list that hasn't is a layout that jumps under the
   * seller's thumb. `useQueries` gives a single place to ask "is any of this
   * still loading" without either query knowing about the other.
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
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#037740" />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.brand}>{shop.data?.name ?? "Sailo"}</Text>
            <Text style={styles.sub}>{session?.user?.email ?? ""}</Text>
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
  list: { flexGrow: 1, padding: 20 },
  header: { alignItems: "center", gap: 6, paddingBottom: 8 },
  brand: { fontSize: 34, fontWeight: "800", color: "#037740" },
  sub: { fontSize: 15, color: "#6f6b64" },
  section: {
    alignSelf: "stretch",
    marginTop: 24,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: "700",
    color: "#6f6b64",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  button: {
    marginTop: 18,
    width: "100%",
    backgroundColor: "#037740",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonGhost: { backgroundColor: "transparent", marginTop: 32 },
  buttonGhostText: { color: "#6f6b64", fontWeight: "600", fontSize: 14 },
  stats: { flexDirection: "row", gap: 16, marginTop: 20 },
  stat: {
    backgroundColor: "#faf9f7",
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  statValue: { fontSize: 30, fontWeight: "800", color: "#1a1917" },
  statLabel: { fontSize: 13, color: "#6f6b64", marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0ddd5",
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#1a1917" },
  rowSub: { fontSize: 13, color: "#6f6b64" },
  rowAmount: { fontSize: 15, fontWeight: "700", color: "#1a1917" },
});
