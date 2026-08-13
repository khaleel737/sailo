import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import { adminEn } from "@sailo/i18n/admin/en";
import type { Order } from "../../../lib/models";
import { useTRPC } from "../../../lib/query";
import { Empty, ErrorState, Loading, errorMessage } from "../../../components/states";
import { OrderStatusBadge } from "../../../components/order-status";
import { formatMoney } from "../../../components/money";

/**
 * Every order in the shop, newest first.
 *
 * WHAT "PAGED" MEANS HERE, AND WHY IT IS NOT INFINITE
 *
 * `orders.list` takes one input — `limit` — and returns a plain array. There is
 * no cursor, so there is nothing to append to: asking for more means asking for
 * a *longer* list, and the server answers with the whole thing again. So this
 * grows the limit a page at a time and lets the query key change, which is a
 * refetch rather than a concatenation.
 *
 * Two consequences worth naming rather than hiding:
 *   - `keepPreviousData` is load-bearing. Without it the list unmounts back to
 *     the spinner every time the seller reaches the bottom, which on a phone
 *     reads as the app losing their place.
 *   - It stops at 100, because the router's input caps there. Past that the
 *     seller cannot reach older orders from the phone at all. Real paging needs
 *     a cursor on `orders.list`, which is a change to packages/api.
 */

/** One screenful. Small enough that the first paint is quick on a phone network. */
const PAGE = 20;

/**
 * The ceiling `orders.list` will accept — `z.number().max(100)` in the router.
 * Mirrored rather than imported because the schema does not export its bound;
 * asking for 120 is a `BAD_REQUEST`, not a longer list. If that bound moves,
 * this moves with it.
 */
const MAX = 100;

export default function OrdersScreen() {
  const trpc = useTRPC();
  const [limit, setLimit] = useState(PAGE);

  const orders = useQuery(
    trpc.orders.list.queryOptions(
      { limit },
      // Keeps the current rows on screen while a longer page is in flight.
      { placeholderData: keepPreviousData },
    ),
  );

  const rows = orders.data ?? [];
  /*
   * A short page is the end of the list: the server gave back fewer than it was
   * asked for, so there is nothing behind it. That check is what stops this
   * firing a pointless request every time the seller bounces off the bottom.
   */
  const more = rows.length >= limit && limit < MAX;
  // `isFetching` rather than `isRefetching`, matching the dashboard: the spinner
  // is honest about a background refresh as well as a pulled one.
  const refreshing = orders.isFetching && !orders.isPending;

  const loadMore = useCallback(() => {
    if (!more || orders.isFetching) return;
    setLimit((current) => Math.min(current + PAGE, MAX));
  }, [more, orders.isFetching]);

  const refresh = useCallback(() => {
    void orders.refetch();
  }, [orders.refetch]);

  if (orders.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
        <Loading />
      </SafeAreaView>
    );
  }

  if (orders.error) {
    captureError(orders.error, { scope: "mobile:orders:list" });
    return (
      <SafeAreaView style={styles.safe}>
        <Header />
        <ErrorState
          message={errorMessage(orders.error, "Couldn't load your orders.")}
          onRetry={refresh}
          retrying={orders.isFetching}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Header />
      <FlatList
        data={rows}
        keyExtractor={(order) => order.id}
        renderItem={({ item }) => <OrderRow order={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#4f46e5" />
        }
        onEndReached={loadMore}
        // Half a screen out, so the next page is usually there by the time the
        // seller's thumb arrives.
        onEndReachedThreshold={0.5}
        /*
         * Renders only once the query has answered — the pending branch above
         * returns first — so a seller never reads "No orders yet" about a
         * request that is still in flight.
         */
        ListEmptyComponent={
          <Empty title={adminEn.orders.empty} hint={adminEn.orders.emptyBody} />
        }
        ListFooterComponent={
          <ListFooter loading={orders.isFetching && more} capped={limit >= MAX && rows.length >= MAX} />
        }
      />
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{adminEn.orders.title}</Text>
    </View>
  );
}

/**
 * The bottom of the list, which says one of three things: a page is coming, the
 * phone has reached as far back as the contract allows, or nothing at all.
 *
 * The capped message exists because a silently truncated list is a lie — a
 * seller scrolling for an old order needs to know the app stopped, not assume
 * the order is gone.
 */
function ListFooter({ loading, capped }: { loading: boolean; capped: boolean }) {
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color="#4f46e5" />
      </View>
    );
  }
  if (capped) {
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Showing your {MAX} most recent orders. Open your dashboard to see older ones.
        </Text>
      </View>
    );
  }
  return null;
}

/*
 * The object href rather than a built string: with `typedRoutes` on, the route
 * and its params are checked separately, so a renamed segment or a missing `id`
 * is a compile error instead of a dead tap.
 */
function OrderRow({ order }: { order: Order }) {
  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: order.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {order.productTitle}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {order.customerName ?? "Someone"}
            {/*
              The header's `itemCount` counts the order's lines, so this says
              "and 2 more" without a second request. The lines themselves are
              only fetched on the detail screen, where they are rendered.
            */}
            {order.itemCount > 1
              ? ` · ${adminEn.orders.andMore.replace("{count}", String(order.itemCount - 1))}`
              : ""}
          </Text>
          <OrderStatusBadge status={order.status} />
        </View>
        <Text style={styles.rowAmount}>
          {formatMoney(order.totalCents, order.currency)}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffff" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  list: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowPressed: { opacity: 0.6 },
  rowMain: { flex: 1, gap: 4, alignItems: "flex-start" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowSub: { fontSize: 13, color: "#6b7280" },
  rowAmount: { fontSize: 15, fontWeight: "700", color: "#111827" },
  footer: { paddingVertical: 20, alignItems: "center" },
  footerText: { fontSize: 13, color: "#6b7280", textAlign: "center" },
});
